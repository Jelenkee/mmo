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
