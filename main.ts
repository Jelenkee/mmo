import { setup } from "./constants.ts";
import { interval } from "delayed";
import { loop } from "./loop.ts";

if (import.meta.main) {
    await setup();

    for await (const _result of interval(loop, 4000)) {
        //
    }
}
