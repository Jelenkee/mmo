import { Configuration } from "./api/index.ts";

export const CONFIG: Configuration = new Configuration({
    basePath: "https://api.artifactsmmo.com",
    headers: { Authorization: `Bearer ${Deno.env.get("TOKEN")}` },
    fetchApi: (input: string, init?: RequestInit) => {
        return fetch(input, Object.assign({}, init, { signal: AbortSignal.timeout(5000) }));
    },
});

export const MAX_LEVEL = 30;
