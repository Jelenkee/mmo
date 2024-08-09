import { Configuration } from "./api/index.ts";

export const CONFIG: Configuration = new Configuration({
    basePath: "https://api.artifactsmmo.com",
    headers: { Authorization: `Bearer ${Deno.env.get("TOKEN")}` },
});
