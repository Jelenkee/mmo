import { CharacterSchema, GetAllItemsItemsGetCraftSkillEnum, MyCharactersApi } from "../api/index.ts";
import { CONFIG } from "../constants.ts";

export const CHAR_NAMES: string[] = [];

const myCharactersApi = new MyCharactersApi(CONFIG);

const skillMap: Record<GetAllItemsItemsGetCraftSkillEnum, string> = {} as Record<
    GetAllItemsItemsGetCraftSkillEnum,
    string
>;

export async function setup() {
    const characters = await myCharactersApi.getMyCharactersMyCharactersGet();
    characters.data.map((c) => c.name).forEach((n) => CHAR_NAMES.push(n));

    const skills = Object.values(GetAllItemsItemsGetCraftSkillEnum);
    for (const skill of skills) {
        const char = bestCharFor(characters.data, skill);
        if (char) {
            skillMap[skill] = char.name;
        }
    }
    for (const skill of skills) {
        if (skillMap[skill]) {
            continue;
        }
        for (const char of charactersFor(characters.data, skill)) {
            if (!Object.values(skillMap).includes(char.name)) {
                skillMap[skill] = char.name;
            }
        }
    }
    for (const skill of skills) {
        if (skillMap[skill]) {
            continue;
        }
        for (const char of charactersFor(characters.data, skill)) {
            skillMap[skill] = char.name;
        }
    }
}

export function getMostSkilledChar(skill: GetAllItemsItemsGetCraftSkillEnum): string {
    return skillMap[skill];
}

function bestCharFor(characters: CharacterSchema[], skill: GetAllItemsItemsGetCraftSkillEnum): CharacterSchema | null {
    const chars = characters.map((c) => {
        return { c: c, lev: lev(c, skill) };
    }).toSorted((a, b) => {
        return b.lev - a.lev;
    });
    if (chars[0].lev !== chars[1].lev) {
        return chars[0].c;
    }
    return null;
}

function charactersFor(characters: CharacterSchema[], skill: GetAllItemsItemsGetCraftSkillEnum): CharacterSchema[] {
    return characters.toSorted((a, b) => {
        return lev(b, skill) - lev(a, skill);
    });
}

function lev(char: CharacterSchema, skill: GetAllItemsItemsGetCraftSkillEnum): number {
    const level = char[(skill + "Level") as keyof CharacterSchema] as number;
    const xp = char[(skill + "Xp") as keyof CharacterSchema] as number;
    const maxxp = char[(skill + "MaxXp") as keyof CharacterSchema] as number;

    return level + (xp / maxxp);
}
