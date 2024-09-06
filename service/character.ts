import {
    CharactersApi,
    CharacterSchema,
    CooldownSchema,
    DropRateSchema,
    GetAllItemsItemsGetCraftSkillEnum,
    GetAllItemsItemsGetTypeEnum,
    GetAllMapsMapsGetContentTypeEnum,
    GrandExchangeApi,
    MapSchema,
    MonsterSchema,
    MyAccountApi,
    MyCharactersApi,
    ResourceSchema,
    ResponseError,
    SimpleItemSchema,
    UnequipSchemaSlotEnum,
} from "../api/index.ts";
import { CONFIG, MAX_LEVEL } from "../constants.ts";
import { delay } from "@std/async";
import { distinctBy } from "@std/collections";
import { getMostSkilledChar } from "./characters.ts";
import { getBankItems } from "./bank.ts";
import { getAllItems, getAllMaps, getAllMonsters, getAllResources, getItem } from "./database.ts";
import { getLogger } from "./log.ts";
import { asyncFilter } from "../utils.ts";

const myCharactersApi = new MyCharactersApi(CONFIG);
const charactersApi = new CharactersApi(CONFIG);
const grandExchangeApi = new GrandExchangeApi(CONFIG);
const myAccountApi = new MyAccountApi(CONFIG);

export async function tick(name: string) {
    try {
        const char = await getChar(name);
        await delay(getRemainingCooldown(char));

        await depositResourcesIfNecessary(char);

        for (const skill of Object.values(GetAllItemsItemsGetCraftSkillEnum)) {
            const skilledChar = getMostSkilledChar(skill);
            if (skilledChar === name) {
                const t1 = new Date().getTime();
                await craft(char, skill);
                const t2 = new Date().getTime();
                const duration = t2 - t1;
                if (duration > 10_000) {
                    return;
                }
            }
        }

        const quarter = Math.floor(new Date().getHours() / 6);
        if (quarter % 2 != 0) {
            for (const skill of Object.values(GetAllItemsItemsGetCraftSkillEnum)) {
                const skilledChar = getMostSkilledChar(skill);
                if (skilledChar === name && char[(skill + "Level") as keyof CharacterSchema] as number < MAX_LEVEL) {
                    const t1 = new Date().getTime();
                    await sell(char, skill);
                    const t2 = new Date().getTime();
                    const duration = t2 - t1;
                    if (duration > 10_000) {
                        return;
                    }
                }
            }
        }

        const quest = await getNextQuest(char);
        if (quest.mon) {
            await fight(char, quest.mon);
        } else if (quest.res) {
            await gather(char, quest.res);
        } else {
            getLogger(char).warn("No quest found");
        }
    } catch (error) {
        if (error instanceof ResponseError) {
            error.message = await error.response.text();
            //@ts-ignore dont care about response
            error.response = { status: error.response.status };
        }
        getLogger(name).error(error);
    }
}

async function getChar(name: string): Promise<CharacterSchema> {
    return (await charactersApi.getCharacterCharactersNameGet({ name })).data;
}

type Quest = { res?: ResourceSchema; mon?: MonsterSchema; qr: number; drop: DropRateSchema };
async function getNextQuest(char: CharacterSchema): Promise<Quest> {
    const bankItems = await getBankItems();

    const mineableResources = (await getAllResources())
        .filter((res) => {
            const charLevel = char[(res.skill + "Level") as keyof CharacterSchema] as number;
            return charLevel >= res.level;
        });
    const resourceQuests: Quest[] = mineableResources.sort((a, b) => b.level - a.level).flatMap((res) => {
        return res.drops.filter((drop) => drop.rate < 1000).map((drop) => {
            return {
                res,
                qr: getBankQuantity(bankItems, drop.code) * drop.rate,
                drop,
            };
        });
    });

    const monsterMaps = await getAllMaps({ contentType: "monster" });
    const availableMonsters = monsterMaps.map((map) => map.content?.code).filter(Boolean);
    const fightableMonsters = (await getAllMonsters({ maxLevel: char.level }))
        .filter((mon) => !tooStrongWithFood.has(mon.code))
        .filter((mon) => availableMonsters.includes(mon.code));
    const monsterQuests: Quest[] = fightableMonsters.sort((a, b) => a.level - b.level).flatMap((mon) => {
        return mon.drops.filter((drop) => drop.rate < 1000).map((drop) => {
            return {
                mon,
                qr: getBankQuantity(bankItems, drop.code) * drop.rate,
                drop,
            };
        });
    });

    const quests = resourceQuests.concat(monsterQuests).sort((a, b) => a.qr - b.qr);
    getLogger(char).debug({
        quests: quests.map((q) => ({ code: q.mon?.code ?? q.res?.code ?? "_", drop: q.drop.code, quantity: q.qr })),
    });
    const playerHash = Math.abs(
        Array.from(Array(char.name.length))
            .map((i) => char.name.charCodeAt(i))
            .reduce((p, c) => {
                const $ = ((p << 5) - p) + c;
                return $ & $;
            }, 0),
    );

    const equalQuests = distinctBy(
        quests.filter((q) => q.qr === quests[0].qr),
        (q) => q.mon?.code ?? q.res?.code ?? "_",
    );

    return equalQuests[playerHash % equalQuests.length];
}

