import {
    GetAllItemsItemsGetRequest,
    GetAllMapsMapsGetRequest,
    GetAllMonstersMonstersGetRequest,
    GetAllResourcesResourcesGetRequest,
    ItemsApi,
    MapsApi,
    MonstersApi,
    ResourcesApi,
} from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { fetchAllItems } from "../utils.ts";
import _memoizee from "memoizee";

const mapsApi = new MapsApi(CONFIG);
const itemsApi = new ItemsApi(CONFIG);
const resourcesApi = new ResourcesApi(CONFIG);
const monstersApi = new MonstersApi(CONFIG);

export const getAllMaps = memo(async (params?: GetAllMapsMapsGetRequest) => {
    return await fetchAllItems((fetchParams) => mapsApi.getAllMapsMapsGet(Object.assign({}, params, fetchParams)));
});

export const getAllItems = memo(async (params?: GetAllItemsItemsGetRequest) => {
    return await fetchAllItems((fetchParams) => itemsApi.getAllItemsItemsGet(Object.assign({}, params, fetchParams)));
});

export const getAllResources = memo(async (params?: GetAllResourcesResourcesGetRequest) => {
    return await fetchAllItems((fetchParams) =>
        resourcesApi.getAllResourcesResourcesGet(Object.assign({}, params, fetchParams))
    );
});

export const getAllMonsters = memo(async (params?: GetAllMonstersMonstersGetRequest) => {
    return await fetchAllItems((fetchParams) =>
        monstersApi.getAllMonstersMonstersGet(Object.assign({}, params, fetchParams))
    );
});

function memo<P, T>(func: (params?: P) => Promise<T>, maxAge?: number) {
    return _memoizee(async (params?: P) => await func(params), {
        promise: true,
        maxAge: maxAge ?? 1000 * 60 * 30,
        normalizer: (args) => JSON.stringify(args),
    });
}
