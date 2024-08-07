import {
    CharacterResponseSchema,
    CharactersApi,
    ItemsApi,
    MapsApi,
    MyCharactersApi,
    ResourcesApi,
    ResponseError,
} from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { choice } from "random";
import { delay } from "@std/async";

const myCharactersApi = new MyCharactersApi(CONFIG);
const charactersApi = new CharactersApi(CONFIG);
const mapsApi = new MapsApi(CONFIG);
const resourcesApi = new ResourcesApi(CONFIG);
const itemsApi = new ItemsApi(CONFIG);

export async function getChar(name: string): Promise<CharacterResponseSchema> {
    return await charactersApi.getCharacterCharactersNameGet({ name });
}

export async function farm(char: CharacterResponseSchema) {
    const name = char.data.name;

    const totalItems = char.data.inventory?.map((slot) => slot.quantity).reduce((a, c) => a + c, 0) ?? 0;
    if (totalItems + 5 >= char.data.inventoryMaxItems) {
        await depositResources(char);
        char = await getChar(char.data.name);
    }

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

    try {
        await move(char, map.x, map.y);

        const gather = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name });
        console.log(name, "got", gather.data.details.items[0]?.quantity, gather.data.details.items[0]?.code);
        await delay(gather.data.cooldown.remainingSeconds * 1000);
    } catch (error) {
        if (error instanceof ResponseError) {
            if (error.response.status == 493) {
                console.log(name, "is too weak");
                return;
            }
            console.log(error);
            throw error;
        }
    }
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

async function depositResources(char: CharacterResponseSchema) {
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
}

export async function hasCooldown(char: CharacterResponseSchema): Promise<boolean> {
    await delay(1);
    const expireDate = char.data.cooldownExpiration;
    if (expireDate == null) {
        return false;
    }
    const diff = expireDate.getTime() - new Date().getTime();
    return diff > 0;
}