async function gather(char: CharacterSchema, resource: ResourceSchema) {
    // TODO equip tool for better effiency
    getLogger(char).info(`Start gathering ${resource.code}`);
    await moveTo(char, "resource", resource.code);

    const gatherResult = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name: char.name });
    getLogger(char).info(
        `Gathered ${gatherResult.data.details.items.map((i) => `${i.quantity} ${i.code}`).join(", ")}`,
    );
    await sleepAndRefresh(char, gatherResult.data);
}

async function fight(char: CharacterSchema, monster: MonsterSchema) {
    getLogger(char).info(`Start fighting ${monster.code}`);
    const bankItems = await getBankItems();

    const needFood = tooStrongWithoutFood.has(monster.code);
    char = await prepareForMonster(monster, char, bankItems, needFood);
    const hasFood = char.consumable1SlotQuantity > 0 || char.consumable2SlotQuantity > 0;

    await moveTo(char, "monster", monster.code);

    const battleResult = await myCharactersApi.actionFightMyNameActionFightPost({ name: char.name });
    getLogger(char).info(`Fought ${monster.code}. Result: ${battleResult.data.fight.result}`);
    if (battleResult.data.fight.result === "lose") {
        if (hasFood) {
            tooStrongWithFood.add(monster.code);
        } else {
            tooStrongWithoutFood.add(monster.code);
        }
    }
    await sleepAndRefresh(char, battleResult.data);
}

const tooStrongWithoutFood: Set<string> = new Set();
const tooStrongWithFood: Set<string> = new Set();
setInterval(() => {
    tooStrongWithFood.clear();
    tooStrongWithoutFood.clear();
}, 1000 * 60 * 60 * 4);

