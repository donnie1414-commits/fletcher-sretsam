/** DAO — pipeline stage rows, notes, stage log (§5.4). No rules. */
import { UAS, UAS_NOTE } from '../../shared/constants.js';
import { sqlIn } from './suiteql.js';

export function createPipelineDao({ sq, schema }) {
  const SPECS = () => [
      { field: 'id' }, { field: 'name' }, { field: 'isinactive' },
      { field: UAS.UNIT, as: 'unit' }, { field: UAS.PROPERTY, as: 'property' }, { field: UAS.AY, as: 'ay' },
      { field: UAS.STAGE, as: 'stage' }, { field: UAS.STAGE, as: 'stage_name', expr: `BUILTIN.DF(${UAS.STAGE})` },
      { field: UAS.MANUAL_STAGE, as: 'manual_stage', optional: true, feature: 'manual stage memory' },
      { field: UAS.STAGE_SOURCE, as: 'stage_source', optional: true, feature: 'stage source' },
      { field: UAS.STAGE_SOURCE, as: 'stage_source_name', optional: true, expr: `BUILTIN.DF(${UAS.STAGE_SOURCE})` },
      { field: UAS.STAGE_DATE, as: 'stage_date', optional: true, feature: 'days in stage' },
      { field: UAS.LEASE, as: 'lease', optional: true, feature: 'linked lease' },
      { field: UAS.LAST_OFFER, as: 'last_offer', optional: true, feature: 'last offered rent' },
      { field: UAS.FOLLOWUP, as: 'followup', optional: true, feature: 'follow-up dates' },
      { field: UAS.NOTES, as: 'notes', optional: true },
      { field: UAS.EXPECTED_TENANTS, as: 'expected_tenants', optional: true, feature: 'expected tenants' },
      { field: UAS.LEASE_TERMS, as: 'lease_terms', optional: true, feature: 'lease dialog terms shadow' },
      { field: 'lastmodified' }, { field: 'lastmodifiedby' },
    ];
  function stageRows(ayIds) {
    const { select, missing } = schema.projection(UAS.TYPE, SPECS());
    const where = ["isinactive = 'F'"]; if (ayIds && ayIds.length) where.push(`${UAS.AY} IN (${sqlIn(ayIds)})`);
    return { rows: sq.all(`SELECT ${select} FROM ${UAS.TYPE} WHERE ${where.join(' AND ')} ORDER BY id`), missing };
  }
  function notes(rowIds) {
    if (!rowIds.length) return [];
    return sq.inChunks(rowIds, (chunk) => sq.few(`SELECT id, custrecord_ad_note_status AS status_row, custrecord_ad_note_text AS text, custrecord_ad_note_date AS note_date, custrecord_ad_note_author AS author, BUILTIN.DF(custrecord_ad_note_author) AS author_name, custrecord_ad_note_mentions AS mentions, created FROM ${UAS_NOTE.TYPE} WHERE isinactive = 'F' AND custrecord_ad_note_status IN (${sqlIn(chunk)}) ORDER BY created, id`));
  }
  /** Every note for an academic year, oldest first (the thread starts at zero rows and grows slowly; one query beats 1,400). */
  function notesForAy(ayId) {
    if (!ayId) return [];
    try { return sq.all(`SELECT n.id, n.custrecord_ad_note_status AS status_row, n.custrecord_ad_note_text AS text, n.custrecord_ad_note_date AS note_date, n.custrecord_ad_note_author AS author, BUILTIN.DF(n.custrecord_ad_note_author) AS author_name, n.custrecord_ad_note_mentions AS mentions, n.created FROM ${UAS_NOTE.TYPE} n JOIN ${UAS.TYPE} s ON s.id = n.custrecord_ad_note_status WHERE n.isinactive = 'F' AND s.isinactive = 'F' AND s.${UAS.AY} IN (${sqlIn([ayId])}) ORDER BY n.created, n.id`); }
    catch (e) { return []; }
  }
  function stageLog(rowIds) {
    if (!rowIds.length) return [];
    return sq.inChunks(rowIds, (chunk) => sq.few(`SELECT id, custrecord_ad_log_status AS status_row, custrecord_ad_log_from AS from_stage, custrecord_ad_log_to AS to_stage, custrecord_ad_log_source AS source, custrecord_ad_log_user AS user_id, custrecord_ad_log_date AS log_date FROM customrecord_ad_uas_stage_log WHERE custrecord_ad_log_status IN (${sqlIn(chunk)}) ORDER BY id`));
  }
  function rowVersion(id) { return sq.one(`SELECT id, lastmodified, ${UAS.STAGE} AS stage, ${UAS.STAGE_SOURCE} AS stage_source FROM ${UAS.TYPE} WHERE id = ?`, [Number(id)]); }
  function probe() { schema.projection(UAS.TYPE, SPECS()); }
  return { stageRows, notes, notesForAy, stageLog, rowVersion, probe };
}
