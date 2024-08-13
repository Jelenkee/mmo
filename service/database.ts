import { GetAllMapsMapsGetRequest, MapsApi } from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { fetchAllItems } from "../utils.ts";
import _memoizee from "memoizee";

const mapsApi = new MapsApi(CONFIG);

export const getAllMaps = _memoizee(async (params: GetAllMapsMapsGetRequest) => {
    return await fetchAllItems((fetchParams) => mapsApi.getAllMapsMapsGet(Object.assign({}, params, fetchParams)));
}, { promise: true, maxAge: 1000 * 60 * 30, normalizer: (args) => JSON.stringify(args) });