async function prepareForMonster(
    monster: MonsterSchema,
    char: CharacterSchema,
    bankItems: SimpleItemSchema[],
    withFood: boolean,
): Promise<CharacterSchema> {
    const resPrefix = "res";
    const attackPrefix = "attack";
    const resistanceKeys = Object.keys(monster).filter((key) =>
        key.startsWith(resPrefix) &&
        key.slice(resPrefix.length, resPrefix.length + 1) ===
            key.slice(resPrefix.length, resPrefix.length + 1).toUpperCase()
    );
    const attackKeys = Object.keys(monster).filter((key) =>
        key.startsWith(attackPrefix) &&
        key.slice(attackPrefix.length, attackPrefix.length + 1) ===
            key.slice(attackPrefix.length, attackPrefix.length + 1).toUpperCase()
    );
    const lowestResistance = resistanceKeys
        .filter((key) => (monster[key as keyof MonsterSchema] as number) < 0)
        .sort((a, b) => (monster[a as keyof MonsterSchema] as number) - (monster[b as keyof MonsterSchema] as number))
        .map((key) => key.slice(resPrefix.length).toLowerCase())
        .at(0);

    const highestResistance = resistanceKeys
        .filter((key) => (monster[key as keyof MonsterSchema] as number) > 0)
        .sort((a, b) => (monster[b as keyof MonsterSchema] as number) - (monster[a as keyof MonsterSchema] as number))
        .map((key) => key.slice(resPrefix.length).toLowerCase())
        .at(0);

    const highestAttack = attackKeys
        .filter((key) => (monster[key as keyof MonsterSchema] as number) > 0)
        .sort((a, b) => (monster[b as keyof MonsterSchema] as number) - (monster[a as keyof MonsterSchema] as number))
        .map((key) => key.slice(attackPrefix.length).toLowerCase())
        .at(0);

    const weaponItems = (await getAllItems({ type: "weapon" }))
        .sort((a, b) => b.level - a.level);
    const effectiveWeaponItems = weaponItems
        .filter((wi) => (wi.effects ?? []).some((effect) => effect.name === `attack_${lowestResistance}`));
    const normalWeaponItems = weaponItems
        .filter((wi) => !(wi.effects ?? []).some((effect) => effect.name === `attack_${highestResistance}`));
    const weapons = effectiveWeaponItems.concat(normalWeaponItems).concat(weaponItems).flatMap((wi) =>
        bankItems.concat([{ code: char.weaponSlot, quantity: 1 }]).filter((bi) => wi.code === bi.code)
    );
    await equip(char, weapons.at(0), "weapon", "weaponSlot");

    const shieldItems = (await getAllItems({ type: "shield" }))
        .sort((a, b) => b.level - a.level);
    const shields = shieldItems.flatMap((wi) =>
        bankItems.concat([{ code: char.shieldSlot, quantity: 1 }]).filter((bi) => wi.code === bi.code)
    );
    await equip(char, shields.at(0), "shield", "shieldSlot");

    const ringItems = (await getAllItems({ type: "ring" }))
        .sort((a, b) => b.level - a.level);
    const effectiveRingItems = ringItems
        .filter((ri) => (ri.effects ?? []).some((effect) => effect.name === `dmg_${lowestResistance}`));
    const rings = effectiveRingItems.concat(ringItems).flatMap((wi) => bankItems.filter((bi) => wi.code === bi.code));
    await equip(char, rings.at(0), "ring1", "ring1Slot");
    await equip(char, rings.at(1) ?? rings.at(0), "ring2", "ring2Slot");

    const amuletItems = (await getAllItems({ type: "amulet" }))
        .sort((a, b) => b.level - a.level);
    const effectiveAmuletItems = amuletItems
        .filter((ai) => (ai.effects ?? []).some((effect) => effect.name === `dmg_${lowestResistance}`));
    const amulets = effectiveAmuletItems.concat(amuletItems).flatMap((wi) =>
        bankItems.concat([{ code: char.amuletSlot, quantity: 1 }]).filter((bi) => wi.code === bi.code)
    );
    await equip(char, amulets.at(0), "amulet", "amuletSlot");

    if (withFood) {
        // TODO equip more than one food
        await unequip(char, "consumable1", "consumable1Slot");
        await unequip(char, "consumable2", "consumable2Slot");
        const foodItems = (await getAllItems({ type: "consumable" }))
            .sort((a, b) => b.level - a.level);
        const effectiveFoodItems = foodItems
            .filter((fi) => (fi.effects ?? []).some((effect) => effect.name === `boost_dmg_${lowestResistance}`));
        const hpFoodItems = foodItems
            .filter((fi) =>
                (fi.effects ?? []).some((effect) => effect.name === "boost_hp" || effect.name === "restore")
            );
        const foods = effectiveFoodItems.concat(hpFoodItems).concat(foodItems)
            .flatMap((fi) => bankItems.filter((bi) => fi.code === bi.code));
        await equip(char, foods.at(0), "consumable1", "consumable1Slot");
        await equip(char, foods.at(1), "consumable2", "consumable2Slot");
    }

    const gearTypes: {
        type: GetAllItemsItemsGetTypeEnum;
        slot: UnequipSchemaSlotEnum;
        charSlot: keyof CharacterSchema;
    }[] = [
        { type: "helmet", slot: "helmet", charSlot: "helmetSlot" },
        { type: "body_armor", slot: "body_armor", charSlot: "bodyArmorSlot" },
        { type: "leg_armor", slot: "leg_armor", charSlot: "legArmorSlot" },
        { type: "boots", slot: "boots", charSlot: "bootsSlot" },
    ];
    for (const gearType of gearTypes) {
        const gearItems = (await getAllItems({ type: gearType.type }))
            .sort((a, b) => b.level - a.level);
        const effectiveGearItems = gearItems
            .filter((gi) => (gi.effects ?? []).some((effect) => effect.name === `res_${highestAttack}`));
        const gears = effectiveGearItems.concat(gearItems).flatMap((gi) =>
            bankItems.concat([{ code: char[gearType.charSlot] as string, quantity: 1 }]).filter((bi) =>
                gi.code === bi.code
            )
        );
        await equip(char, gears.at(0), gearType.slot, gearType.charSlot);
    }

    return char;
}

