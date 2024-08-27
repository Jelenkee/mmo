import { Configuration } from "./api/index.ts";
import { getLogger } from "./service/log.ts";

export const CONFIG: Configuration = new Configuration({
    basePath: "https://api.artifactsmmo.com",
    headers: { Authorization: `Bearer ${Deno.env.get("TOKEN")}` },
    fetchApi: async (input: string, init?: RequestInit) => {
        let response;
        try {
            response = await fetch(input, Object.assign({}, init, { signal: AbortSignal.timeout(5000) }));
            return response;
        } finally {
            getLogger().trace({ method: init?.method ?? "GET", url: input, status: response?.status });
        }
    },
});

export const MAX_LEVEL = 35;
