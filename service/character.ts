import {
    CharacterMovementResponseSchema,
    CharactersApi,
    MapsApi,
    MyCharactersApi,
    ResponseError,
} from "../api/index.ts";
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

    if (cooldown > 0) {
        //console.log(name, "is cooling down", cooldown);
        //return;
    }
    //console.log(name, map.content?.code, map.x, map.y);
    try {
        let res: CharacterMovementResponseSchema = null as unknown as CharacterMovementResponseSchema;
        try {
            res = await myCharactersApi.actionMoveMyNameActionMovePost({
                name,
                destinationSchema: {
                    x: map.x,
                    y: map.y,
                },
            });
            console.log("moved", name);
        } catch (error) {
            if (error instanceof ResponseError) {
                if (error.response.status == 499) {
                    console.log(name, "is chilling");
                    return;
                }
            }
        }

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
}

async function getCooldown(name: string): Promise<number> {
    return await charactersApi.getCharacterCharactersNameGet({ name })
        .then((r) => r.data.cooldown);
}