async function equip(
    char: CharacterSchema,
    item: SimpleItemSchema | undefined,
    slot: UnequipSchemaSlotEnum,
    charSlot: keyof CharacterSchema,
) {
    if (item && char[charSlot] !== item.code) {
        await moveTo(char, "bank");
        await unequip(char, slot, charSlot);
        const withdrawResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
            name: char.name,
            simpleItemSchema: { code: item.code, quantity: 1 },
        });
        await sleepAndRefresh(char, withdrawResult.data);
        const equipResult = await myCharactersApi.actionEquipItemMyNameActionEquipPost({
            name: char.name,
            equipSchema: { code: withdrawResult.data.item.code, slot },
        });
        getLogger(char).debug(`Equipped ${equipResult.data.item.code} in ${equipResult.data.slot}`);
        await sleepAndRefresh(char, equipResult.data);
    }
}

async function unequip(char: CharacterSchema, slot: UnequipSchemaSlotEnum, charSlot: keyof CharacterSchema) {
    if (char[charSlot]) {
        const unequipResult = await myCharactersApi.actionUnequipItemMyNameActionUnequipPost({
            name: char.name,
            unequipSchema: { slot },
        });
        await sleepAndRefresh(char, unequipResult.data);
        const depositResult = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
            name: char.name,
            simpleItemSchema: { code: unequipResult.data.item.code, quantity: 1 },
        });
        await sleepAndRefresh(char, depositResult.data);
    }
}

async function craft(char: CharacterSchema, skill: GetAllItemsItemsGetCraftSkillEnum) {
    const craftableItems = await getAllItems({
        craftSkill: skill,
        maxLevel: char[(skill + "Level") as keyof CharacterSchema] as number,
    });
    const bankItems = await getBankItems();

    craftableItems.sort((a, b) => {
        const aQ = getBankQuantity(bankItems, a.code);
        const bQ = getBankQuantity(bankItems, b.code);

        return aQ - bQ;
    });

    const minQuantity = getMinQuantityInBank(skill);

    const target = craftableItems
        .map((item) => {
            if (item.craft == null) {
                return;
            }
            const items = item.craft?.items ?? [];
            if (items.length == 0) {
                return;
            }
            const missing = minQuantity - getBankQuantity(bankItems, item.code);
            if (missing <= 0) {
                return;
            }

            const craftableQuantity = Math.min(
                missing,
                Math.min(...items.map((ing) => Math.floor(getBankQuantity(bankItems, ing.code) / ing.quantity))),
            );
            if (craftableQuantity <= 0) {
                return;
            }
            const freeSlots = char.inventory?.filter((slot) => !slot.code).length ?? 0;
            if (freeSlots < items.length + 1) {
                return;
            }
            const inventorySpace = char.inventoryMaxItems -
                (char.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0);
            const ingsForOneCraft = items.map((i) => i.quantity).reduce((a, c) => a + c, 0);
            const maxCrafting = Math.min(craftableQuantity, Math.floor(inventorySpace / ingsForOneCraft));
            return {
                code: item.code,
                quantity: maxCrafting,
                ingredients: items.map((i) => ({ code: i.code, quantity: i.quantity * maxCrafting })),
            };
        })
        .filter(Boolean)
        .at(0);

    if (target == null) {
        getLogger(char).debug(`No item found for crafing`);
        return;
    }
    getLogger(char).info(`Start crafting ${target.quantity} ${target.code}`);

    await moveTo(char, "bank");
    await deposit(char, "resource");
    for (const item of target.ingredients) {
        try {
            const fetchResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
                name: char.name,
                simpleItemSchema: item,
            });
            await sleepAndRefresh(char, fetchResult.data);
        } catch (error) {
            if (error instanceof ResponseError) {
                if (error.response.status === 461) {
                    getLogger(char).warn(`Withdraw conflict 461: ${item.code}`);
                    return;
                } else if (error.response.status === 404) {
                    // someone was faster
                    getLogger(char).warn(`Withdraw conflict 404: ${item.code}`);
                    return;
                }
            }
            throw error;
        }
    }

    await moveTo(char, "workshop", skill);

    const craftResult = await myCharactersApi.actionCraftingMyNameActionCraftingPost({
        name: char.name,
        craftingSchema: { code: target.code, quantity: target.quantity },
    });
    getLogger(char).info(`Crafted ${craftResult.data.details.items.map((i) => `${i.quantity} ${i.code}`).join(", ")}`);
    await sleepAndRefresh(char, craftResult.data);

    await moveTo(char, "bank");

    for (const item of craftResult.data.details.items) {
        try {
            const deposit = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.name,
                simpleItemSchema: item,
            });
            await sleepAndRefresh(char, deposit.data);
        } catch (error) {
            if (error instanceof ResponseError && error.response.status === 461) {
                getLogger(char).warn(`Deposit conflict 461: ${item.code}`);
                return;
            }
            throw error;
        }
    }
}

