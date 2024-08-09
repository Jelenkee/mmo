import { interval } from "delayed";
import { tick } from "./service/character.ts";
import { CHAR_NAMES, setup } from "./service/characters.ts";

if (import.meta.main) {
    await setup();

    await Promise.allSettled(CHAR_NAMES.map(async (name) => {
        for await (const _result of interval(tick, 2000, {}, name)) {
            //
        }
    }));
}
