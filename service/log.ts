import { Logger, pino } from "pino";
import { CharacterSchema } from "../api/index.ts";

const logger = pino({
    level: Deno.env.get("LOGLEVEL") ?? "info",
    formatters: {
        level(label) {
            return { level: label.toUpperCase() };
        },
    },
    base: undefined,
    messageKey: "message",
    errorKey: "error",
});
const loggers = new Map();
export function getLogger(char?: CharacterSchema | string): Logger {
    if (!char) {
        return logger;
    }
    const charName = typeof char === "string" ? char : char.name;
    let childLogger = loggers.get(charName);
    if (!childLogger) {
        childLogger = logger.child({ char: charName });
        loggers.set(charName, childLogger);
    }
    return childLogger;
}