async function sell(char: CharacterSchema, skill: GetAllItemsItemsGetCraftSkillEnum) {
    const craftableItems = (await getAllItems({
        craftSkill: skill,
        maxLevel: char[(skill + "Level") as keyof CharacterSchema] as number,
    })).sort((a, b) => a.level - b.level);
    const bankItems = await getBankItems();
    const shouldSell = craftableItems.every((i) => getBankQuantity(bankItems, i.code) >= getMinQuantityInBank(skill));
    if (!shouldSell) {
        return;
    }
    const toSellItem =
        (await asyncFilter(craftableItems, async (item) => (await getItem({ code: item.code })).data.ge != null))
            .map((item) => ({ code: item.code, quantity: Math.floor(getBankQuantity(bankItems, item.code) / 5) }))
            .filter((i) => i.quantity > 0)[0];
    if (toSellItem == null) {
        getLogger(char).debug(`No item found for selling`);
        return;
    }
    const { sellPrice: price, maxQuantity } =
        (await grandExchangeApi.getGeItemGeCodeGet({ code: toSellItem.code })).data;
    if (price == null) {
        return;
    }
    toSellItem.quantity = Math.min(toSellItem.quantity, maxQuantity);
    const totalItems = char.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    const freeSlots = char.inventory?.filter((slot) => !slot.code).length ?? 0;
    if (freeSlots === 0 || totalItems + toSellItem.quantity >= char.inventoryMaxItems) {
        getLogger(char).debug(`No space for selling`);
        return;
    }
    await moveTo(char, "bank");
    const withdrawResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
        name: char.name,
        simpleItemSchema: toSellItem,
    });
    await sleepAndRefresh(char, withdrawResult.data);
    await moveTo(char, "grand_exchange");

    getLogger(char).info(`Start selling ${toSellItem.quantity} ${toSellItem.code}`);
    const sellResult = await myCharactersApi.actionGeSellItemMyNameActionGeSellPost({
        name: char.name,
        gETransactionItemSchema: {
            code: toSellItem.code,
            quantity: toSellItem.quantity,
            price,
        },
    });
    getLogger(char).info(
        `Sold ${sellResult.data.transaction.quantity} ${sellResult.data.transaction.code} for ${sellResult.data.transaction.price} gold`,
    );

    await sleepAndRefresh(char, sellResult.data);
}

function getMinQuantityInBank(skill: GetAllItemsItemsGetCraftSkillEnum) {
    let minQuantity = 5;
    if (skill === GetAllItemsItemsGetCraftSkillEnum.Cooking) {
        minQuantity = 100;
    } else if (
        skill === GetAllItemsItemsGetCraftSkillEnum.Woodcutting || skill === GetAllItemsItemsGetCraftSkillEnum.Mining
    ) {
        minQuantity = 50;
    } else if (skill === GetAllItemsItemsGetCraftSkillEnum.Jewelrycrafting) {
        minQuantity = 10;
    }
    return minQuantity;
}

