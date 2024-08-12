import {
    CharacterResponseSchema,
    CharactersApi,
    CharacterSchema,
    CooldownSchema,
    DropRateSchema,
    GetAllItemsItemsGetCraftSkillEnum,
    GetAllItemsItemsGetTypeEnum,
    GetAllMapsMapsGetContentTypeEnum,
    ItemsApi,
    MapsApi,
    MapSchema,
    MonstersApi,
    MonsterSchema,
    MyCharactersApi,
    ResourcesApi,
    ResourceSchema,
    ResponseError,
    SimpleItemSchema,
    UnequipSchemaSlotEnum,
} from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { delay } from "@std/async";
import { getMostSkilledChar } from "./characters.ts";
import { getBankItems } from "./bank.ts";

const myCharactersApi = new MyCharactersApi(CONFIG);
const charactersApi = new CharactersApi(CONFIG);
const mapsApi = new MapsApi(CONFIG);
const resourcesApi = new ResourcesApi(CONFIG);
const itemsApi = new ItemsApi(CONFIG);
const monstersApi = new MonstersApi(CONFIG);

export async function tick(name: string) {
    try {
        let char = await getChar(name);
        const cooling = hasCooldown(char);

        if (cooling) {
            console.log(name, "is cooling down");
            return;
        }

        char = await depositResourcesIfNecessary(char);

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
        char = await getChar(name);
        const quest = await getNextQuest(char);
        if (quest.mon) {
            await fight(char, quest.mon);
        } else if (quest.res) {
            await gather(char, quest.res);
        } else {
            console.log("No quest found");
        }
    } catch (error) {
        if (error instanceof ResponseError) {
            console.error(
                name,
                error.response.status,
                error.message,
                await error.response.json().catch((_) => error.response.text()),
                //error.stack,
            );
        } else {
            console.error("unexpected");
            console.error(error);
        }
    }
}

async function getChar(name: string): Promise<CharacterResponseSchema> {
    return await charactersApi.getCharacterCharactersNameGet({ name });
}

type Quest = { res?: ResourceSchema; mon?: MonsterSchema; qr: number; drop: DropRateSchema };
async function getNextQuest(char: CharacterResponseSchema): Promise<Quest> {
    const bankItems = await getBankItems();

    const resources = await resourcesApi.getAllResourcesResourcesGet({ size: 100 });
    const mineableResources: ResourceSchema[] = [];
    resources.data.filter((res) => {
        const charLevel = char.data[(res.skill + "Level") as keyof CharacterSchema] as number;
        if (charLevel >= res.level) {
            mineableResources.push(res);
        }
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

    const fightableMonsters = (await monstersApi.getAllMonstersMonstersGet({ maxLevel: char.data.level, size: 100 }))
        .data
        .filter((m) => !tooStrongWithFood.has(m.code));
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

    return quests[0];
}

async function gather(char: CharacterResponseSchema, resource: ResourceSchema) {
    char = await moveTo(char, "resource", resource.code);

    const gatherResult = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name: char.data.name });
    await sleep(gatherResult.data.cooldown);
}

async function fight(char: CharacterResponseSchema, monster: MonsterSchema) {
    const bankItems = await getBankItems();

    const needFood = tooStrongWithoutFood.has(monster.code);
    char = await prepareForMonster(monster, char, bankItems, needFood);
    const hasFood = char.data.consumable1SlotQuantity > 0 || char.data.consumable2SlotQuantity > 0;

    char = await moveTo(char, "monster", monster.code);

    const battleResult = await myCharactersApi.actionFightMyNameActionFightPost({ name: char.data.name });
    if (battleResult.data.fight.result === "lose") {
        if (hasFood) {
            tooStrongWithFood.add(monster.code);
        } else {
            tooStrongWithoutFood.add(monster.code);
        }
    }
    await sleep(battleResult.data.cooldown);
}

const tooStrongWithoutFood: Set<string> = new Set();
const tooStrongWithFood: Set<string> = new Set();
setInterval(() => {
    tooStrongWithFood.clear();
    tooStrongWithoutFood.clear();
}, 1000 * 60 * 60 * 4);

