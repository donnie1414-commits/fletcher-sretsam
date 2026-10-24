/**
 * §5.8 — Non-student segregation. Reads a property-type FIELD when one exists
 * (SEGMENT_FIELD_ID), otherwise the hardcoded id lists. This is the one swap
 * point: when the field is created, set SEGMENT_FIELD_ID in constants.js and
 * map its values below in SEGMENT_FIELD_VALUES — nothing else changes.
 */
import { SEGMENTS, SEGMENT_FIELD_ID, SEGMENT_PROPERTY_IDS, normLabel } from '../constants.js';

/**
 * Field value → segment. "Residential" (the live default) deliberately has NO entry:
 * it falls through to the id lists and then to STUDENT. Only values that positively
 * identify a non-student segment are mapped.
 */
const SEGMENT_FIELD_VALUES = {
  'short-term rental': 'STR', 'short term rental': 'STR', 'str': 'STR', 'airbnb': 'STR',
  'commercial': 'COMMERCIAL', 'office': 'COMMERCIAL', 'land': 'COMMERCIAL', 'retail': 'COMMERCIAL', 'parking': 'COMMERCIAL',
  'non-student': 'NON_STUDENT', 'non student': 'NON_STUDENT', 'market rate': 'NON_STUDENT',
};

export function segmentOf(property, overrides = SEGMENT_PROPERTY_IDS) {
  if (!property) return SEGMENTS.STUDENT.key;
  if (SEGMENT_FIELD_ID && property.segmentField != null && property.segmentField !== '') {
    const k = SEGMENT_FIELD_VALUES[normLabel(property.segmentField)];
    if (k) return k;
  }
  const id = String(property.id);
  for (const key of Object.keys(overrides)) if (overrides[key].map(String).includes(id)) return key;
  return SEGMENTS.STUDENT.key;
}
export function segmentMeta(key) { return SEGMENTS[key] || SEGMENTS.STUDENT; }
