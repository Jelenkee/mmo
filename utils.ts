export async function fetchAllItems<T>(
    func: (
        params: { size: number; page: number },
    ) => Promise<{ data: T[]; page: number | null; pages?: number | null }>,
    items: T[] = [],
    page = 1,
): Promise<T[]> {
    const response = await func({ size: 100, page });
    const data = response.data as T[];
    items = [...items, ...data];

    if ((response.page ?? page) < (response.pages ?? 0)) {
        return fetchAllItems(func, items, page + 1);
    }

    return items;
}

export async function asyncFilter<T>(
    arr: T[],
    predicate: (value: T, index: number, array: T[]) => Promise<boolean>,
): Promise<T[]> {
    return (await Promise.all(arr.map(async (item, i, arr2) => {
        const success = await predicate(item, i, arr2);
        return { item, success };
    }))).filter((t) => t.success)
        .map((t) => t.item);
}
