import { interval } from "delayed";
import { tick } from "./service/character.ts";
import { CHAR_NAMES, setup } from "./service/characters.ts";
import { getLogger } from "./service/log.ts";

if (import.meta.main) {
    getLogger().info("Starting app");
    await setup();

    await Promise.allSettled(CHAR_NAMES.map(async (name) => {
        let time = new Date();
        for await (
            const _result of interval(() => {
                time = new Date();
                getLogger(name).debug("Starting turn");
                return tick(name);
            }, 2000)
        ) {
            getLogger(name).debug(`Finished turn in ${new Date().getTime() - time.getTime()} ms`);
        }
    }));
}
