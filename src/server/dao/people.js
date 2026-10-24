/**
 * DAO — tenants (customers) with server-side filter/sort/page (§6.5), and the
 * relationship-field map tables (§5.5.1 rule 1: never put the field in an expression).
 */
import { CUSTOMER } from '../../shared/constants.js';
import { sqlIn, esc } from './suiteql.js';

export const TENANT_SORTS = { name: 'c.lastname, c.firstname', created: 'c.datecreated DESC', status: 'c.entitystatus', email: 'c.email' };

export function createPeopleDao({ sq, schema }) {
  const C = CUSTOMER.TYPE;
  function select() {
    return schema.projection(C, [
      { field: 'id' }, { field: 'entityid' }, { field: 'firstname' }, { field: 'lastname' }, { field: 'email' }, { field: 'phone' }, { field: 'mobilephone' },
      { field: 'stage' }, { field: 'entitystatus' }, { field: 'entitystatus', as: 'status_name', expr: 'BUILTIN.DF(c.entitystatus)' },
      { field: 'isinactive' }, { field: 'datecreated' }, { field: 'lastmodifieddate' }, { field: 'duplicate', optional: true },
      { field: CUSTOMER.PROPERTY, as: 'property' }, { field: CUSTOMER.AY, as: 'ay' }, // plain select is safe; expressions are not
      { field: 'custentity_serp_schools', as: 'school', optional: true, feature: 'school' },
      { field: 'custentity_desired_location', as: 'desired_location', optional: true, feature: 'desired location' },
      { field: 'custentity_serp_group_size', as: 'group_size', optional: true },
      { field: 'custentity_serp_house_mates', as: 'house_mates', optional: true },
      { field: 'custentity_serp_notes', as: 'notes', optional: true },
      { field: 'custentity_serp_howdid_you_hear_about_us', as: 'hear_us', optional: true, feature: 'lead source' },
      { field: 'custentity12', as: 'agent_assigned', optional: true, feature: 'agent assigned' },
      { field: 'custentity9', as: 'tour_date', optional: true }, { field: 'custentity3', as: 'tour_scheduled', optional: true },
      { field: 'custentity4', as: 'lease_sent', optional: true }, { field: 'custentity5', as: 'lease_signed', optional: true },
      { field: CUSTOMER.RR_UPLOAD_STATUS, as: 'rr_upload_status', optional: true },
    ]).select.replace(/(^|, )(?!NULL|BUILTIN)([a-z_0-9]+)/g, '$1c.$2');
  }
  /**
   * filters: { q, statusIds[], missingProperty, missingAy, propertyIds[], ayIds[], stage: 'CUSTOMER'|'LEAD'|null, includeInactive }
   * Returns { rows, total, page, pageSize }.
   */
  function tenants({ filters = {}, sort = 'name', page = 0, pageSize = 100 } = {}) {
    const where = [];
    if (!filters.includeInactive) where.push("c.isinactive = 'F'");
    if (filters.stage) where.push(`c.stage = '${esc(filters.stage)}'`);
    if (filters.statusIds && filters.statusIds.length) where.push(`c.entitystatus IN (${sqlIn(filters.statusIds)})`);
    if (filters.q) { const q = esc(String(filters.q).toLowerCase()); where.push(`(LOWER(c.firstname || ' ' || c.lastname) LIKE '%${q}%' OR LOWER(c.email) LIKE '%${q}%' OR c.phone LIKE '%${q}%' OR LOWER(c.custentity_desired_location) LIKE '%${q}%')`); }
    if (filters.missingProperty) where.push(`NOT EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id)`);
    if (filters.missingAy) where.push(`NOT EXISTS (SELECT 1 FROM ${CUSTOMER.AY_MAP} m WHERE m.mapone = c.id)`);
    if (filters.propertyIds && filters.propertyIds.length) where.push(`EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.propertyIds)}))`);
    if (filters.ayIds && filters.ayIds.length) where.push(`EXISTS (SELECT 1 FROM ${CUSTOMER.AY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.ayIds)}))`);
    // market scoping (§5.10): a tenant is in scope when any of their properties is, or when they have none (so the queue is workable)
    if (filters.scopePropertyIds) where.push(`(NOT EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id) OR EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.scopePropertyIds)})))`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = sq.one(`SELECT COUNT(*) AS n FROM ${C} c ${w}`).n;
    const order = TENANT_SORTS[sort] || TENANT_SORTS.name;
    const sql = `SELECT * FROM (SELECT ROWNUM rn, x.* FROM (SELECT ${select()} FROM ${C} c ${w} ORDER BY ${order}, c.id) x) WHERE rn > ${page * pageSize} AND rn <= ${(page + 1) * pageSize}`;
    return { rows: sq.few(sql), total: Number(total), page, pageSize };
  }
  function byIds(ids) { if (!ids.length) return []; return sq.inChunks(ids, (chunk) => sq.few(`SELECT ${select()} FROM ${C} c WHERE c.id IN (${sqlIn(chunk)})`)); }
  /** Map-table reads (the only safe way to filter on the relationship fields). */
  function propertyLinks(customerIds) { return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS customer, maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone IN (${sqlIn(chunk)})`)); }
  function ayLinks(customerIds) { return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS customer, maptwo AS ay FROM ${CUSTOMER.AY_MAP} WHERE mapone IN (${sqlIn(chunk)})`)); }
  function leaseLinks(customerIds) { return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS lease, maptwo AS customer FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE maptwo IN (${sqlIn(chunk)})`)); }
  function duplicates() {
    return sq.few(`SELECT LOWER(email) AS email, COUNT(*) AS n FROM ${C} WHERE isinactive = 'F' AND email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1`);
  }
  function statusList() { return sq.few(`SELECT key AS id, name, entitytype, inactive FROM entitystatus ORDER BY entitytype, key`); }
  function probe() { select(); }
  return { tenants, byIds, propertyLinks, ayLinks, leaseLinks, duplicates, statusList, probe };
}
