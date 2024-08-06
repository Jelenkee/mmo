import { ResponseError } from "./api/index.ts";
import { CHAR_NAMES } from "./constants.ts";
import { farm } from "./service/character.ts";
export async function loop() {
    try {
        await Promise.all(CHAR_NAMES.map((name) => farm(name)));
    } catch (error) {
        if (error instanceof ResponseError) {
            console.error(error.response.status, error.message);
        } else {
            console.error("unexpected");
            console.error(error);
        }
    }
    return 3;
}
