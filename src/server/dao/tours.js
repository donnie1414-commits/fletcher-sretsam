/**
 * DAO — tours are NetSuite Events (calendarevent) organised by the agent, with the three custom fields from the
 * setup checklist when they exist (unit link, outcome, academic year). The integration role cannot read events at
 * all; the Suitelet runs as the signed-in user, whose leasing role can. If the table is not readable the feature
 * degrades to "off" with a reason, never an error page.
 */
import { TOUR } from '../../shared/constants.js';
import { sqlIn, esc } from './suiteql.js';

export function createToursDao({ sq, schema, log }) {
  const T = TOUR.TYPE;
  let unavailable = null;
  function fields() { const m = schema.probe(T, [TOUR.UNIT, TOUR.OUTCOME, TOUR.AY]); return { unit: m.get(TOUR.UNIT) !== false, outcome: m.get(TOUR.OUTCOME) !== false, ay: m.get(TOUR.AY) !== false }; }
  function select() {
    return schema.projection(T, [
      { field: 'id' }, { field: 'title' }, { field: 'startdate' }, { field: 'starttime' }, { field: 'endtime' }, { field: 'organizer' }, { field: 'organizer', as: 'organizer_name', expr: 'BUILTIN.DF(organizer)' },
      { field: 'status' }, { field: 'location' }, { field: 'message' }, { field: 'company' }, { field: 'company', as: 'company_name', expr: 'BUILTIN.DF(company)' }, { field: 'lastmodifieddate' },
      { field: TOUR.UNIT, as: 'unit', optional: true, feature: 'tours: unit link' },
      { field: TOUR.OUTCOME, as: 'outcome', optional: true, feature: 'tours: outcome' },
      { field: TOUR.AY, as: 'ay', optional: true, feature: 'tours: academic year' },
    ]).select;
  }
  /** list({ from, to, organizerId, customerIds }) → raw rows, oldest first. Dates are ISO strings. Unit / AY filtering happens on the rows. */
  function list(f = {}) {
    if (unavailable) return [];
    const where = [];
    if (f.from) where.push(`startdate >= TO_DATE('${esc(f.from)}', 'YYYY-MM-DD')`);
    if (f.to) where.push(`startdate <= TO_DATE('${esc(f.to)}', 'YYYY-MM-DD')`);
    if (f.organizerId) where.push(`organizer = ${Number(f.organizerId)}`);
    // The unit and academic-year fields are multi-selects: never filtered in SQL (a multi-select in a WHERE is unreliable); callers filter the rows.
    const run = (extra) => sq.few(`SELECT ${select()} FROM ${T} ${[...where, ...extra].length ? `WHERE ${[...where, ...extra].join(' AND ')}` : ''} ORDER BY startdate, starttime, id`);
    try {
      if (f.customerIds) { if (!f.customerIds.length) return []; return sq.inChunks(f.customerIds, (c) => run([`company IN (${sqlIn(c)})`])); }
      return run([]);
    } catch (e) {
      unavailable = (e && e.message) || String(e);
      schema.degradeFeature({ table: T, feature: 'tours', reason: 'calendar events are not readable by this role' });
      log && log.error && log.error({ title: 'tours unavailable', details: unavailable });
      return [];
    }
  }
  function probe() { fields(); }
  return { list, fields, probe, get unavailable() { return unavailable; } };
}
/** "9:00 am", "09:00", "9:00:00 PM", a Date → "HH:MM" (24h) or null. SuiteQL hands time-of-day back in the account's format. */
export function hhmm(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(String(v));
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] || 0); const ap = m[3] ? m[3][0].toLowerCase() : null;
  if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
export function addMinutes(hm, n) { if (!hm) return null; const [h, m] = hm.split(':').map(Number); const t = (h * 60 + m + n + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
