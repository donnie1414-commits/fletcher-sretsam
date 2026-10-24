/** §6.3 — append-only, timestamped note thread per pipeline row (customrecord_ad_uas_note), plus the legacy notes field. */
import { toISO } from '../../shared/rules/dates.js';
export function routeNotes(ctx) {
  const rowId = String(ctx.params.row || '');
  if (!rowId) return { error: 'row required', meta: { status: 400 } };
  const row = ctx.sq.one(`SELECT id, custrecord_ad_uas_property AS property, custrecord_ad_uas_notes AS notes FROM customrecord_ad_unit_ay_status WHERE id = ?`, [Number(rowId)]);
  if (!row) return { error: 'row not found', meta: { status: 404 } };
  if (!ctx.inScope(ctx.marketOfProperty(row.property))) return { error: 'outside your markets', meta: { status: 403 } };
  const notes = ctx.dao.pipeline.notes([rowId]).map((n) => ({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ''), text: n.text || '', mentions: n.mentions || null }));
  return { rowId, legacy: row.notes || null, notes };
}