async function prepareForMonster(
    monster: MonsterSchema,
    char: CharacterResponseSchema,
    bankItems: SimpleItemSchema[],
    withFood: boolean,
): Promise<CharacterResponseSchema> {
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

    const weaponItems = (await itemsApi.getAllItemsItemsGet({ type: "weapon" })).data
        .sort((a, b) => b.level - a.level);
    const effectiveWeaponItems = weaponItems
        .filter((wi) => (wi.effects ?? []).some((effect) => effect.name === `attack_${lowestResistance}`));
    const normalWeaponItems = weaponItems
        .filter((wi) => !(wi.effects ?? []).some((effect) => effect.name === `attack_${highestResistance}`));
    const weapons = effectiveWeaponItems.concat(normalWeaponItems).concat(weaponItems).flatMap((wi) =>
        bankItems.filter((bi) => wi.code === bi.code)
    );
    char = await equip(char, weapons.at(0), "weapon", "weaponSlot");

    const shieldItems = (await itemsApi.getAllItemsItemsGet({ type: "shield" })).data
        .sort((a, b) => b.level - a.level);
    const shields = shieldItems.flatMap((wi) => bankItems.filter((bi) => wi.code === bi.code));
    char = await equip(char, shields.at(0), "shield", "shieldSlot");

    const ringItems = (await itemsApi.getAllItemsItemsGet({ type: "ring" })).data
        .sort((a, b) => b.level - a.level);
    const effectiveRingItems = ringItems
        .filter((ri) => (ri.effects ?? []).some((effect) => effect.name === `dmg_${lowestResistance}`));
    const rings = effectiveRingItems.concat(ringItems).flatMap((wi) => bankItems.filter((bi) => wi.code === bi.code));
    char = await equip(char, rings.at(0), "ring1", "ring1Slot");
    char = await equip(char, rings.at(1), "ring2", "ring2Slot");

    const amuletItems = (await itemsApi.getAllItemsItemsGet({ type: "amulet" })).data
        .sort((a, b) => b.level - a.level);
    const effectiveAmuletItems = amuletItems
        .filter((ai) => (ai.effects ?? []).some((effect) => effect.name === `dmg_${lowestResistance}`));
    const amulets = effectiveAmuletItems.concat(amuletItems).flatMap((wi) =>
        bankItems.filter((bi) => wi.code === bi.code)
    );
    char = await equip(char, amulets.at(0), "amulet", "amuletSlot");

    if (withFood) {
        const foodItems = (await itemsApi.getAllItemsItemsGet({ type: "consumable" })).data
            .sort((a, b) => b.level - a.level);
        const effectiveFoodItems = foodItems
            .filter((fi) => (fi.effects ?? []).some((effect) => effect.name === `boost_dmg_${lowestResistance}`));
        const hpFoodItems = foodItems
            .filter((fi) =>
                (fi.effects ?? []).some((effect) => effect.name === "boost_hp" || effect.name === "restore")
            );
        const foods = effectiveFoodItems.concat(hpFoodItems).concat(foodItems)
            .flatMap((fi) => bankItems.filter((bi) => fi.code === bi.code));
        char = await equip(char, foods.at(0), "consumable1", "consumable1Slot");
        char = await equip(char, foods.at(1), "consumable2", "consumable2Slot");
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
        const gearItems = (await itemsApi.getAllItemsItemsGet({ type: gearType.type })).data
            .sort((a, b) => b.level - a.level);
        const effectiveGearItems = gearItems
            .filter((gi) => (gi.effects ?? []).some((effect) => effect.name === `res_${highestAttack}`));
        const gears = effectiveGearItems.concat(gearItems).flatMap((gi) =>
            bankItems.filter((bi) => gi.code === bi.code)
        );
        char = await equip(char, gears.at(0), gearType.slot, gearType.charSlot);
    }

    return char;
}

async function equip(
    char: CharacterResponseSchema,
    item: SimpleItemSchema | undefined,
    slot: UnequipSchemaSlotEnum,
    charSlot: keyof CharacterSchema,
): Promise<CharacterResponseSchema> {
    if (item && char.data[charSlot] !== item.code) {
        char = await moveTo(char, "bank");
        if (char.data[charSlot]) {
            const unequipResult = await myCharactersApi.actionUnequipItemMyNameActionUnequipPost({
                name: char.data.name,
                unequipSchema: { slot },
            });
            await sleep(unequipResult.data.cooldown);
            const depositResult = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.data.name,
                simpleItemSchema: { code: unequipResult.data.item.code, quantity: 1 },
            });
            await sleep(depositResult.data.cooldown);
        }
        const withdrawResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
            name: char.data.name,
            simpleItemSchema: { code: item.code, quantity: 1 },
        });
        await sleep(withdrawResult.data.cooldown);
        try {
            const equipResult = await myCharactersApi.actionEquipItemMyNameActionEquipPost({
                name: char.data.name,
                equipSchema: { code: withdrawResult.data.item.code, slot },
            });
            await sleep(equipResult.data.cooldown);
        } catch (error) {
            if (error instanceof ResponseError) {
                if (error.response.status === 485) {
                    console.log("without", withdrawResult.data.item.code);
                } else {
                    throw error;
                }
            } else {
                throw error;
            }
        }
    }
    return await getChar(char.data.name);
}

