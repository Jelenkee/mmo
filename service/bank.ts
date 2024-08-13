import { MyAccountApi, SimpleItemSchema } from "../api/index.ts";
import { CONFIG } from "../constants.ts";
import { fetchAllItems } from "../utils.ts";

const myAccountApi = new MyAccountApi(CONFIG);

export async function getBankItems(): Promise<SimpleItemSchema[]> {
    return await fetchAllItems((params) => myAccountApi.getBankItemsMyBankItemsGet(params));
}
