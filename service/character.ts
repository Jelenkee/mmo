import {
    CharacterResponseSchema,
    CharactersApi,
    CooldownSchema,
    ItemsApi,
    MapsApi,
    MonstersApi,
    MyAccountApi,
    MyCharactersApi,
    ResourcesApi,
    ResponseError,
} from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { choice, randInt } from "random";
import { delay } from "@std/async";

const myCharactersApi = new MyCharactersApi(CONFIG);
const charactersApi = new CharactersApi(CONFIG);
const mapsApi = new MapsApi(CONFIG);
const resourcesApi = new ResourcesApi(CONFIG);
const itemsApi = new ItemsApi(CONFIG);
const monstersApi = new MonstersApi(CONFIG);
const myAccountApi = new MyAccountApi(CONFIG);

export async function tick(name: string) {
    try {
        let char = await getChar(name);
        const cooling = await hasCooldown(char);

        if (cooling) {
            console.log(name, "is cooling down");
            return;
        }
        char = await depositResourcesIfNecessary(char);

        await cook(char);
        char = await getChar(name);
        const select = randInt(1, 10);
        if (select >= 8) {
            await fight(char);
        } else {
            await gather(char);
        }
    } catch (error) {
        if (error instanceof ResponseError) {
            console.error(
                error.response.status,
                error.message,
                await error.response.json().catch((_) => error.response.text()),
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

async function gather(char: CharacterResponseSchema) {
    const name = char.data.name;

    const maps = (await mapsApi.getAllMapsMapsGet({
        contentType: "resource",
    })).data;

    const resources = await resourcesApi.getAllResourcesResourcesGet({ size: 100 });
    const mineableResource: string[] = [];
    resources.data.filter((res) => {
        const charLevel = (char.data as unknown as Record<string, number>)[res.skill + "Level"];
        if (charLevel >= res.level) {
            mineableResource.push(res.code);
        }
    });

    const filteredMaps = maps.filter((map) => mineableResource.includes(map.content?.code ?? ""));
    const map = choice(filteredMaps);

    char = await move(char, map.x, map.y);

    const gatherResult = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name });
    await sleep(gatherResult.data.cooldown);
}

async function fight(char: CharacterResponseSchema) {
    const name = char.data.name;

    const maps = (await mapsApi.getAllMapsMapsGet({
        contentType: "monster",
    })).data;

    const monsters = await monstersApi.getAllMonstersMonstersGet({ size: 100 });
    const fightableMonsters: string[] = [];
    monsters.data.filter((res) => {
        if (res.level <= 1) {
            fightableMonsters.push(res.code);
        }
    });

    const filteredMaps = maps.filter((map) => fightableMonsters.includes(map.content?.code ?? ""));
    const map = choice(filteredMaps);

    char = await move(char, map.x, map.y);

    const battleResult = await myCharactersApi.actionFightMyNameActionFightPost({ name });
    await sleep(battleResult.data.cooldown);
}

async function cook(char: CharacterResponseSchema) {
    const cookableItems = (await itemsApi.getAllItemsItemsGet({
        craftSkill: "cooking",
        maxLevel: char.data.cookingLevel,
        size: 100,
    })).data;
    const bankItems = (await myAccountApi.getBankItemsMyBankItemsGet({ size: 100 })).data;

    cookableItems.sort((a, b) => {
        const aQ = bankItems.filter((i) => i.code == a.code).map((i) => i.quantity)[0] ?? 0;
        const bQ = bankItems.filter((i) => i.code == b.code).map((i) => i.quantity)[0] ?? 0;

        return aQ - bQ;
    });

    const target = cookableItems
        .filter((item) => {
            const quantity = bankItems.filter((i) => i.code == item.code).map((i) => i.quantity)[0] ?? 0;
            return quantity < 100;
        })
        .filter((i) => {
            if (i.craft == null) {
                return false;
            }
            const items = i.craft?.items ?? [];
            if (items.length == 0) {
                return false;
            }
            return items.every((item) => {
                const q = bankItems.filter((ii) => ii.code == item.code)[0]?.quantity ?? 0;
                return q >= item.quantity;
            });
        }).at(0);

    if (target == null) {
        return;
    }

    char = await moveToBank(char);
    for (const item of target.craft?.items ?? []) {
        try {
            const fetchResult = await myCharactersApi.actionWithdrawBankMyNameActionBankWithdrawPost({
                name: char.data.name,
                simpleItemSchema: item,
            });
            await sleep(fetchResult.data.cooldown);
        } catch (error) {
            if (error instanceof ResponseError && error.response.status === 461) {
                console.log(char.data.name, item.code, 461);
                return;
            }
            throw error;
        }
    }

    const map = (await mapsApi.getAllMapsMapsGet({
        contentType: "workshop",
        contentCode: "cooking",
    })).data[0];
    char = await move(char, map.x, map.y);
    const craftResult = await myCharactersApi.actionCraftingMyNameActionCraftingPost({
        name: char.data.name,
        craftingSchema: { code: target.code, quantity: 1 },
    });
    await sleep(craftResult.data.cooldown);

    char = await moveToBank(char);

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

    await sleep(movement.data.cooldown);
    return await getChar(char.data.name);
}

async function depositResourcesIfNecessary(char: CharacterResponseSchema): Promise<CharacterResponseSchema> {
    const totalItems = char.data.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    if (totalItems + 5 < char.data.inventoryMaxItems) {
        return char;
    }
    await moveToBank(char);
    const resourceItems = (await itemsApi.getAllItemsItemsGet({ type: "resource", size: 100 })).data.map((item) =>
        item.code
    );

    for (const slot of (char.data.inventory ?? [])) {
        if (resourceItems.includes(slot.code)) {
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

async function moveToBank(char: CharacterResponseSchema): Promise<CharacterResponseSchema> {
    const bankMap = (await mapsApi.getAllMapsMapsGet({ contentType: "bank" })).data[0];
    return await move(char, bankMap.x, bankMap.y);
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
