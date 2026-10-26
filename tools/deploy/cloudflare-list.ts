type Obj = Record<string, any>;
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw Error('Cloudflare collection could not be verified'); };
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Single-response endpoints receive no page query. Metadata, when supplied, must
 * prove completeness; subscriptions require counts as well as a final page. */
export async function readCloudflareList(
  get: (path: string) => Promise<Obj>, path: string,
  mode: 'paged' | 'single' | 'single-complete' = 'paged',
): Promise<Obj[]> {
  const out: Obj[] = [];
  let expectedTotal: number | undefined, expectedPages: number | undefined, pageSize: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const query = mode === 'paged' ? (path.includes('?') ? '&' : '?') + `page=${page}&per_page=100` : '';
    const response = await get(path + query);
    if (!Array.isArray(response.result) || !response.result.every(object)) fail();
    const rows = response.result, info = response.result_info;
    out.push(...rows);
    if (info === undefined && mode === 'single') return out;
    if (!object(info) || info.page !== page || info.cursor || info.cursors?.after || info.next_page && info.next_page !== true) fail();
    if (info.count !== undefined && (!natural(info.count) || info.count !== rows.length)) fail();
    let pages: number | undefined;
    if (info.total_pages !== undefined) {
      if (!natural(info.total_pages) || info.total_pages > 100 || info.total_pages === 0 && out.length > 0) fail();
      pages = info.total_pages;
    }
    if (info.total_count !== undefined) {
      if (!natural(info.total_count) || !natural(info.per_page) || info.per_page < 1 || info.count !== rows.length) fail();
      if (expectedTotal !== undefined && expectedTotal !== info.total_count || pageSize !== undefined && pageSize !== info.per_page) fail();
      expectedTotal = info.total_count; pageSize = info.per_page;
      const countedPages = Math.ceil(info.total_count / info.per_page);
      // APIs use either 0 or 1 pages for an empty collection.
      if (pages !== undefined && pages !== countedPages && !(info.total_count === 0 && pages === 1)) fail();
      pages ??= countedPages;
      const expectedCount = Math.min(info.per_page, Math.max(0, info.total_count - (page - 1) * info.per_page));
      if (rows.length !== expectedCount) fail();
    }
    if (pages === undefined) return fail();
    if (expectedPages !== undefined && pages !== expectedPages) fail();
    expectedPages = pages;
    const done = page >= pages;
    if (info.next_page !== undefined && info.next_page !== !done) fail();
    if (mode === 'single-complete' && (expectedTotal === undefined || info.next_page !== false)) fail();
    if (mode !== 'paged' && !done) fail();
    if (done) {
      if (expectedTotal !== undefined && out.length !== expectedTotal) fail();
      return out;
    }
    if (!rows.length) fail();
  }
  return fail();
}
