import { ResponseError } from "./api/index.ts";
import { CHAR_NAMES } from "./constants.ts";
import { farm, getChar, hasCooldown } from "./service/character.ts";
export async function loop() {
    try {
        await Promise.all(CHAR_NAMES.map(async (name) => {
            const char = await getChar(name);
            const cooling = await hasCooldown(char);

            if (cooling) {
                console.log(name, "is cooling down");
                return;
            }
            await farm(char);
        }));
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
