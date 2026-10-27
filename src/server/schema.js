/**
 * §3.2 — startup field probe + tolerant projection builder.
 *
 * A SELECT naming a column that does not exist kills the whole query, so every
 * optional column is probed once per container (cached) and projections are
 * built from the columns that exist. A missing optional column becomes a NULL
 * placeholder in the SELECT and is reported in `degraded` so the screen can
 * say which feature is off — it never takes the screen down.
 *
 * createSchema({ query, log, cache? }) → { probe, projection, degraded, reset }
 */
const probeCache = new Map(); // table → Map(field → boolean) — lives for the container's life (reset on every full page load)
const probedTables = new Set();

export function createSchema({ query, log, cache = null, cacheTtl = 600 }) {
  const degraded = [];

  function loadCached(table) {
    if (probeCache.has(table)) return probeCache.get(table);
    if (cache) {
      try { const raw = cache.get({ key: `schema:${table}`, loader: () => null }); if (raw) { const m = new Map(Object.entries(JSON.parse(raw))); probeCache.set(table, m); return m; } } catch (e) { /* cache is optional */ }
    }
    const m = new Map(); probeCache.set(table, m); return m;
  }
  function persist(table, m) {
    probedTables.add(table);
    if (!cache) return;
    try { cache.put({ key: `schema:${table}`, value: JSON.stringify(Object.fromEntries(m)), ttl: cacheTtl }); } catch (e) { /* optional */ }
  }
  function exists(table, fields) {
    // One query for the whole set; on failure bisect so N missing fields cost O(N log N) tiny queries, not N.
    try { query.runSuiteQL({ query: `SELECT ${fields.join(', ')} FROM ${table} WHERE ROWNUM <= 1` }); return fields.map(() => true); }
    catch (e) {
      if (fields.length === 1) { log && log.audit && log.audit({ title: 'schema probe', details: `${table}.${fields[0]} missing: ${e && e.message}` }); return [false]; }
      const mid = Math.ceil(fields.length / 2);
      return exists(table, fields.slice(0, mid)).concat(exists(table, fields.slice(mid)));
    }
  }
  /** probe(table, [field…]) → Map(field → boolean). Required fields are not probed. */
  function probe(table, fields) {
    const m = loadCached(table);
    const unknown = fields.filter((f) => !m.has(f));
    if (unknown.length) { const res = exists(table, unknown); unknown.forEach((f, i) => m.set(f, res[i])); persist(table, m); }
    return m;
  }
  /**
   * projection(table, specs) where specs = [{ field, as?, optional?, feature?, expr? }]
   * Returns { select: 'a, b AS c, NULL AS d', missing: [field…] } and records degradation.
   */
  function projection(table, specs) {
    const optional = specs.filter((s) => s.optional).map((s) => s.field);
    const have = optional.length ? probe(table, optional) : new Map();
    const parts = [], missing = [];
    for (const s of specs) {
      const alias = s.as || s.field;
      if (s.optional && have.get(s.field) === false) { parts.push(`NULL AS ${alias}`); missing.push(s.field); degrade(table, s); continue; }
      parts.push(s.expr ? `${s.expr} AS ${alias}` : (s.as ? `${s.field} AS ${s.as}` : s.field));
    }
    return { select: parts.join(', '), missing };
  }
  function degrade(table, s) {
    if (degraded.some((d) => d.table === table && d.field === s.field)) return;
    degraded.push({ table, field: s.field, feature: s.feature || null });
    log && log.error && log.error({ title: 'schema degraded', details: `${table}.${s.field} missing — feature "${s.feature || alias(s)}" is off` });
  }
  const alias = (s) => s.as || s.field;
  /** Record a feature that is off for a reason other than a missing column (a table the role cannot read). Once per feature. */
  function degradeFeature(entry) { if (!degraded.some((d) => d.table === entry.table && d.feature === entry.feature)) degraded.push({ table: entry.table, field: entry.field || '*', feature: entry.feature || null, reason: entry.reason || null }); }
  /** Forget every probe so newly created fields and records are seen: called on each full page load and by ?route=reprobe. */
  function reset() {
    probeCache.clear(); degraded.length = 0;
    if (cache) for (const t of probedTables) { try { cache.remove({ key: `schema:${t}` }); } catch (e) { /* optional */ } }
  }
  return { probe, projection, degraded, degradeFeature, reset };
}
