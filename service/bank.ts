import { MyAccountApi, SimpleItemSchema } from "../api/index.ts";
import { CONFIG } from "../constants.ts";

const myAccountApi = new MyAccountApi(CONFIG);

export async function getBankItems(): Promise<SimpleItemSchema[]> {
    return await fetchAllItems();
}

async function fetchAllItems<T>(items: T[] = [], page = 1): Promise<T[]> {
    const response = await myAccountApi.getBankItemsMyBankItemsGet({ size: 100, page });
    const data = response.data as T[];
    items = [...items, ...data];

    if ((response.page ?? page) < (response.pages ?? 0)) {
        return fetchAllItems(items, page + 1);
    }

    return items;
}