async function craft(char: CharacterResponseSchema, skill: GetAllItemsItemsGetCraftSkillEnum) {
    const craftableItems = (await itemsApi.getAllItemsItemsGet({
        craftSkill: skill,
        maxLevel: char.data[(skill + "Level") as keyof CharacterSchema] as number,
        size: 100,
    })).data;
    const bankItems = await getBankItems();

    craftableItems.sort((a, b) => {
        const aQ = getBankQuantity(bankItems, a.code);
        const bQ = getBankQuantity(bankItems, b.code);

        return aQ - bQ;
    });

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
            const freeSlots = char.data.inventory?.filter((slot) => !slot.code).length ?? 0;
            if (freeSlots < items.length + 1) {
                return;
            }
            const inventorySpace = char.data.inventoryMaxItems -
                (char.data.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0);
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
        return;
    }

    char = await moveTo(char, "bank");
    for (const item of target.ingredients) {
        try {
            const fetchResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
                name: char.data.name,
                simpleItemSchema: item,
            });
            await sleep(fetchResult.data.cooldown);
        } catch (error) {
            if (error instanceof ResponseError) {
                if (error.response.status === 461) {
                    console.log(char.data.name, item.code, 461);
                    return;
                } else if (error.response.status === 404) {
                    // someone was faster
                    console.log(char.data.name, item.code, 404);
                    return;
                }
            }
            throw error;
        }
    }

    char = await moveTo(char, "workshop", skill);

    const craftResult = await myCharactersApi.actionCraftingMyNameActionCraftingPost({
        name: char.data.name,
        craftingSchema: { code: target.code, quantity: target.quantity },
    });
    await sleep(craftResult.data.cooldown);

    char = await moveTo(char, "bank");

    for (const item of craftResult.data.details.items) {
        try {
            const deposit = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.data.name,
                simpleItemSchema: item,
            });
            await sleep(deposit.data.cooldown);
        } catch (error) {
            if (error instanceof ResponseError && error.response.status === 461) {
                console.log(char.data.name, item.code, 461);
                return;
            }
            throw error;
        }
    }
    return;
}

async function move(char: CharacterResponseSchema, x: number, y: number): Promise<CharacterResponseSchema> {
    if (char.data.x == x && char.data.y == y) {
        return char;
    }
    const movement = await myCharactersApi.actionMoveMyNameActionMovePost({
        name: char.data.name,
        destinationSchema: { x, y },
    });
    //TODO update char coords

    await sleep(movement.data.cooldown);
    return await getChar(char.data.name);
}

async function depositResourcesIfNecessary(char: CharacterResponseSchema): Promise<CharacterResponseSchema> {
    const totalItems = char.data.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    const freeSlots = char.data.inventory?.filter((slot) => !slot.code).length ?? 0;
    if (totalItems + 5 < char.data.inventoryMaxItems && freeSlots > 3) {
        return char;
    }
    return await deposit(char, "resource");
}

async function deposit(
    char: CharacterResponseSchema,
    type: GetAllItemsItemsGetTypeEnum,
): Promise<CharacterResponseSchema> {
    char = await moveTo(char, "bank");
    const items = (await itemsApi.getAllItemsItemsGet({ type, size: 100 })).data.map((item) => item.code);

    for (const slot of (char.data.inventory ?? [])) {
        if (items.includes(slot.code)) {
            const deposit = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.data.name,
                simpleItemSchema: slot,
            });
            await sleep(deposit.data.cooldown);
        }
    }
    const gold = await myCharactersApi.actionDepositBankGoldMyNameActionBankDepositGoldPost({
        name: char.data.name,
        depositWithdrawGoldSchema: { quantity: char.data.gold },
    });
    await sleep(gold.data.cooldown);

    return getChar(char.data.name);
}

async function _refresh(_char: CharacterSchema) {
    // TODO
}

async function moveTo(
    char: CharacterResponseSchema,
    contentType?: GetAllMapsMapsGetContentTypeEnum,
    contentCode?: string,
): Promise<CharacterResponseSchema> {
    const map = (await mapsApi.getAllMapsMapsGet({ contentType, contentCode })).data
        .sort((a, b) => distance(a, char.data) - distance(b, char.data))[0];
    return await move(char, map.x, map.y);
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

async function sleep(cooldown: CooldownSchema) {
    await delay(cooldown.remainingSeconds * 1000 + 100);
}

function hasCooldown(char: CharacterResponseSchema): boolean {
    const expireDate = char.data.cooldownExpiration;
    if (expireDate == null) {
        return false;
    }
    const diff = expireDate.getTime() - new Date().getTime();
    return diff > 0;
}
