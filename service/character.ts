import { CharactersApi, MapsApi, MyCharactersApi, ResponseError } from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { choice } from "random";
import { delay } from "@std/async";

const myCharactersApi = new MyCharactersApi(CONFIG);
const charactersApi = new CharactersApi(CONFIG);
const mapsApi = new MapsApi(CONFIG);

export async function farm(name: string) {
    const maps = await mapsApi.getAllMapsMapsGet({
        contentType: "resource",
    });
    const map = choice(maps.data);
    const cooldown = await getCooldown(name);
    try {
        console.log(name, cooldown);

        const res = await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name });
        console.log(name,"remain",res.data.cooldown.remainingSeconds,res.data.details.items[0]);
        
    } catch (_error) {
        // nothing
    }

    if (cooldown > 0) {
        console.log(name, "is cooling down", cooldown);
        return;
    }
    console.log(name, map.content?.code, map.x, map.y);
    try {
        const res = await myCharactersApi.actionMoveMyNameActionMovePost({
            name,
            destinationSchema: {
                x: map.x,
                y: map.y,
            },
        });
        console.log("moved", name);

        await delay((res.data.cooldown.remainingSeconds + 1) * 1000);
        await myCharactersApi.actionGatheringMyNameActionGatheringPost({ name });
        console.log(name, "got", map.content?.code);
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
    console.log("finish", name);
}

async function getCooldown(name: string): Promise<number> {
    return await charactersApi.getCharacterCharactersNameGet({ name })
        .then((r) => r.data.cooldown);
}