async function move(char: CharacterSchema, x: number, y: number) {
    if (char.x == x && char.y == y) {
        return;
    }
    const movement = await myCharactersApi.actionMoveMyNameActionMovePost({
        name: char.name,
        destinationSchema: { x, y },
    });
    getLogger(char).debug(`Moved to (${movement.data.destination.x}, ${movement.data.destination.y})`);
    await sleepAndRefresh(char, movement.data);
}

async function depositResourcesIfNecessary(char: CharacterSchema) {
    const totalItems = char.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    const freeSlots = char.inventory?.filter((slot) => !slot.code).length ?? 0;
    if (totalItems + 5 < char.inventoryMaxItems && freeSlots > 3) {
        return char;
    }
    await deposit(char, "resource");
}

async function deposit(
    char: CharacterSchema,
    type: GetAllItemsItemsGetTypeEnum,
) {
    getLogger(char).info("Start depositing");

    await moveTo(char, "bank");
    if (char.gold > 0) {
        const goldResult = await myCharactersApi.actionDepositBankGoldMyNameActionBankDepositGoldPost({
            name: char.name,
            depositWithdrawGoldSchema: { quantity: char.gold },
        });
        await sleepAndRefresh(char, goldResult.data);
    }

    await expandBankIfNecessary(char);

    const items = (await getAllItems({ type })).map((item) => item.code);

    for (const slot of (char.inventory ?? [])) {
        if (items.includes(slot.code)) {
            const depositResult = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.name,
                simpleItemSchema: slot,
            });
            getLogger(char).info(`Deposited ${depositResult.data.item.code}`);
            await sleepAndRefresh(char, depositResult.data);
        }
    }
}

async function expandBankIfNecessary(char: CharacterSchema) {
    const items = await getBankItems();
    const details = await myAccountApi.getBankDetailsMyBankGet();
    if (items.length + 1 < details.data.slots) {
        getLogger(char).debug("Bank has still enough space");
        return;
    }
    getLogger(char).info("Start expanding bank");

    if (details.data.gold < details.data.nextExpansionCost) {
        getLogger(char).info("Not enough gold for expanding. Rest a bit");
        await delay(1000 * 60);
        return;
    }
    await moveTo(char, "bank");

    const withdrawResult = await myCharactersApi.actionWithdrawBankGoldMyNameActionBankWithdrawGoldPost({
        name: char.name,
        depositWithdrawGoldSchema: { quantity: details.data.nextExpansionCost },
    });
    await sleepAndRefresh(char, withdrawResult.data);
    const expansionResult = await myCharactersApi.actionBuyBankExpansionMyNameActionBankBuyExpansionPost({
        name: char.name,
    });
    await sleepAndRefresh(char, expansionResult.data);
    getLogger(char).info(`Expanded bank for ${expansionResult.data.transaction.price} gold`);
}

async function moveTo(
    char: CharacterSchema,
    contentType?: GetAllMapsMapsGetContentTypeEnum,
    contentCode?: string,
) {
    const map = (await getAllMaps({ contentType, contentCode }))
        .sort((a, b) => distance(a, char) - distance(b, char))[0];
    await move(char, map.x, map.y);
}

function distance(map: MapSchema, char: CharacterSchema): number {
    const dx = map.x - char.x;
    const dy = map.y - char.y;
    return dx * dx + dy * dy;
}

function getBankQuantity(bankItems: SimpleItemSchema[], itemCode: string) {
    const item = bankItems.filter((i) => i.code == itemCode).at(0);
    return item == null ? 0 : item.quantity;
}

async function sleepAndRefresh(char: CharacterSchema, result: {
    cooldown: CooldownSchema;
    character: CharacterSchema;
}) {
    await sleep(result.cooldown);
    await refresh(char, result.character);
    getLogger(char).debug(`Slept for ${result.cooldown.totalSeconds} seconds`);
}

async function sleep(cooldown: CooldownSchema) {
    await delay(cooldown.remainingSeconds * 1000 + 100);
}

async function refresh(char: CharacterSchema, updatedChar?: CharacterSchema) {
    Object.assign(char, updatedChar ?? await getChar(char.name));
}

function getRemainingCooldown(char: CharacterSchema): number {
    const expireDate = char.cooldownExpiration;
    if (expireDate == null) {
        return 0;
    }
    const diff = expireDate.getTime() - new Date().getTime();
    return Math.max(0, diff);
}
