/** SuiteQL helpers: paged reads past the 1,000-row cap, parameter binding, mapped results. No business rules. */
export function createSuiteQL({ query, log }) {
  /** Run a query and return every row as a plain object, paging at `pageSize` (≤1000). */
  function all(sql, params = [], pageSize = 1000) {
    const paged = query.runSuiteQLPaged({ query: sql, params, pageSize });
    const rows = [];
    const ranges = paged.pageRanges || [];
    for (let i = 0; i < ranges.length; i++) {
      const page = paged.fetch({ index: ranges[i].index });
      for (const r of page.data.asMappedResults()) rows.push(r);
    }
    return rows;
  }
  /** Small result sets (lists, single rows). */
  function few(sql, params = []) { return query.runSuiteQL({ query: sql, params }).asMappedResults(); }
  function one(sql, params = []) { const r = few(sql, params); return r.length ? r[0] : null; }
  /** IN-list chunking (SuiteQL caps IN lists at 1,000). */
  function inChunks(ids, fn, size = 900) { const out = []; for (let i = 0; i < ids.length; i += size) out.push(...fn(ids.slice(i, i + size))); return out; }
  return { all, few, one, inChunks };
}
export function sqlIn(ids) { return ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)).join(',') || 'NULL'; }
export function esc(s) { return String(s).replace(/'/g, "''"); }
