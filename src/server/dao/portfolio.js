/**
 * DAO — properties, units, leases, targets, academic years, lists. One function per query. No rules.
 * Column aliases match the fixture shape so the engine and the snapshot are interchangeable.
 */
import { LEASE, PROPERTY, UNIT, CUSTOMER, UAS, STAGE_LIST } from '../../shared/constants.js';
import { sqlIn } from './suiteql.js';

export function createPortfolioDao({ sq, schema }) {
  const P = PROPERTY.TYPE, U = UNIT.TYPE, L = LEASE.TYPE;

  function academicYears() {
    return sq.few(`SELECT id, name, isinactive, custrecord_start_date AS start_date, custrecord_serp_acad_end_date AS end_date FROM customrecord_serp_academic_yr_list ORDER BY custrecord_start_date`);
  }
  function lists() {
    const out = {};
    for (const list of [STAGE_LIST, 'customlist_ad_stage_source', 'customlist_serp_lease_type_list', 'customlist_serp_lease_status', 'customlist_lease_group_type', 'customlist_serp_hear_us_list', 'customlist830', 'customlist_serp_schools', 'customlist_serp_cities']) {
      try { out[list] = sq.few(`SELECT id, name, isinactive FROM ${list} ORDER BY id`); } catch (e) { out[list] = []; }
    }
    return out;
  }
  const PROPERTY_SPECS = () => [
      { field: 'id' }, { field: 'name' }, { field: 'parent' }, { field: 'isinactive' },
      { field: PROPERTY.CITY, as: 'city' }, { field: PROPERTY.STATE, as: 'state' },
      { field: PROPERTY.SUBSIDIARY, as: 'subsidiary' }, { field: PROPERTY.SUBSIDIARY, as: 'subsidiary_name', expr: `BUILTIN.DF(${PROPERTY.SUBSIDIARY})` },
      { field: 'custrecord_serp_property_type_cr', as: 'prop_type', optional: true, feature: 'commercial segregation' },
      { field: 'custrecord_serp_property_type_cr', as: 'prop_type_name', optional: true, expr: 'BUILTIN.DF(custrecord_serp_property_type_cr)', feature: 'commercial segregation' },
      { field: 'custrecord_serp_prop_status', as: 'prop_status', optional: true, feature: 'property status' },
      { field: 'custrecord_number_of_bedrooms', as: 'bedrooms', optional: true, feature: 'property-level bed count' },
      { field: 'custrecord_serp_prop_bed_count', as: 'bed_count', optional: true },
      { field: 'custrecord_serp_total_units', as: 'total_units', optional: true },
      { field: 'custrecord_serp_property_nick_name', as: 'nickname', optional: true, feature: 'property nicknames' },
      { field: 'lastmodified' },
    ];
  function properties() {
    const { select } = schema.projection(P, PROPERTY_SPECS());
    return sq.all(`SELECT ${select} FROM ${P} WHERE isinactive = 'F' ORDER BY id`);
  }
  const UNIT_SPECS = () => [
      { field: 'id' }, { field: 'name' }, { field: 'parent' }, { field: 'isinactive' },
      { field: 'custrecord_serp_parent_property', as: 'property' }, { field: UNIT.BEDS, as: 'beds' },
      { field: UNIT.RR_UNIT_ID, as: 'rr_unit_id', optional: true, feature: 'Rentroom unit ids' },
      { field: 'custrecord_occupied', as: 'occupied', optional: true },
      { field: 'custrecord_serp_next_available_dates', as: 'next_available', optional: true, feature: 'next available date' },
      { field: 'lastmodified' },
    ];
  function units() {
    const { select } = schema.projection(U, UNIT_SPECS());
    return sq.all(`SELECT ${select} FROM ${U} WHERE isinactive = 'F' ORDER BY id`);
  }
  /** Leases for a set of AY ids. Inactive leases are excluded here; statusless leases are NOT (§5.3). */
  const LEASE_SPECS = () => [
      { field: 'id' }, { field: 'name' }, { field: 'isinactive' },
      { field: LEASE.PROPERTY, as: 'property' }, { field: LEASE.UNIT, as: 'unit' },
      { field: 'custrecord_serp_lease_type_test', as: 'lease_type' }, { field: 'custrecord_serp_lease_type_test', as: 'lease_type_name', expr: 'BUILTIN.DF(custrecord_serp_lease_type_test)' },
      { field: LEASE.STATUS, as: 'status' }, { field: LEASE.STATUS, as: 'status_name', expr: `BUILTIN.DF(${LEASE.STATUS})` },
      { field: LEASE.AY, as: 'ay' }, { field: LEASE.AY, as: 'ay_name', expr: `BUILTIN.DF(${LEASE.AY})` },
      { field: LEASE.START, as: 'start_date' }, { field: LEASE.END, as: 'end_date' },
      { field: 'custrecord_serp_lease_duration_options', as: 'duration_months', optional: true, feature: 'duration field (term falls back to rent ÷ dates)' },
      { field: LEASE.MONTHLY_RENT, as: 'monthly_rent' }, { field: 'custrecord_serp_rent_actual_total', as: 'total_rent', optional: true, feature: 'total rent' },
      { field: LEASE.TENANT_COUNT, as: 'tenant_count', optional: true, feature: 'headcount' },
      { field: LEASE.TENANTS, as: 'tenants' },
      { field: 'custrecord_serp_lease_sent_date', as: 'sent_date', optional: true, feature: 'weekly: leases sent' },
      { field: 'custrecord_effective_date', as: 'signed_date', optional: true, feature: 'weekly: beds leased' },
      { field: 'custrecord_serp_lease_signed', as: 'signed_flag', optional: true },
      { field: 'custrecord_serp_group_type', as: 'group_type', optional: true, feature: 'group type' },
      { field: 'custrecord_rent_target_per_bed', as: 'target_per_bed', optional: true },
      { field: 'custrecord_serp_monthly_targ_rent_lease', as: 'target_monthly', optional: true },
      { field: 'custrecord_serp_watersewer_included', as: 'water_included', optional: true, feature: 'utilities' },
      { field: 'custrecord_serp_gaselectric_included', as: 'gas_included', optional: true, feature: 'utilities' },
      { field: 'custrecord_serp_additional_provisions', as: 'provisions', optional: true },
      { field: LEASE.RR_UNIT_ID, as: 'rr_unit_id', optional: true },
      { field: 'created' }, { field: 'lastmodified' },
    ];
  function leases(ayIds, { includeInactive = false } = {}) {
    const { select } = schema.projection(L, LEASE_SPECS());
    const where = [`${includeInactive ? '1=1' : "isinactive = 'F'"}`];
    if (ayIds && ayIds.length) where.push(`${LEASE.AY} IN (${sqlIn(ayIds)})`);
    return sq.all(`SELECT ${select} FROM ${L} WHERE ${where.join(' AND ')} ORDER BY id`);
  }
  const T = 'customrecord_serp_academic_yr_details';
  const TARGET_SPECS = () => [
      { field: 'id' }, { field: 'isinactive' }, { field: 'custrecord_serp_unit', as: 'unit' }, { field: 'custrecord_serp_test_units_br', as: 'property' },
      { field: 'custrecord_serp_academic_year', as: 'ay' }, { field: 'custrecord_serp_unit_number_of_beds', as: 'beds', optional: true },
      { field: 'custrecord_serp_target_rent_perbed', as: 'target_per_bed', optional: true, feature: 'target rent' },
      { field: 'custrecord_serp_target_rent_monthly', as: 'target_monthly', optional: true, feature: 'target rent' },
      { field: 'custrecord_serp_previous_year_rentbed', as: 'prev_year_per_bed', optional: true },
      { field: 'custrecord_serp_next_available_date', as: 'next_available', optional: true },
    ];
  function targets(ayIds) {
    const { select } = schema.projection(T, TARGET_SPECS());
    const where = ["isinactive = 'F'"]; if (ayIds && ayIds.length) where.push(`custrecord_serp_academic_year IN (${sqlIn(ayIds)})`);
    return sq.all(`SELECT ${select} FROM ${T} WHERE ${where.join(' AND ')} ORDER BY id`);
  }
  function subsidiaries() { return sq.few('SELECT id, name, parent FROM subsidiary ORDER BY id'); }
  function probe() { schema.projection(P, PROPERTY_SPECS()); schema.projection(U, UNIT_SPECS()); schema.projection(L, LEASE_SPECS()); schema.projection(T, TARGET_SPECS()); }
  return { academicYears, lists, properties, units, leases, targets, subsidiaries, probe };
}
