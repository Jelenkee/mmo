import { Configuration, MyCharactersApi } from "./api/index.ts";

export const CONFIG: Configuration = new Configuration({
  basePath: "https://api.artifactsmmo.com",
  headers: { Authorization: `Bearer ${Deno.env.get("TOKEN")}` },
});

export const CHAR_NAMES: string[] = [];

export async function setup() {
  const characters = await new MyCharactersApi(CONFIG)
    .getMyCharactersMyCharactersGet();
  characters.data.map((c) => c.name).forEach((n) => CHAR_NAMES.push(n));
}
