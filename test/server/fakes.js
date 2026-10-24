/** Minimal in-memory fakes for the N/* modules the server needs. */
export function fakeRuntime({ userId = 42, roleId = 1000, roleName = 'customrole_leasing', params = {}, usage = 1000 } = {}) {
  let remaining = usage;
  return {
    getCurrentUser: () => ({ id: userId, role: roleId, roleId: roleName, name: 'Test User', email: 't@example.invalid' }),
    getCurrentScript: () => ({ getParameter: ({ name }) => (name in params ? params[name] : null), getRemainingUsage: () => remaining }),
    spend: (n) => { remaining -= n; },
  };
}
/** A tiny SQL "engine": you register handlers by regex over the SQL text. */
export function fakeSuiteQL(handlers = []) {
  const calls = [];
  function run(sql, params) {
    calls.push({ sql, params });
    for (const [re, fn] of handlers) { const m = re.exec(sql); if (m) return fn(m, params, sql); }
    throw new Error(`fake SuiteQL: no handler for: ${sql.slice(0, 120)}`);
  }
  const sq = {
    all: (sql, params) => run(sql, params), few: (sql, params) => run(sql, params),
    one: (sql, params) => { const r = run(sql, params); return r.length ? r[0] : null; },
    inChunks: (ids, fn) => fn(ids), calls,
  };
  return sq;
}
/** In-memory records: store[type][id] = { fields }. Emulates the lease Tenants wipe on AY/Property change. */
export function fakeRecordStore(initial = {}, { wipeTenantsOn = new Set(['custrecord_serp_lease_academic_year', 'custrecord_property']) } = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  let nextId = 90000;
  const saves = [];
  const record = {
    load: ({ type, id }) => {
      const row = store[type] && store[type][id];
      if (!row) throw new Error(`record not found ${type}:${id}`);
      const pending = {};
      return {
        getValue: ({ fieldId }) => (fieldId in pending ? pending[fieldId] : row[fieldId]),
        setValue: ({ fieldId, value }) => { pending[fieldId] = value; },
        save: () => {
          const wipe = type === 'customrecord_serp_lease_record' && Object.keys(pending).some((f) => wipeTenantsOn.has(f));
          Object.assign(row, pending);
          if (wipe) row.custrecord_serp_tenants_ = []; // NetSuite drops the filtered multiselect on re-source
          row.lastmodified = `v${saves.length + 1}`; saves.push({ type, id, fields: { ...pending } }); return id;
        },
      };
    },
    create: ({ type }) => { const pending = {}; return { setValue: ({ fieldId, value }) => { pending[fieldId] = value; }, save: () => { const id = ++nextId; store[type] = store[type] || {}; store[type][id] = { ...pending, lastmodified: 'v1' }; saves.push({ type, id, fields: { ...pending }, created: true }); return id; } }; },
  };
  return { record, store, saves };
}
export const fakeLog = { audit() {}, error() {}, debug() {}, emergency() {} };
export function fakeSchema(missing = new Set()) {
  return { probe: (table, fields) => new Map(fields.map((f) => [f, !missing.has(`${table}.${f}`)])), projection: () => ({ select: '*', missing: [] }), degraded: [] };
}
