import {
    CharacterResponseSchema,
    CharactersApi,
    ItemsApi,
    MapsApi,
    MonstersApi,
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

export async function tick(name: string) {
    try {
        const char = await getChar(name);
        const cooling = await hasCooldown(char);

        if (cooling) {
            console.log(name, "is cooling down");
            return;
        }
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

export async function getChar(name: string): Promise<CharacterResponseSchema> {
    return await charactersApi.getCharacterCharactersNameGet({ name });
}

export async function gather(char: CharacterResponseSchema) {
    const name = char.data.name;
    char = await depositResourcesIfNecessary(char);

    const maps = (await mapsApi.getAllMapsMapsGet({
        contentType: "resource",
    })).data;

    const resources = await resourcesApi.getAllResourcesResourcesGet({ size: 100 });
    const mineableResource: string[] = [];
    resources.data.filter((res) => {
        const level = (char.data as unknown as Record<string, number>)[res.skill + "Level"];
        if (level >= res.level) {
            mineableResource.push(res.code);
        }
    });

    const filteredMaps = maps.filter((map) => mineableResource.includes(map.content?.code ?? ""));
    const map = choice(filteredMaps);

    await move(char, map.x, map.y);

    const gatherResult = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name });
    await delay(gatherResult.data.cooldown.remainingSeconds * 1000);
}

export async function fight(char: CharacterResponseSchema) {
    const name = char.data.name;
    char = await depositResourcesIfNecessary(char);

    const maps = (await mapsApi.getAllMapsMapsGet({
        contentType: "monster",
    })).data;

    const monsters = await monstersApi.getAllMonstersMonstersGet({ size: 100 });
    const fightableMonsters: string[] = [];
    monsters.data.filter((res) => {
        const _charLevel = char.data.level;
        if (res.level <= 1) {
            fightableMonsters.push(res.code);
        }
    });

    const filteredMaps = maps.filter((map) => fightableMonsters.includes(map.content?.code ?? ""));
    const map = choice(filteredMaps);

    await move(char, map.x, map.y);

    const battleResult = await myCharactersApi.actionFightMyNameActionFightPost({ name });
    await delay(battleResult.data.cooldown.remainingSeconds * 1000);
}

async function move(char: CharacterResponseSchema, x: number, y: number) {
    if (char.data.x == x && char.data.y == y) {
        return;
    }
    const movement = await myCharactersApi.actionMoveMyNameActionMovePost({
        name: char.data.name,
        destinationSchema: {
            x,
            y,
        },
    });

    await delay((movement.data.cooldown.remainingSeconds + 1) * 1000);
}

async function depositResourcesIfNecessary(char: CharacterResponseSchema): Promise<CharacterResponseSchema> {
    const totalItems = char.data.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    if (totalItems + 5 < char.data.inventoryMaxItems) {
        return char;
    }
    const bankMap = (await mapsApi.getAllMapsMapsGet({ contentType: "bank" })).data[0];
    await move(char, bankMap.x, bankMap.y);
    const resourceItems = (await itemsApi.getAllItemsItemsGet({ type: "resource", size: 100 })).data.map((item) =>
        item.code
    );

    for (const slot of (char.data.inventory ?? [])) {
        if (resourceItems.includes(slot.code)) {
            const deposit = await myCharactersApi.actionDepositBankMyNameActionBankDepositPost({
                name: char.data.name,
                simpleItemSchema: slot,
            });
            await delay((deposit.data.cooldown.remainingSeconds + 1) * 1000);
        }
    }
    const gold = await myCharactersApi.actionDepositBankGoldMyNameActionBankDepositGoldPost({
        name: char.data.name,
        depositWithdrawGoldSchema: { quantity: char.data.gold },
    });
    await delay((gold.data.cooldown.remainingSeconds + 1) * 1000);
    
    return getChar(char.data.name);
}

async function hasCooldown(char: CharacterResponseSchema): Promise<boolean> {
    await delay(1);
    const expireDate = char.data.cooldownExpiration;
    if (expireDate == null) {
        return false;
    }
    const diff = expireDate.getTime() - new Date().getTime();
    return diff > 0;
}
