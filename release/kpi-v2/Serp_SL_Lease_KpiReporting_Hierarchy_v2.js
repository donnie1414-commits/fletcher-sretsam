/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/query', 'N/search', 'N/record', 'N/ui/serverWidget', 'N/runtime', 'N/url', 'N/log', './Serp_Lease_KpiReporting_Hierarchy_LIB_v2'],
	(query, search, record, serverWidget, runtime, url, log, engine) => {

	const LEASE_RECORD = 'customrecord_serp_lease_record';

	const SQL = {
		academicYears: `
			SELECT id, name,
				TO_CHAR(custrecord_start_date, 'YYYY-MM-DD') AS start_date,
				TO_CHAR(custrecord_serp_acad_end_date, 'YYYY-MM-DD') AS end_date
			FROM customrecord_serp_academic_yr_list
			WHERE isinactive = 'F'
			ORDER BY name`,
		subsidiaries: `
			SELECT id, name, parent
			FROM subsidiary
			ORDER BY id`,
		properties: `
			SELECT id, name, parent,
				custrecord_serp_prop_city AS city,
				custrecord_serp_proj_subsidiary AS subsidiary,
				custrecord_number_of_bedrooms AS bedrooms
			FROM customrecord_serp_property_record
			WHERE isinactive = 'F'
			ORDER BY id`,
		records: `
			SELECT id, name, parent,
				custrecord_serp_parent_property AS property_id,
				custrecord_serp_number_of_beds AS beds
			FROM customrecord_serp_units_bedrooms
			WHERE isinactive = 'F'
			ORDER BY id`,
		leases: `
			SELECT id, name,
				custrecord_property AS property_id,
				custrecord_unitsbedroom AS unit_id,
				BUILTIN.DF(custrecord_unitsbedroom) AS unit_name,
				custrecord_serp_lease_type_test AS lease_type,
				custrecord_serp_number_of_tenants AS tenants,
				custrecord_monthly_actual_rent AS monthly_rent,
				custrecord_serp_rent_actual_total AS total_rent,
				custrecord_serp_lease_duration_options AS months,
				TO_CHAR(custrecord_serp_lease_start_date, 'YYYY-MM-DD') AS start_date,
				TO_CHAR(custrecord_serp_lease_end_date, 'YYYY-MM-DD') AS end_date,
				custrecord_serp_lease_academic_year AS ay,
				custrecord_serp_lease_status AS status,
				TO_CHAR(custrecord_effective_date, 'YYYY-MM-DD') AS signed_date,
				TO_CHAR(custrecord_serp_lease_sent_date, 'YYYY-MM-DD') AS sent_date,
				TO_CHAR(created, 'YYYY-MM-DD HH24:MI') AS created
			FROM customrecord_serp_lease_record
			WHERE isinactive = 'F'
			ORDER BY id`,
		targets: `
			SELECT id,
				custrecord_serp_academic_year AS ay,
				custrecord_serp_unit AS unit_id,
				custrecord_serp_test_units_br AS property_id,
				custrecord_serp_unit_number_of_beds AS beds,
				custrecord_serp_target_rent_monthly AS target_monthly,
				custrecord_serp_target_rent_perbed AS target_bed,
				custrecord_serp_settle_rent_monthly AS settle_monthly,
				custrecord_serp_settle_rent_perbed AS settle_bed,
				custrecord_serp_previous_year_rentbed AS prev_rent_bed
			FROM customrecord_serp_academic_yr_details
			WHERE isinactive = 'F'
				AND custrecord_serp_academic_year = ?
			ORDER BY id`,
		inactivations: `
			SELECT sn.recordid AS id,
				l.name,
				l.custrecord_property AS property_id,
				l.custrecord_unitsbedroom AS unit_id,
				BUILTIN.DF(l.custrecord_unitsbedroom) AS unit_name,
				l.custrecord_serp_lease_type_test AS lease_type,
				l.custrecord_serp_lease_academic_year AS ay,
				l.custrecord_serp_lease_status AS status,
				l.custrecord_serp_number_of_tenants AS tenants,
				l.custrecord_monthly_actual_rent AS monthly_rent,
				l.isinactive AS inactive_now,
				TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI') AS changed,
				BUILTIN.DF(sn.name) AS changed_by
			FROM systemnote sn
			JOIN customrecord_serp_lease_record l ON l.id = sn.recordid
			WHERE sn.recordtypeid = (SELECT internalid FROM customrecordtype WHERE scriptid = 'CUSTOMRECORD_SERP_LEASE_RECORD')
				AND sn.field = 'CUSTOMRECORDENTRY.BINACTIVE'
				AND sn.newvalue = 'T'
			ORDER BY sn.date DESC`,
		tenants: `
			SELECT m.mapone || '-' || m.maptwo AS id,
				m.mapone AS lease_id,
				m.maptwo AS tenant_id,
				l.custrecord_serp_lease_academic_year AS ay,
				c.entityid AS tenant_number,
				c.altname AS tenant_name,
				c.isinactive AS tenant_inactive,
				c.email AS tenant_email
			FROM map_customrecord_serp_lease_record_custrecord_serp_tenants_ m
			JOIN customer c ON c.id = m.maptwo
			JOIN customrecord_serp_lease_record l ON l.id = m.mapone
			WHERE l.isinactive = 'F'
				AND l.custrecord_serp_lease_academic_year = ?
			ORDER BY m.mapone, m.maptwo`,
		// One row per status record for the academic year, with the lease the User Event based the stage on.
		// The grid's rows are NOT built from this: they come from the inventory leaves (engine.pipelineUnits) so the
		// denominator is identical to Summary's. This only carries the status values, keyed by unit.
		// "s.id AS id" matters: runQuery's paging check keys on row.id, so aliasing it to status_id would quietly
		// turn that check off.
		unitStatus: `
			SELECT s.id AS id,
				s.custrecord_ad_uas_unit AS unit_id,
				s.custrecord_ad_uas_stage AS stage_id,
				s.custrecord_ad_uas_manual_stage AS manual_stage_id,
				s.custrecord_ad_uas_stage_source AS stage_source_id,
				TO_CHAR(s.custrecord_ad_uas_stage_date, 'YYYY-MM-DD') AS stage_date,
				s.custrecord_ad_uas_last_offer AS last_offer,
				TO_CHAR(s.custrecord_ad_uas_followup, 'YYYY-MM-DD') AS followup,
				s.custrecord_ad_uas_notes AS notes,
				s.custrecord_ad_uas_expected_tenants AS expected,
				s.custrecord_ad_uas_lease_terms AS terms,
				l.id AS lease_id,
				l.name AS lease_name,
				TO_CHAR(l.custrecord_serp_lease_sent_date, 'YYYY-MM-DD') AS sent_date,
				TO_CHAR(l.custrecord_effective_date, 'YYYY-MM-DD') AS signed_date,
				l.custrecord_serp_number_of_tenants AS tenants,
				l.custrecord_monthly_actual_rent AS monthly_rent
			FROM customrecord_ad_unit_ay_status s
			LEFT JOIN customrecord_serp_lease_record l ON l.id = s.custrecord_ad_uas_lease
			WHERE s.isinactive = 'F'
				AND s.custrecord_ad_uas_ay = ?
			ORDER BY s.custrecord_ad_uas_unit`,
		// Every note for this academic year, oldest first. The whole thread ships to the browser rather
		// than being fetched per unit: it starts at zero rows and grows slowly, and having it client-side
		// means opening a thread, filtering on mentions and exporting all cost nothing extra. Revisit if
		// this ever gets into the tens of thousands.
		unitNotes: `
			SELECT n.id AS id,
				n.custrecord_ad_note_status AS status_id,
				TO_CHAR(n.custrecord_ad_note_date, 'YYYY-MM-DD') AS note_date,
				n.custrecord_ad_note_author AS author_id,
				BUILTIN.DF(n.custrecord_ad_note_author) AS author,
				n.custrecord_ad_note_text AS note_text,
				n.custrecord_ad_note_mentions AS mentions
			FROM customrecord_ad_uas_note n
			JOIN customrecord_ad_unit_ay_status s ON s.id = n.custrecord_ad_note_status
			WHERE n.isinactive = 'F'
				AND s.isinactive = 'F'
				AND s.custrecord_ad_uas_ay = ?
			ORDER BY n.custrecord_ad_note_date, n.id`,
		// The @mention picker: employees who have Lease KPI Markets set, which is the leasing team
		// rather than every employee in the account. Adding someone to the team adds them to the picker.
		leasingTeam: `
			SELECT e.id AS id,
				COALESCE(e.firstname || ' ' || e.lastname, e.entityid) AS name,
				CASE WHEN e.custentity_lkr_markets IS NOT NULL THEN 0 ELSE 1 END AS team
			FROM employee e
			WHERE e.isinactive = 'F'
				AND e.custentity_lkr_markets IS NOT NULL
			ORDER BY e.entityid`,
		// Fallback if the account does not expose firstname/lastname or the Lease KPI Markets field to
		// this role: a bare list is far better than an empty picker, which fails silently.
		leasingTeamBasic: `
			SELECT e.id AS id, e.entityid AS name
			FROM employee e
			WHERE e.isinactive = 'F'
				AND e.custentity_lkr_markets IS NOT NULL
			ORDER BY e.entityid`
	};

	// Market lock: a deployment-level script parameter (Free-Form Text). Blank = whole company. Otherwise a comma-separated
	// list of markets (property City, e.g. "Binghamton" or "Bethlehem, Troy"); the Suitelet then loads ONLY those markets'
	// properties, units, leases, targets, tenants and history, so other markets' data never reaches the browser.
	const MARKET_PARAM = 'custscript_lkr_markets';

	// Viewer market lock: a deployment-level Check Box parameter. When it is ticked, the signed-in employee's own
	// "Lease KPI Markets" field (a Multiple Select on the Employee record, sourced from customlist_lkr_market) narrows
	// the report to their markets. Blank field = not narrowed. If the employee or the field cannot be read the viewer
	// sees nothing and the failure is logged: a lock that fails open is not a lock.
	const VIEWER_LOCK_PARAM = 'custscript_lkr_user_lock';
	const VIEWER_MARKETS_FIELD = 'custentity_lkr_markets';

	const RECORD_TYPES = {
		lease: 'customrecord_serp_lease_record',
		tenant: 'customer',
		unit: 'customrecord_serp_units_bedrooms',
		property: 'customrecord_serp_property_record',
		details: 'customrecord_serp_academic_yr_details'
	};

	// ---- Unit leasing pipeline ----
	// Stages 4 and 5 belong to the lease User Event (AD_UE_Lease_Stage_Sync): a lease being sent, or going fully
	// executed, is what sets them. Nothing on this board may write them. 1, 2, 3, 6 and blank are leasing's to set.
	// Blank is a real state - the most common one - and is never coerced to a number.
	const UAS = {
		record: 'customrecord_ad_unit_ay_status',
		unit: 'custrecord_ad_uas_unit',
		ay: 'custrecord_ad_uas_ay',
		property: 'custrecord_ad_uas_property',
		stage: 'custrecord_ad_uas_stage',
		manualStage: 'custrecord_ad_uas_manual_stage',
		source: 'custrecord_ad_uas_stage_source',
		stageDate: 'custrecord_ad_uas_stage_date',
		lease: 'custrecord_ad_uas_lease',
		lastOffer: 'custrecord_ad_uas_last_offer',
		followup: 'custrecord_ad_uas_followup',
		notes: 'custrecord_ad_uas_notes',
		expected: 'custrecord_ad_uas_expected_tenants',
		// Terms agreed at Ready For Lease, held as JSON until someone turns them into a real lease.
		// A short-lived shadow copy: the lease record is the home for all of this, and doLeaseCreate
		// empties this field as it writes the lease, so the two never both hold terms.
		terms: 'custrecord_ad_uas_lease_terms'
	};
	// The lease record already carries every term the dialog captures, so creating one is a straight
	// field-for-field write. Duration is an integer of months, not a list, so 24 is storable.
	const LEASE = {
		record: 'customrecord_serp_lease_record',
		property: 'custrecord_property',
		unit: 'custrecord_unitsbedroom',
		type: 'custrecord_serp_lease_type_test',
		group: 'custrecord_serp_group_type',
		leader: 'custrecord_serp_group_leader',
		tenantCount: 'custrecord_serp_number_of_tenants',
		monthly: 'custrecord_monthly_actual_rent',
		total: 'custrecord_serp_rent_actual_total',
		targetMonthly: 'custrecord_serp_monthly_targ_rent_lease',
		targetBed: 'custrecord_rent_target_per_bed',
		firstPay: 'custrecord_payment_due_on_first_day_of_l',
		months: 'custrecord_serp_lease_duration_options',
		start: 'custrecord_serp_lease_start_date',
		end: 'custrecord_serp_lease_end_date',
		ay: 'custrecord_serp_lease_academic_year',
		status: 'custrecord_serp_lease_status',
		water: 'custrecord_serp_watersewer_included',
		waterCap: 'custrecord_serp_watersewer_cap',
		gas: 'custrecord_serp_gaselectric_included',
		gasCap: 'custrecord_serp_gaselectric_cap',
		concession: 'custrecord_serp_concession_total',
		concessionNote: 'custrecord_serp_concession_description',
		provisions: 'custrecord_serp_additional_provisions',
		// The one term with no home on the lease record before this build.
		notes: 'custrecord_ad_lease_notes'
	};
	const LEASE_TYPE_LABEL = { 1: 'Whole House', 2: 'Unit', 3: 'Bedroom' };
	const LEASE_GROUP_LABEL = { 1: 'New Group', 2: 'Transfers', 3: 'Renewal' };
	const TERMS_MAX = 8000;
	const STAGE_READY = '3';
	const LEASE_TYPE_WHOLE_HOUSE = '1';
	const LEASE_TYPE_BEDROOM = '3';
	// Notes are their own child record rather than one text field, so each carries a date, an author and
	// the people it tags, and so they can be counted, filtered and reported on later.
	const NOTE = {
		record: 'customrecord_ad_uas_note',
		status: 'custrecord_ad_note_status',
		date: 'custrecord_ad_note_date',
		author: 'custrecord_ad_note_author',
		text: 'custrecord_ad_note_text',
		mentions: 'custrecord_ad_note_mentions'
	};
	// Stage transitions. custrecord_ad_uas_stage_date only ever holds the LATEST change, so without this
	// log there is no way to measure time in stage, conversion between stages, or velocity week over week,
	// and none of it can be reconstructed afterwards. Written on every stage change this board makes.
	const LOG = {
		record: 'customrecord_ad_uas_stage_log',
		status: 'custrecord_ad_log_status',
		from: 'custrecord_ad_log_from',
		to: 'custrecord_ad_log_to',
		date: 'custrecord_ad_log_date',
		source: 'custrecord_ad_log_source',
		// Was not present in the account when this was written. Set inside its own try/catch below, so a
		// missing field costs one log line rather than the whole save.
		user: 'custrecord_ad_log_user'
	};
	// 2 and 3 were separate stages (Lease Form Collection, then Ready For Lease) and are now one.
	// 3 is the surviving value; 2 keeps the same label so any legacy row still reads and sorts
	// correctly, but it is out of STAGE_EDITABLE so it can never be set again. No status row used
	// either value when this shipped, so nothing had to be migrated.
	const STAGE_LABEL = { 1: 'Renewal Declined', 3: 'Ready For Lease - Waiting on Forms', 4: 'Lease Out - Unsigned', 5: 'Fully Executed', 6: 'Offline', 7: 'Renewal Offered' };
	// Lease Form Collection was merged into Ready For Lease. Anything still holding the retired
	// value reads as the surviving one, so it can never show up as a second identical stage.
	const STAGE_RETIRED = { 2: '3' };
	const stageOut = (v) => {
		const k = v === null || v === undefined ? '' : String(v);
		return STAGE_RETIRED[k] || k;
	};
	// Funnel order, not id order: the renewal gate is the first conversation of the cycle for most units.
	// Sorting by this rather than by id means a list value added later never reshuffles the board.
	const STAGE_ORDER = ['7', '1', '3', '4', '5', '6', ''];
	const STAGE_EDITABLE = ['7', '1', '3', '6'];
	const STAGE_CLASS = { 1: 'st-decl', 3: 'st-ready', 4: 'st-out', 5: 'st-exec', 6: 'st-off', 7: 'st-renew', '': 'st-none' };
	const NO_STAGE_LABEL = 'No stage set';
	const SOURCE_MANUAL = '1';
	const SOURCE_LEASE = '2';
	// Properties the engine keeps out of the student numbers (short-term and commercial/land/office). The
	// board is the student pipeline, so a write to one of these is refused even though no market lock
	// would catch it.
	const NON_STUDENT_PROPS = new Set(['39', '258', '374', '402', '529', '621', '622', '623', '624', '625', '626']);
	const PIPELINE_ROW_CAP = 400;
	const NOTE_MAX = 4000;

	const toDateValue = (s) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
		return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
	};

	// custrecord_ad_uas_lease_terms arrived with the Ready For Lease dialog. SuiteQL fails the
	// entire query on an unknown column, so selecting it before the field exists killed the whole
	// Pipeline tab. Probe once, fall back to the query without it, and carry on: the board still
	// works, only the captured terms are unavailable. Same bargain as LOG.user below.
	let termsFieldOk = true;
	const unitStatusRows = (ay) => {
		if (termsFieldOk) {
			try { return runQuery(SQL.unitStatus, [ay]); }
			catch (e) {
				termsFieldOk = false;
				log.error('Lease terms field missing',
					`${UAS.terms} is not on ${UAS.record} yet, so the Pipeline tab is running without captured lease terms. ` +
					`Create it as a Long Text field to enable the Ready For Lease dialog. ${e.message || e}`);
			}
		}
		return runQuery(SQL.unitStatus.replace(/[ \t]*s\.custrecord_ad_uas_lease_terms AS terms,\r?\n/, ''), [ay]);
	};

	const runQuery = (sql, params = []) => {
		const rows = [];
		const paged = query.runSuiteQLPaged({ query: sql, params, pageSize: 1000 });
		paged.pageRanges.forEach((range) => {
			paged.fetch({ index: range.index }).data.asMappedResults().forEach((row) => rows.push(row));
		});
		const unique = new Set(rows.map((row) => `${row.id}|${row.changed || ''}`)).size;
		if (rows.length !== paged.count || unique !== rows.length) {
			log.error('SuiteQL paging mismatch', `expected ${paged.count}, fetched ${rows.length}, unique ${unique}`);
		}
		return rows;
	};

	const esc = (value) => String(value === null || value === undefined ? '' : value)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const fInt = (n) => Math.round(n || 0).toLocaleString('en-US');
	const fDec = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
	const fMoney = (n) => (n === null || n === undefined ? '–' : `$${Math.round(n).toLocaleString('en-US')}`);
	const fMoney2 = (n) => (n === null || n === undefined ? '–' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
	const fPct = (r) => (r === null || r === undefined ? '–' : `${(Math.round(r * 1000) / 10).toFixed(1)}%`);
	const tone = (r) => (r === null || r === undefined ? '' : (r >= 0.95 ? 'ok' : (r >= 0.8 ? 'warn' : 'bad')));
	const pill = (r) => (r === null || r === undefined ? '<span class="muted">–</span>' : `<span class="pill ${tone(r)}">${fPct(r)}</span>`);
	// Pace tone: compared with LY at the same point in the leasing cycle (ahead = green, within 3 pts = amber, else red).
	const paceTone = (d) => (d === null || d === undefined || Number.isNaN(d) ? null : (d >= -0.0005 ? 'ok' : (d >= -0.03 ? 'warn' : 'bad')));
	const pacePill = (r, d) => (r === null || r === undefined ? '<span class="muted">–</span>'
		: `<span class="pill ${r === 0 && d === 0 ? 'vac' : (paceTone(d) || tone(r))}">${fPct(r)}</span>`);
	// Compact money for comparison lines: $20.7M, $905K, $8,250.
	const fMoneyK = (n) => (n === null || n === undefined ? '–' : (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : (Math.abs(n) >= 1e5 ? `$${Math.round(n / 1e3)}K` : fMoney(n))));
	const keyify = (value) => String(value || '').trim().toLowerCase();
	const labelify = (value) => keyify(value).replace(/\b\w/g, (c) => c.toUpperCase());
	const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(v);
	const sign = (v) => (v > 1e-9 ? '+' : (v < -1e-9 ? '−' : ''));
	const r1 = (v) => Math.round(v * 1000) / 10;
	const fPts = (d) => (isNum(d) ? `${sign(r1(d))}${Math.abs(r1(d)).toFixed(1)} pts` : '–');
	const fGrowth = (g) => (isNum(g) ? `${sign(r1(g))}${Math.abs(r1(g)).toFixed(1)}%` : '–');
	const fSigned = (v) => (isNum(v) ? `${sign(v)}${Math.abs(Math.round(v)).toLocaleString('en-US')}` : '–');
	const fSignedMoney = (v) => (isNum(v) ? `${sign(v)}$${Math.abs(Math.round(v)).toLocaleString('en-US')}` : '–');
	const dcls = (v) => (!isNum(v) || Math.abs(v) < 0.0005 ? '' : (v > 0 ? 'up' : 'down'));
	const dlt = (v, fmt) => `<span class="dlt ${dcls(v)}">${fmt(v)}</span>`;
	const fDate = (s) => (s ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : '–');
	const ayShort = (name) => String(name || '').replace(/AY\s*\d{2}(\d{2})\s*-\s*\d{2}(\d{2})/, 'AY $1-$2');
	const todayStr = () => {
		const d = new Date();
		const p = (n) => String(n).padStart(2, '0');
		return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, stamp: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` };
	};

	const STYLES = `
	<style>
	#lkr{--ink:#1d2939;--ink2:#344054;--muted:#667085;--faint:#98a2b3;--line:#e4e7ec;--line2:#eef0f3;--soft:#f7f8fa;--page:#eef1f5;
		--blue:#1f5fb4;--blue-dk:#174a8c;--blue-bg:#eaf1fb;--ok:#17803d;--ok-bg:#e3f4e8;--warn:#a15c00;--warn-bg:#fff1d6;--bad:#b42318;--bad-bg:#fdeceb;
		font-family:"Open Sans",Helvetica,Arial,sans-serif;color:var(--ink);font-size:13px;background:var(--page);padding:14px;box-sizing:border-box;width:100%}
	#lkr *{box-sizing:border-box}
	#lkr .card{background:#fff;border:1px solid var(--line);border-radius:6px;margin-bottom:12px}
	#lkr .pad{padding:16px 20px}
	#lkr .eyebrow{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
	#lkr .muted{color:var(--faint)}
	#lkr .criteria{display:grid;grid-template-columns:repeat(3,minmax(200px,1fr));gap:16px}
	#lkr label{display:block;font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px}
	#lkr select,#lkr input[type=search]{width:100%;height:36px;border:1px solid #cfd4dc;border-radius:5px;padding:0 10px;font-size:13px;color:var(--ink);background:#fff;font-family:inherit}
	#lkr select:focus,#lkr input:focus,#lkr button:focus-visible{outline:2px solid var(--blue);outline-offset:1px}
	#lkr .bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
	#lkr .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
	#lkr .btn{height:34px;padding:0 16px;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #cfd4dc;background:#fff;color:var(--ink2);font-family:inherit}
	#lkr .btn:hover{background:var(--soft)}
	#lkr .btn.primary{background:var(--blue);border-color:var(--blue);color:#fff}
	#lkr .btn.primary:hover{background:var(--blue-dk)}
	#lkr .btn.sm{height:30px;padding:0 12px;font-size:12px;font-weight:500}
	#lkr .error{color:var(--bad);font-size:12px}
	#lkr .tabs{display:inline-flex;border:1px solid #cfd4dc;border-radius:5px;overflow:hidden}
	#lkr .tabs button{height:34px;padding:0 18px;border:0;border-left:1px solid #cfd4dc;background:#fff;color:var(--blue-dk);font-size:13px;cursor:pointer;font-family:inherit}
	#lkr .tabs button:first-child{border-left:0}
	#lkr .tabs button.active{background:var(--blue);color:#fff;font-weight:600}
	#lkr .tabs button .count{display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;background:var(--bad-bg);color:var(--bad);font-size:11px;font-weight:700}
	#lkr .tabs button.active .count{background:rgba(255,255,255,.25);color:#fff}
	#lkr .context{display:flex;flex-wrap:wrap;padding:12px 20px}
	#lkr .context div{padding-right:28px;margin-right:28px;border-right:1px solid var(--line)}
	#lkr .context div:last-child{border-right:0}
	#lkr .context span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
	#lkr .context strong{font-size:14px}
	#lkr .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:12px}
	#lkr .kpis.seven{grid-template-columns:repeat(7,1fr)}
	#lkr .kpi{background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px 18px}
	#lkr .kpi span{display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
	#lkr .kpi strong{display:block;font-size:24px;font-weight:700;margin:6px 0 2px;font-variant-numeric:tabular-nums}
	#lkr .kpis.seven .kpi strong{font-size:19px}
	#lkr .kpi small{font-size:11px;color:var(--muted)}
	#lkr .kpi.ok strong{color:var(--ok)}#lkr .kpi.warn strong{color:var(--warn)}#lkr .kpi.bad strong{color:var(--bad)}
	#lkr .kpi a{color:inherit;text-decoration:none;border-bottom:1px dashed currentColor;cursor:pointer}
	#lkr .head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--line)}
	#lkr .head h3{margin:0;font-size:13px;font-weight:700}
	#lkr .head h3 em{font-style:normal;font-weight:400;color:var(--muted);margin-left:10px;font-size:12px}
	#lkr .wrap{overflow-x:auto}
	#lkr table{width:100%;border-collapse:collapse}
	#lkr th{background:var(--soft);font-size:12px;font-weight:600;color:#475467;text-align:right;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
	#lkr th.l,#lkr td.l{text-align:left}
	#lkr td{padding:9px 14px;border-bottom:1px solid var(--line2);white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
	#lkr table.dense th,#lkr table.dense td{padding:9px 10px}
	#lkr td.wrapcell{white-space:normal;min-width:280px;color:var(--muted)}
	#lkr tbody tr:hover td{background:#fafbfc}
	#lkr tfoot td{font-weight:700;background:var(--soft);border-top:2px solid var(--line)}
	#lkr tr.notes td,#lkr tr.notes th{display:none;background:#fbfbfc;color:var(--muted);font-size:11px;font-weight:400;white-space:normal;text-align:left;vertical-align:top;line-height:1.4;padding:8px 14px}
	#lkr.show-notes tr.notes td,#lkr.show-notes tr.notes th{display:table-cell}
	#lkr tr.zero td{color:var(--faint)}
	#lkr .pill{display:inline-block;min-width:56px;text-align:center;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}
	#lkr .pill.ok{color:var(--ok);background:var(--ok-bg)}#lkr .pill.warn{color:var(--warn);background:var(--warn-bg)}#lkr .pill.bad{color:var(--bad);background:var(--bad-bg)}
	#lkr .pill.vac{color:var(--muted);background:var(--soft)}
	#lkr .tag{display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600;background:var(--soft);color:var(--ink2)}
	#lkr .tag.t-wh{background:#e8eefc;color:#2b4fa3}#lkr .tag.t-unit{background:#eaf6f1;color:#1d6b4f}#lkr .tag.t-bed{background:#f6effb;color:#6b3fa0}#lkr .tag.t-mixed{background:#fff4e5;color:#8a5300}
	#lkr .ties{padding:10px 20px;font-size:12px;color:var(--ok)}
	#lkr .ties.bad{color:var(--bad)}
	#lkr .switch{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--ink2);cursor:pointer;user-select:none;margin:0}
	#lkr .switch input{width:16px;height:16px;margin:0;accent-color:var(--blue)}
	#lkr .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
	#lkr .chips .lbl{font-size:12px;color:var(--muted);margin-right:2px}
	#lkr .chip{border:1px solid #cfd4dc;background:#fff;border-radius:14px;padding:3px 11px;font-size:12px;cursor:pointer;color:var(--ink2);font-family:inherit}
	#lkr .chip b{margin-left:5px;color:var(--bad)}
	#lkr .chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
	#lkr .chip.on b{color:#fff}
	#lkr .toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 20px;border-bottom:1px solid var(--line);background:#fcfcfd}
	#lkr .toolbar input[type=search]{width:240px;height:30px;font-size:12px}
	#lkr tr.tr td{cursor:default}
	#lkr tr.tr.kids td:first-child{cursor:pointer}
	#lkr tr.lv0 td{background:#e6eefa;font-weight:700}
	#lkr tr.lv1 td{background:#f2f6fc;font-weight:700}
	#lkr tr.lv2 td{font-weight:600}
	#lkr tr.lv4 td{color:#475467}
	#lkr tr.lv0:hover td{background:#dde8f8}#lkr tr.lv1:hover td{background:#ebf1fa}
	#lkr .caret{display:inline-block;width:18px;border:0;background:none;color:var(--blue);font-size:10px;cursor:pointer;padding:0;transition:transform .15s}
	#lkr tr.open > td .caret{transform:rotate(90deg)}
	#lkr .sp{display:inline-block;width:18px}
	#lkr .nm{color:var(--ink)}
	#lkr tr.lv0 .nm,#lkr tr.lv1 .nm,#lkr tr.lv2 .nm{color:var(--blue-dk)}
	#lkr .lvl{margin-left:8px;font-size:10px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.05em}
	#lkr table.tree th.grp-start,#lkr table.tree td.grp-start{border-left:1px solid var(--line)}
	#lkr table.tree.hide-type .g-type,#lkr table.tree.hide-term .g-term,#lkr table.tree.hide-head .g-head,#lkr table.tree.hide-rev .g-rev,#lkr table.tree.hide-occ .g-occ{display:none}
	#lkr a.lnk{color:var(--blue-dk);text-decoration:none}
	#lkr a.lnk:hover{text-decoration:underline}
	#lkr .empty{text-align:center;padding:48px 20px;color:var(--muted)}
	#lkr .empty strong{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
	#lkr .tab-panel{display:none}
	#lkr .tab-panel.active{display:block}
	#lkr .sec-note{font-size:12px;color:var(--muted);margin:2px 0 0}
	@media (max-width:1200px){#lkr .kpis{grid-template-columns:repeat(3,1fr)}#lkr .kpis.seven{grid-template-columns:repeat(4,1fr)}}
	@media (prefers-reduced-motion:reduce){#lkr .caret{transition:none}}
	#lkr .hdr{padding:14px 20px 0}
	#lkr .hdr-top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-bottom:12px}
	#lkr .ttl h2{margin:0;font-size:18px;font-weight:700;color:var(--ink)}
	#lkr .ttl .scope{display:inline-block;margin-top:4px;font-size:12px;color:var(--muted)}
	#lkr .ttl .scope.locked{color:var(--blue-dk);background:var(--blue-bg);padding:2px 8px;border-radius:10px;font-weight:600}
	#lkr .crit{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
	#lkr .crit .fld label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
	#lkr .crit select{height:32px;min-width:150px;width:auto}
	#lkr .crit select:disabled{background:var(--soft);color:var(--ink2)}
	#lkr .crit .btns{display:flex;gap:6px}
	#lkr .crit .btn{height:32px}
	#lkr #lkr-run.dirty{box-shadow:0 0 0 3px rgba(31,95,180,.25)}
	#lkr .hdr-bot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding:10px 0 12px}
	#lkr .hdr .meta{font-size:12px;color:var(--muted);margin-right:8px}
	#lkr .hdr .error:empty{display:none}
	#lkr .hdr .error{padding:0 0 10px}
	#lkr .kpis.six{grid-template-columns:repeat(6,minmax(0,1fr))}
	#lkr .kpis.four{grid-template-columns:repeat(4,minmax(0,1fr))}
	#lkr .kpis.inset{padding:12px 20px 4px;margin:0;border-bottom:1px solid var(--line)}
	#lkr .kpis.inset .kpi{background:var(--soft)}
	#lkr .kpi.tile{display:flex;flex-direction:column}
	#lkr .kpi.tile strong{font-size:26px;margin:6px 0 0}
	#lkr .kpi.tile small{display:block;margin-top:2px}
	#lkr .kpi.tile dl{margin:10px 0 0;padding-top:8px;border-top:1px solid var(--line2);font-size:12px}
	#lkr .kpi.tile dl div{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(44px,auto);column-gap:8px;align-items:baseline;padding:2px 0}
	#lkr .kpi.tile dt{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
	#lkr .kpi.tile dd{margin:0;font-variant-numeric:tabular-nums;color:var(--ink2);text-align:right;white-space:nowrap}
	#lkr .kpi.tile dd span{display:inline;text-transform:none;letter-spacing:0;font-size:inherit;margin:0;font-weight:600;color:var(--muted)}
	#lkr .kpi.tile dd span.dlt.up{color:var(--ok)}#lkr .kpi.tile dd span.dlt.down{color:var(--bad)}
	#lkr [hidden]{display:none !important}
	#lkr .pace-note{margin:-4px 2px 12px}
	#lkr .dlt.up{color:var(--ok);font-weight:600}#lkr .dlt.down{color:var(--bad);font-weight:600}
	#lkr table.grouped tr.grp td{font-weight:600}
	#lkr table.grouped tr.grp td:first-child{cursor:pointer}
	#lkr table.grouped tr.grp.open > td .caret{transform:rotate(90deg)}
	#lkr table.grouped tr.kid td{background:#fbfcfe;font-weight:400}
	#lkr table.grouped td.kidname{padding-left:46px;color:var(--ink2)}
	#lkr tr.cur td{background:var(--blue-bg);font-weight:600}
	#lkr .warn-note{color:var(--warn);margin:0 2px 12px;font-size:12px}
	#lkr strong.late{color:var(--bad)}
	#lkr .seg{display:inline-flex;border:1px solid #cfd4dc;border-radius:5px;overflow:hidden}
	#lkr .seg button{height:28px;padding:0 12px;border:0;border-left:1px solid #cfd4dc;background:#fff;color:var(--blue-dk);font-size:12px;cursor:pointer;font-family:inherit}
	#lkr .seg button:first-child{border-left:0}
	#lkr .seg button.on{background:var(--blue);color:#fff;font-weight:600}
	#lkr .chart{padding:12px 20px 16px}
	#lkr .chart svg{width:100%;height:auto;display:block}
	#lkr .chart .legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--ink2);margin-top:8px}
	#lkr .chart .legend i{display:inline-block;width:18px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
	#lkr .wrap.scroll{max-height:460px;overflow:auto}
	#lkr .wrap.scroll thead th{position:sticky;top:0;z-index:1}
	/* Frozen headers (2026-10-27): a table wrapper scrolls inside the viewport instead of with the page, so the header rows
	   stay visible while scrolling down and the Total row stays at the bottom. Short tables are unaffected. The header CELLS
	   are sticky, and the client script gives the second and third header rows their offset. Chromium paints sticky cells
	   wrongly in a collapsed-border table (body text shows through), so these tables use separate borders with no spacing. */
	#lkr .wrap{overflow:auto;max-height:calc(100vh - 150px)}
	#lkr .wrap table{border-collapse:separate;border-spacing:0}
	#lkr .wrap thead th{position:sticky;top:0;z-index:2}
	#lkr .wrap tfoot td{position:sticky;bottom:0;z-index:2}
	#lkr.present .wrap{max-height:none}
	#lkr.hide-desc .sec-note,#lkr.hide-desc .kpi small{display:none}
	#lkr.hide-desc .wk-head .sec-note,#lkr.hide-desc .rt-pick .sec-note,#lkr.hide-desc .pace-note,#lkr.hide-desc .yoy-none{display:block}
	#lkr:not(.hide-desc) tr.notes td,#lkr:not(.hide-desc) tr.notes th{display:table-cell}
	#lkr details.fold > summary,#lkr details.fixcard > summary{list-style:none;cursor:pointer}
	#lkr details.fold > summary::-webkit-details-marker,#lkr details.fixcard > summary::-webkit-details-marker{display:none}
	#lkr details.fold > summary h3:before,#lkr details.fixcard > summary h3:before{content:'▶';display:inline-block;margin-right:8px;font-size:10px;color:var(--blue);transition:transform .15s}
	#lkr details.fold[open] > summary h3:before,#lkr details.fixcard[open] > summary h3:before{transform:rotate(90deg)}
	#lkr details.fold:not([open]) > summary{border-bottom:0}
	#lkr .fix-sum{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px 4px}
	#lkr .fix-chip{border:1px solid #cfd4dc;background:#fff;border-radius:16px;padding:5px 12px;font-size:12px;cursor:pointer;color:var(--ink2);font-family:inherit}
	#lkr .fix-chip b{color:var(--bad);margin-right:3px}
	#lkr .fix-chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
	#lkr .fix-chip.on b,#lkr .fix-chip.on .muted{color:#fff}
	#lkr table.fix td{vertical-align:top}
	#lkr td.fixcell{color:var(--ink);min-width:300px}
	#lkr .small{font-size:11px}
	#lkr .rt-pick label{margin:0;font-size:12px;color:var(--muted)}
	#lkr .rt-pick select{height:32px;width:auto;min-width:210px;font-weight:600}
	#lkr .head input[type=search]{width:200px;height:30px;font-size:12px}
	#lkr .foot-note{padding:8px 20px 12px}
	#lkr table.tree thead tr.gh th{background:#e9eef6;color:var(--ink2);text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:7px 10px}
	#lkr table.tree thead tr.gh th.l{text-transform:none;letter-spacing:0;font-size:12px;text-align:left;vertical-align:bottom;background:var(--soft)}
	#lkr table.tree thead tr.gh th[rowspan="3"]{vertical-align:bottom;background:var(--soft);text-transform:none;letter-spacing:0;font-size:12px}
	#lkr table.tree thead tr.gh th.yoyh{background:#dfe8f7;color:var(--blue-dk)}
	#lkr table.tree thead tr.gh .vs{font-weight:400;text-transform:none;color:var(--muted);margin:0 4px}
	#lkr table.tree thead th.ctr{text-align:center;border-bottom:1px solid var(--line)}
	#lkr table.tree thead tr.yr th{font-size:11px;padding:6px 10px}
	#lkr table.tree thead tr.yr th.cy{color:var(--blue-dk)}
	#lkr table.tree thead tr.yr th.py{color:#9a4a12}
	#lkr table.tree td.cy{background:rgba(31,95,180,.04)}
	#lkr table.tree td.py{background:rgba(194,65,12,.045)}
	#lkr table.tree:not([data-rt="yoy"]):not([data-rt="rent"]):not([data-rt="all"]) tr.yr{display:none}
	#lkr .why{font-size:11px;color:var(--faint);white-space:nowrap}
	#lkr .wk-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px}
	#lkr .wk-head h3{margin:0;font-size:15px}
	#lkr .wk-nav select{height:30px;width:auto;min-width:190px;font-size:12px}
	#lkr .exit-btn{display:none}
	#lkr table.wk-grp tfoot td,#lkr table.wk-grp tr.tot td{font-weight:700}
	table.fix tr.sevrow td{background:#fff3f1}
	table.fix tr.sevrow td:first-child{box-shadow:inset 3px 0 0 #b42318}
	.fix-chip.sev{border-color:#f0a9a0;background:#fff3f1;color:#8c2f22;font-weight:600}
	.card.fixcard.alert{border:1px solid #f0a9a0;box-shadow:inset 4px 0 0 #b42318}
	.card.fixcard.alert>.head{background:#fff6f4}
	.card.fixcard.alert h3 em{color:#b42318;background:#fde3de;border-color:#f0a9a0}
	.card.fixcard.alert .alert-dot{color:#b42318;margin-right:6px}
	.yoy-strip{display:flex;flex-wrap:wrap;gap:10px;padding:10px 0 2px}
	.yoy-cell{flex:1 1 150px;min-width:140px;border:1px solid var(--line);border-radius:6px;padding:8px 11px;background:var(--soft)}
	.yoy-cell span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
	.yoy-cell strong{display:block;font-size:19px;line-height:1.25;font-variant-numeric:tabular-nums}
	.yoy-cell em{display:block;font-style:normal;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
	.yoy-cell div{font-size:12px;font-variant-numeric:tabular-nums}
	.yoy-none{padding-top:8px}
	.yoy-cell.thin{background:#fffbea;border-color:#f0dca0}
	.wk-cmp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 12px}
	.wk-cmp>.card{margin:0}
	.wk-cmp .head{padding-bottom:4px}
	.wk-cmp h3{font-size:14px}
	table.cmp-tbl{width:100%;table-layout:fixed}
	table.cmp-tbl td,table.cmp-tbl th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
	table.cmp-tbl td.l,table.cmp-tbl th.l{width:37%;white-space:normal;overflow:visible}
	table.cmp-tbl .sub{display:block;font-size:11px;line-height:1.3;opacity:.8;white-space:normal}
	table.cmp-tbl tr.recon td{background:#fffbea}
	table.cmp-tbl tr.recon td.l{font-weight:400}
	@media (max-width:1100px){.wk-cmp{grid-template-columns:1fr}}
	#lkr.present{padding:28px 36px;overflow:auto;height:100%}
	#lkr.present .hdr,#lkr.present .wk-detail,#lkr.present .present-btn,#lkr.present .wk-nav select,#lkr.present .warn-note{display:none}
	#lkr.present .exit-btn{display:inline-block}
	#lkr.present .wk-head h3{font-size:22px}
	#lkr.present .wk-sub{font-size:14px}
	#lkr.present .kpi.tile strong{font-size:38px}
	#lkr.present .kpi.tile span{font-size:13px}
	#lkr.present .kpi.tile dl{font-size:13px}
	#lkr.present table.wk-grp td,#lkr.present table.wk-grp th{font-size:15px;padding:11px 14px}
	#lkr.present table.cmp-tbl td,#lkr.present table.cmp-tbl th{font-size:14px;padding:9px 12px}
	#lkr.present .wk-cmp h3{font-size:16px}
	#lkr.present .pill{font-size:14px}
	@media (max-width:1300px){#lkr .kpis.six{grid-template-columns:repeat(3,minmax(0,1fr))}}
	@media (max-width:800px){#lkr .kpis.six,#lkr .kpis.four{grid-template-columns:repeat(2,minmax(0,1fr))}#lkr .crit select{min-width:120px}#lkr .hdr-top{align-items:flex-start}}
	#lkr .pl-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 20px;border-bottom:1px solid var(--line)}
	#lkr .pl-tools .fld{display:flex;flex-direction:column;gap:3px}
	#lkr .pl-tools label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
	#lkr .pl-tools select,#lkr .pl-tools input[type=search]{height:30px;border:1px solid #cfd4dc;border-radius:5px;padding:0 8px;font-size:13px;font-family:inherit;background:#fff;color:var(--ink2)}
	#lkr .pl-tools input[type=search]{min-width:200px}
	#lkr .pl-tools .spacer{flex:1}
	#lkr .pl-tools .switch{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2);white-space:nowrap}
	#lkr .pl-bar{display:flex;height:22px;margin:0 20px 12px;border-radius:4px;overflow:hidden;background:var(--soft)}
	#lkr .pl-bar i{display:block;height:100%;font-style:normal}
	#lkr .pl-legend{display:flex;flex-wrap:wrap;gap:14px;padding:0 20px 12px;font-size:12px;color:var(--muted)}
	#lkr .pl-legend span{display:inline-flex;align-items:center;gap:5px}
	#lkr .pl-legend b{width:10px;height:10px;border-radius:2px;display:inline-block}
	#lkr .st-decl{background:#b45309}#lkr .st-form{background:#7c3aed}#lkr .st-ready{background:#0284c7}
	#lkr .st-out{background:#d97706}#lkr .st-exec{background:#15803d}#lkr .st-off{background:#64748b}#lkr .st-none{background:#cbd5e1}
	#lkr table.pl td{vertical-align:middle}
	#lkr table.pl select,#lkr table.pl input{height:28px;border:1px solid #cfd4dc;border-radius:4px;padding:0 6px;font-size:12px;font-family:inherit;background:#fff;color:var(--ink2);width:100%;box-sizing:border-box}
	#lkr table.pl input.note{min-width:150px}
	#lkr table.pl td.sel{width:28px;text-align:center}
	#lkr table.pl tr.dirty td{background:#fffbeb}
	#lkr table.pl tr.rowerr td{background:var(--bad-bg)}
	#lkr table.pl tr.rowerr td.l small{display:block;color:var(--bad);font-weight:600}
	#lkr table.pl tr.flight td{background:#eef4fd}
	#lkr table.pl tr.okrow td{background:#ecfdf5}
	#lkr table.pl tr .rowtag{margin-left:7px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle}
	#lkr table.pl tr.flight .rowtag{color:#1f5fb4}
	#lkr table.pl tr.okrow .rowtag{color:#047857}
	#lkr table.pl tr.rowerr .retry{margin-left:8px;font-size:10.5px;font-weight:700;text-decoration:underline;background:none;border:0;color:var(--bad);cursor:pointer;padding:0}
	#lkr .pl-save .auto{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;opacity:.92;cursor:pointer;user-select:none}
	#lkr .pl-save .auto input{margin:0}
	#lkr .lfscrim{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:70}
	#lkr .lfwrap{position:fixed;inset:0;z-index:71;display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto}
	#lkr .lfbox{background:#fff;border-radius:10px;width:min(760px,100%);box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;max-height:calc(100vh - 56px)}
	#lkr .lfhd{padding:15px 20px 12px;border-bottom:1px solid var(--line)}
	#lkr .lfhd h3{margin:0;font-size:15px}
	#lkr .lfhd p{margin:3px 0 0;font-size:11.5px;color:var(--muted)}
	#lkr .lfbd{padding:6px 20px 16px;overflow:auto}
	#lkr .lfset{border:1px solid var(--line);border-radius:7px;padding:10px 13px 13px;margin-top:12px}
	#lkr .lfset legend{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:0 5px}
	#lkr .lfgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 14px;align-items:end}
	#lkr .lff{display:flex;flex-direction:column;gap:3px;min-width:0}
	#lkr .lff.wide{grid-column:1/-1}
	#lkr .lff label{font-size:11px;font-weight:600;color:var(--muted)}
	#lkr .lff input,#lkr .lff select,#lkr .lff textarea{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;background:#fff}
	#lkr .lff textarea{resize:vertical;min-height:52px}
	#lkr .lff.ro input{background:#f6f7f9;color:var(--muted)}
	#lkr .lff .hint{font-size:10.5px;color:var(--muted)}
	#lkr .lfchk{display:flex;align-items:center;gap:7px;font-size:12.5px;padding-bottom:5px}
	#lkr .lfcalc{display:flex;gap:18px;flex-wrap:wrap;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line)}
	#lkr .lfcalc>div{display:flex;flex-direction:column;gap:1px}
	#lkr .lfcalc span{font-size:10.5px;color:var(--muted)}
	#lkr .lfcalc b{font-size:14px}
	#lkr .lfflag{margin-top:9px;font-size:11.5px;font-weight:600;padding:6px 9px;border-radius:4px;background:var(--bad-bg);color:var(--bad)}
	#lkr .lfflag.ok{background:#ecfdf5;color:#047857}
	#lkr .lfft{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:11px 20px;border-top:1px solid var(--line);background:#fafbfc;border-radius:0 0 10px 10px}
	#lkr .lfft .lfst{font-size:11px;color:var(--muted);flex:1;min-width:150px}
	#lkr table.pl .lfopen{font:inherit;font-size:10.5px;font-weight:600;background:none;border:0;padding:0;margin-top:2px;color:var(--accent,#1f5fb4);text-decoration:underline;cursor:pointer}
	#lkr .lfbeds{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px}
	#lkr .lfbeds label{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;border:1px solid var(--line);border-radius:4px;padding:3px 8px;cursor:pointer;background:#fff}
	#lkr .lfbeds label.on{border-color:var(--accent,#1f5fb4);background:#eef4fd;font-weight:600}
	#lkr .lfbeds label.taken{opacity:.5;cursor:not-allowed;background:#f6f7f9}
	#lkr .lfbeds label.taken s{text-decoration:none;color:var(--muted)}
	#lkr table.pl .spanyr{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#1f5fb4;border:1px solid #1f5fb4;border-radius:3px;padding:0 3px;vertical-align:middle}
	#lkr table.pl .nostat{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#b45309;border:1px solid #b45309;border-radius:3px;padding:0 3px;vertical-align:middle}
	#lkr table.pl .bedfree{font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}
	#lkr table.pl .bedpart{font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#b45309}
	#lkr table.pl .bedfull{font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#047857}
	#lkr .lfscope{margin-top:6px;border:1px solid var(--line);border-radius:5px;padding:7px 9px;background:#fafbfc}
	#lkr .lfscope>b{font-size:11.5px;display:block;margin-bottom:4px}
	#lkr .lfscope span{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:3px;padding:1px 6px;margin:0 4px 4px 0;background:#fff}
	#lkr .lfscope span.taken{opacity:.55;text-decoration:line-through}
	#lkr .lfmade{margin-top:9px;font-size:11.5px;padding:7px 10px;border-radius:4px;background:#ecfdf5;color:#047857;font-weight:600}
	#lkr .pl-foot{padding:10px 20px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
	#lkr .pl-save{position:sticky;bottom:0;z-index:20;display:flex;align-items:center;gap:12px;padding:12px 20px;background:#1f2937;color:#fff;border-radius:6px;margin-top:12px;box-shadow:0 -2px 12px rgba(0,0,0,.18)}
	#lkr .pl-save strong{font-size:14px}
	#lkr .pl-save .spacer{flex:1}
	#lkr .pl-save .msg{font-size:12px;opacity:.85}
	#lkr .pl-save .btn{height:32px}
	#lkr .pl-ro{color:var(--muted);font-size:12px}
	#lkr .pl-band{display:flex;flex-wrap:wrap;align-items:center;padding:0;overflow:hidden}
	#lkr .pl-stat{padding:7px 14px;border-right:1px solid var(--line2);min-width:0}
	#lkr .pl-stat:last-child{border-right:0}
	#lkr .pl-stat b{display:block;font-size:15px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
	#lkr .pl-stat span{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
	#lkr .pl-stat.ok b{color:var(--ok)}#lkr .pl-stat.warn b{color:var(--warn)}#lkr .pl-stat.bad b{color:var(--bad)}
	#lkr .st-decl{background:#b45309}#lkr .st-form{background:#6d4bbd}#lkr .st-ready{background:#0b7ab8}
	#lkr .st-out{background:#d97706}#lkr .st-exec{background:#15803d}#lkr .st-off{background:#64748b}
	#lkr .st-renew{background:#0f766e}#lkr .st-none{background:#c3ccd7}
	#lkr .pl-tog{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid #cfd4dc;border-radius:4px;cursor:pointer;background:#fff;font-size:12px;white-space:nowrap}
	#lkr .pl-tog.on{background:var(--accent-soft, #e7f0fa);border-color:var(--blue);color:var(--blue-dk)}
	#lkr td.chev{width:24px;padding-left:6px;padding-right:0}
	#lkr th.chev{width:24px}
	#lkr .chevbtn{border:0;background:none;color:var(--muted);cursor:pointer;font-size:11px;padding:2px 4px;line-height:1}
	#lkr .chevbtn:hover{color:var(--blue)}
	#lkr table.pl tr.open>td{background:#eef4fb}
	#lkr .age{font-variant-numeric:tabular-nums}
	#lkr .age.old{color:var(--warn);font-weight:600}
	#lkr .age.stale{color:var(--bad);font-weight:700}
	#lkr .breach{display:inline-block;margin-left:4px;color:var(--bad);font-weight:700;cursor:help}
	#lkr .tgt b{font-weight:600;font-variant-numeric:tabular-nums}
	#lkr .tgt span{display:block;font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums}
	#lkr .tvar{font-size:10.5px;font-weight:600}
	#lkr .tvar.up{color:var(--ok)}#lkr .tvar.down{color:var(--bad)}
	#lkr .notebtn{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:0;background:none;cursor:pointer;color:var(--ink2);font-family:inherit;font-size:11.5px;padding:2px 0;min-width:0}
	#lkr .notebtn:hover .notetext{color:var(--blue)}
	#lkr .notetext{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;max-width:170px}
	#lkr .notetext.none{color:var(--muted);font-style:italic}
	#lkr .ncount{flex:none;background:#e7f0fa;color:var(--blue-dk);border-radius:9px;padding:0 6px;font-size:10px;font-weight:700}
	#lkr .atb{flex:none;color:var(--blue);font-weight:700;font-size:11px}
	#lkr tr.pl-drawer>td{padding:0;background:var(--soft);border-bottom:1px solid var(--line)}
	#lkr .dw{display:grid;grid-template-columns:minmax(300px,1.3fr) minmax(240px,1fr);gap:14px;padding:12px 14px 14px 34px}
	#lkr .dw h4{margin:0 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
	#lkr table.hist{width:100%;min-width:0}
	#lkr table.hist th,#lkr table.hist td{padding:4px 8px;border-bottom:1px solid var(--line2);font-size:11.5px;background:none;position:static}
	#lkr table.hist tr.now td{font-weight:600;background:#eef4fb}
	#lkr dl.kv{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:11.5px}
	#lkr dl.kv dt{color:var(--muted)}
	#lkr dl.kv dd{margin:0;text-align:left}
	#lkr .pl-foot{padding:9px 20px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line)}
	#lkr .pl-save{position:sticky;bottom:0;z-index:20;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 18px;background:#1d2733;color:#fff;border-radius:6px;margin-top:12px;box-shadow:0 -2px 14px rgba(0,0,0,.2)}
	#lkr .pl-save .msg{font-size:11.5px;opacity:.85}
	#lkr .pl-ro{color:var(--muted);font-size:11px}
	#lkr table.pl td.due input{border-color:var(--bad);color:var(--bad);font-weight:600}
	#lkr table.pl td.due{box-shadow:inset 3px 0 0 var(--bad)}
	#lkr .scrim{position:fixed;inset:0;background:rgba(10,16,24,.42);z-index:40}
	#lkr .over{position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:#fff;z-index:41;display:flex;flex-direction:column;border-left:1px solid var(--line)}
	#lkr .overhd{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
	#lkr .overhd h3{margin:0;font-size:14px}
	#lkr .overbody{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:9px}
	#lkr .note{border:1px solid var(--line);border-radius:5px;padding:8px 10px;background:var(--soft)}
	#lkr .note .meta{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;color:var(--muted);margin-bottom:3px}
	#lkr .note .meta b{color:var(--ink2)}
	#lkr .note p{margin:0;font-size:12.5px;line-height:1.5;white-space:pre-wrap}
	#lkr .note.newest{border-color:var(--blue);background:#eef4fb}
	#lkr .mention{padding:1px 4px;border-radius:3px;background:#e7f0fa;color:var(--blue-dk);font-weight:600}
	#lkr .mention.me{background:var(--warn-bg);color:var(--warn)}
	#lkr .overft{border-top:1px solid var(--line);padding:10px 14px;display:flex;flex-direction:column;gap:7px}
	#lkr .acwrap{position:relative}
	#lkr .acwrap textarea{width:100%;box-sizing:border-box;font-family:inherit;font-size:12.5px;padding:6px 8px;border:1px solid #cfd4dc;border-radius:4px;resize:vertical}
	#lkr .ac{position:absolute;left:0;right:0;bottom:calc(100% + 4px);background:#fff;border:1px solid var(--line);border-radius:5px;box-shadow:0 6px 18px rgba(10,16,24,.18);z-index:5;max-height:170px;overflow-y:auto}
	#lkr .acitem{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 10px;font-family:inherit;font-size:12.5px;cursor:pointer}
	#lkr .acitem:hover{background:#eef4fb;color:var(--blue-dk)}
	@media (max-width:700px){#lkr .dw{grid-template-columns:1fr;padding-left:14px}}
	#lkr .wk-cmp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px}
	#lkr .cmp-tile{display:flex;flex-direction:column}
	#lkr .cmp-big{padding:10px 20px 14px}
	#lkr .cmp-big>span{display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
	#lkr .cmp-big>strong{display:block;font-size:30px;font-weight:700;line-height:1.1;margin:4px 0 2px;font-variant-numeric:tabular-nums}
	#lkr .cmp-big>small{display:block;font-size:11.5px;color:var(--muted)}
	#lkr .cmp-deltas{display:grid;grid-template-columns:auto auto;gap:2px 10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line2);font-size:11.5px;align-items:baseline}
	#lkr .cmp-deltas em{font-style:normal;color:var(--muted)}
	#lkr .cmp-deltas span{text-align:right;font-variant-numeric:tabular-nums}
	#lkr details.cmp-more,#lkr details.sec-more{border-top:1px solid var(--line2)}
	#lkr details.cmp-more>summary,#lkr details.sec-more>summary{cursor:pointer;padding:7px 20px;font-size:11.5px;font-weight:600;color:var(--blue-dk);list-style:none}
	#lkr details.cmp-more>summary::-webkit-details-marker,#lkr details.sec-more>summary::-webkit-details-marker{display:none}
	#lkr details.cmp-more>summary::before,#lkr details.sec-more>summary::before{content:'▸ ';display:inline-block;transition:transform .12s;margin-right:5px}
	#lkr details[open].cmp-more>summary::before,#lkr details[open].sec-more>summary::before{transform:rotate(90deg)}
	#lkr .sec-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0;border-top:1px solid var(--line2)}
	#lkr .sec-tile{padding:9px 18px;border-right:1px solid var(--line2);min-width:0}
	#lkr .sec-tile:last-child{border-right:0}
	#lkr .sec-tile span{display:block;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
	#lkr .sec-tile strong{display:block;font-size:19px;font-weight:700;margin:2px 0 1px;font-variant-numeric:tabular-nums}
	#lkr .sec-tile small{display:block;font-size:10.5px;color:var(--muted)}
	#lkr .sec-tile.warn strong{color:var(--warn)}
	#lkr .wk-sec{margin-bottom:12px}
	#lkr.present .wk-sec{display:none}
	#lkr.present .wk-sec.on{display:block}
	#lkr.present .hdr,#lkr.present .wk-head .wk-nav{display:none}
	#lkr .slide-bar{position:fixed;left:0;right:0;bottom:0;z-index:50;display:none;align-items:center;gap:14px;
	  padding:10px 22px;background:#1d2733;color:#fff;font-size:13px}
	#lkr.present .slide-bar{display:flex}
	#lkr .slide-bar .spacer{flex:1}
	#lkr .slide-bar b{font-size:14px}
	#lkr .slide-bar .mk{opacity:.8}
	#lkr .slide-bar .btn{height:30px;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25);color:#fff}
	#lkr .slide-bar .btn:hover{background:rgba(255,255,255,.22)}
	#lkr.present{padding-bottom:64px}
	#lkr.present .sec-tile strong{font-size:24px}
	#lkr.present .cmp-big>strong{font-size:40px}
	@media (max-width:1100px){#lkr .wk-cmp{grid-template-columns:1fr}}
	#lkr .deck{display:none}
	#lkr.present .deck{display:block}
	#lkr.present .wk > .wk-sec,#lkr.present .wk > .wk-head{display:none}
	#lkr .deck-slide{display:none}
	#lkr .deck-slide.on{display:block}
	#lkr.present .deck .wk-sec{display:block;margin-bottom:12px}
	#lkr .deck-head{display:flex;align-items:flex-end;gap:16px;padding:4px 2px 14px;border-bottom:2px solid var(--line);margin-bottom:14px}
	#lkr .deck-head h2{margin:0;font-size:24px;font-weight:700;letter-spacing:-.01em}
	#lkr .deck-head .ay{display:block;font-size:16px;font-weight:700;color:var(--blue);margin-bottom:2px}
	#lkr.present .deck-head .ay{font-size:19px}
	#lkr .deck-head p{margin:4px 0 0;font-size:12.5px;color:var(--muted)}
	#lkr .deck-head .pos{margin-left:auto;font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
	#lkr.present .deck-head h2{font-size:30px}
	#lkr .ay-wrap{overflow-x:auto;padding:0 20px 16px}
	#lkr table.ay-tbl{width:auto;min-width:0;border-collapse:collapse}
	#lkr .ay-tbl th.l,#lkr .ay-tbl td.l{text-align:left;white-space:nowrap;width:230px;padding-right:28px}
	#lkr .ay-tbl th.v,#lkr .ay-tbl td.v{width:190px;text-align:right;font-variant-numeric:tabular-nums;padding-left:0}
	#lkr .ay-tbl thead th{background:var(--soft);border-bottom:2px solid var(--line)}
	#lkr .ay-tbl tbody tr:hover td{background:#eef4fb}
	#lkr .ay-tbl tr.grp td{padding:11px 10px 4px;background:none;border-bottom:1px solid var(--line);
	  font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
	#lkr .ay-tbl td.hi{font-weight:700;font-size:15px}
	#lkr .ay-tbl td .muted.small{display:block;font-weight:400;font-size:10.5px;margin-top:1px}
	#lkr.present .ay-tbl td,#lkr.present .ay-tbl th{font-size:15px;padding:7px 10px}
	#lkr.present .ay-tbl td.hi{font-size:19px}
	</style>`;

	const renderCriteria = (ctx) => {
		const option = (value, text, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(text)}</option>`;
		const lockedOne = ctx.lock && ctx.marketOptions.length === 1;
		const tabs = ctx.hasReport ? `
			<div class="tabs" role="tablist">
				<button type="button" role="tab" data-tab="summary">Summary</button>
				<button type="button" role="tab" data-tab="details">Leasing Details</button>
				<button type="button" role="tab" data-tab="weekly">Weekly Report</button>
				<button type="button" role="tab" data-tab="exceptions">Exceptions${ctx.excludedCount ? `<span class="count">${fInt(ctx.excludedCount)}</span>` : ''}</button>
				<button type="button" role="tab" data-tab="pipeline">Pipeline</button>
			</div>` : '';
		const meta = ctx.hasReport ? `<span class="meta">${fInt(ctx.counted)} counted leases &middot; <a class="lnk" data-goto="exceptions">${fInt(ctx.excludedLeases)} excluded</a> &middot; ${ctx.priorName ? `LY = ${esc(ayShort(ctx.priorName))}` : 'no prior AY in NetSuite'}</span>` : '';
		return `
		<div class="card hdr">
			<div class="hdr-top">
				<div class="ttl"><h2>Lease KPI Reporting</h2><span class="scope${ctx.lock ? ' locked' : ''}">${esc(ctx.scopeLabel)}</span></div>
				<div class="crit">
					<div class="fld"><label for="lkr-ay">Academic Year</label>
						<select id="lkr-ay" data-param="ay">${ctx.academicYears.map((a) => option(a.id, `${a.name}${String(a.id) === ctx.defaultAy ? ' (current)' : ''}`, String(a.id) === ctx.ay)).join('')}</select></div>
					<div class="fld"><label for="lkr-fund">Fund</label>
						<select id="lkr-fund" data-param="fund">${option('', 'All funds', !ctx.fund)}${ctx.fundOptions.map((f) => option(f.key, f.label, f.key === ctx.fund)).join('')}</select></div>
					<div class="fld"><label for="lkr-market">Market</label>
						<select id="lkr-market" data-param="market"${lockedOne ? ' disabled' : ''}>${lockedOne ? '' : option('', ctx.lock ? 'All my markets' : 'All markets', !ctx.market)}${ctx.marketOptions.map((m) => option(m.key, m.label, m.key === ctx.market)).join('')}</select></div>
					<div class="fld"><label for="lkr-basis">Lease Basis</label>
						<select id="lkr-basis" data-param="basis">${option('exec', 'Fully Executed', ctx.basis === 'exec')}${option('pf', 'Pro-forma (incl. In Process)', ctx.basis === 'pf')}</select></div>
					<div class="fld btns"><button type="button" class="btn primary" id="lkr-run">Run</button><button type="button" class="btn" id="lkr-reset" title="Back to the default view">Reset</button></div>
				</div>
			</div>
			${ctx.hasReport ? `<div class="hdr-bot">${tabs}<div class="row">${meta}<label class="switch"><input type="checkbox" id="lkr-desc"> Descriptions</label></div></div>` : ''}
			<div class="error" id="lkr-error"></div>
		</div>`;
	};

	const kpi = (label, value, note, toneClass, yoy) =>
		`<div class="kpi${toneClass ? ` ${toneClass}` : ''}"><span>${label}</span><strong>${value}</strong><small>${note}</small>${yoy ? `<em class="yoy">${yoy}</em>` : ''}</div>`;

	// Tile with comparison lines: rows = [[label, value, deltaHtml], ...]
	const tile = (label, value, toneClass, rows, note) => `
		<div class="kpi tile${toneClass ? ` ${toneClass}` : ''}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}
			${rows.filter(Boolean).length ? `<dl>${rows.filter(Boolean).map((r) => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd><dd class="d">${r[2] || ''}</dd></div>`).join('')}</dl>` : ''}</div>`;

	const notesRow = (notes) => `<tr class="notes">${notes.map((n) => `<th>${esc(n)}</th>`).join('')}</tr>`;
	const leaseLink = (e) => (e.link ? `<a class="lnk" href="${esc(e.link)}" target="_blank">${esc(e.name)}</a>` : esc(e.name));
	const exclLink = (n) => (n ? `<a class="lnk" data-goto="exceptions">${fInt(n)}</a>` : '0');

	// ---- Summary ----
	// [label, description, cell, needsPrior]
	const SUM_COLS = [
		['Total Beds', 'Sum of bed counts (bedroom records; unit or property bed counts where there are none).', (r) => fInt(r.beds)],
		['Occupied', 'Beds covered by a counted lease.', (r) => fInt(r.occ)],
		['Vacant', 'Total Beds less Occupied.', (r) => fInt(r.vacant)],
		['Occ. %', 'Occupied ÷ Total Beds. Colour = pace vs LY Same Date when there is a prior AY.', (r) => pacePill(r.occPct, r.lyWkDelta)],
		['LY Same Date', 'Prior AY occupancy counting only leases dated on or before the same point in the leasing cycle (pace).', (r) => fPct(r.lyWkOccPct), true],
		['vs LY', 'Occ. % less LY Same Date, in percentage points.', (r) => dlt(r.lyWkDelta, fPts), true],
		['LY Final', 'Prior AY occupancy, all counted leases.', (r) => fPct(r.pOccPct), true],
		['Fin. Occ. %', 'Occupied beds × MIN(lease months, 12) ÷ 12 ÷ Total Beds.', (r) => fPct(r.finPct)],
		['Total Revenue', 'Rent actual, full lease term, on counted leases.', (r) => fMoney(r.trev)],
		['Rev. vs LY', 'Total Revenue vs the prior AY at the same date.', (r) => dlt(r.trevPace, fGrowth), true],
		['Excluded', "Leases left out (conflict / can't be placed).", (r) => exclLink(r.excluded)]
	];

	const groupTable = (id, title, subtitle, nameNote, groups, total, cols) => `
		<div class="card">
			<div class="head"><div><h3>${title}</h3><p class="sec-note">${subtitle}</p></div>
				<div class="row"><button type="button" class="btn sm" data-expand="${id}">Expand All</button><button type="button" class="btn sm" data-collapse="${id}">Collapse All</button></div></div>
			<div class="wrap"><table class="dense grouped" id="${id}">
				<thead>
					<tr><th class="l">Name</th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr>
					${notesRow([nameNote, ...cols.map((c) => c[1])])}
				</thead>
				<tbody>${groups.map((g, gi) => `<tr class="grp" data-grp="${id}-${gi}"><td class="l">${g.children.length > 1 ? `<button type="button" class="caret" aria-label="Expand ${esc(g.row.name)}">&#9654;</button>` : '<span class="sp"></span>'}<strong>${esc(g.row.name)}</strong></td>${cols.map((c) => `<td>${c[2](g.row)}</td>`).join('')}</tr>${
					g.children.length > 1 ? g.children.map((c) => `<tr class="kid" data-parent="${id}-${gi}" hidden><td class="l kidname">${esc(c.name)}</td>${cols.map((col) => `<td>${col[2](c)}</td>`).join('')}</tr>`).join('') : ''}`).join('')}</tbody>
				${groups.length > 1 ? `<tfoot><tr><td class="l">Total</td>${cols.map((c) => `<td>${c[2](total)}</td>`).join('')}</tr></tfoot>` : ''}
			</table></div>
		</div>`;

	const TYPE_COLS = [
		['Occupied Beds', 'Beds occupied by counted leases of this type.', (r) => fInt(r.occ)],
		['% of Occupied', 'Occupied Beds ÷ all Occupied Beds.', (r) => fPct(r.occShare)],
		['Occ. %', 'Occupied Beds ÷ Total Beds.', (r) => fPct(r.occPct)],
		['LY Same Date', 'Prior AY beds on this lease type at the same date ÷ Total Beds.', (r) => fPct(r.lyWkOccPct), true],
		['vs LY', 'Percentage points vs LY Same Date.', (r) => dlt(r.lyWkDelta, fPts), true],
		['Leases', 'Counted leases of this type.', (r) => fInt(r.leases)],
		['Total Revenue', 'Rent actual, full term.', (r) => fMoney(r.trev)],
		['Rev. vs LY', 'Total Revenue vs the prior AY at the same date.', (r) => dlt(r.trevPace, fGrowth), true],
		['Excluded', "Leases of this type left out (conflict / can't be placed).", (r) => exclLink(r.excluded)]
	];

	const renderSummary = (s, ctx) => {
		const p = s.portfolio;
		const ly = ctx.priorName ? ayShort(ctx.priorName) : null;
		const hasPace = ly && isNum(p.lyWkOccPct);
		const cols = SUM_COLS.filter((c) => !c[3] || hasPace);
		const tcols = TYPE_COLS.filter((c) => !c[3] || hasPace);
		const v = ctx.vacancy;
		const paceRow = (val, d) => (hasPace ? ['Same date LY', val, d] : null);
		const finalRow = (val, d) => (ly ? ['LY final', val, d] : null);
		const typeTotal = {
			occ: p.occ, occShare: p.occ ? 1 : null, occPct: p.occPct, lyWkOccPct: p.lyWkOccPct, lyWkDelta: p.lyWkDelta, leases: p.leases,
			trev: p.trev, trevPace: p.trevPace, excluded: p.excluded
		};
		const tagClass = { 'Whole House': 't-wh', Unit: 't-unit', Bedroom: 't-bed' };
		const tiesOk = s.ties.people && s.ties.mrev && s.ties.trev;
		const recent = ctx.recent || [];
		const paceNote = hasPace ? `“Same date” counts ${esc(ly)} leases ${ctx.basis === 'pf' ? 'sent' : 'signed'} on or before ${esc(fDate(ctx.lyAsOf))}, the same point in the leasing cycle as today.` : '';
		return `
		<div class="kpis six">
			${tile('Total Beds', fInt(p.beds), '', [['Properties', fInt(s.propertyCount), ''], ['Markets', fInt(s.byMarket.length), '']])}
			${tile('Occupied Beds', fInt(p.occ), '', [paceRow(fInt(p.lyWkOcc), dlt(isNum(p.lyWkOcc) ? p.occ - p.lyWkOcc : null, fSigned)), finalRow(fInt(p.pOcc), dlt(isNum(p.pOcc) ? p.occ - p.pOcc : null, fSigned))], esc(ctx.basisLabel))}
			${tile('Occupancy', fPct(p.occPct), hasPace ? paceTone(p.lyWkDelta) : tone(p.occPct), [paceRow(fPct(p.lyWkOccPct), dlt(p.lyWkDelta, fPts)), finalRow(fPct(p.pOccPct), dlt(p.occDelta, fPts))])}
			${tile('Vacant Beds', fInt(p.vacant), '', [['Fully vacant units', fInt(v.fullUnits), `${fInt(v.fullBeds)} beds`], ['Partly vacant units', fInt(v.partUnits), `${fInt(v.partBeds)} beds`]])}
			${tile('Financial Occupancy', fPct(p.finPct), tone(p.finPct), [finalRow(fPct(p.pFinPct), dlt(isNum(p.pFinPct) ? p.finPct - p.pFinPct : null, fPts))], 'Lease months capped at 12')}
			${tile('Total Revenue', fMoney(p.trev), '', [paceRow(fMoneyK(p.lyWkTrev), dlt(p.trevPace, fGrowth)), finalRow(fMoneyK(p.pTrev), dlt(p.trevYoY, fGrowth))], 'Rent actual, full term')}
		</div>
		${paceNote ? `<p class="sec-note pace-note">${paceNote}</p>` : ''}

		${groupTable('lkr-mkttbl', 'By Market', `Market = property City. Expand a market for its funds.${ly ? ` LY = ${esc(ly)}.` : ''}`, 'Market ▸ Fund.', s.byMarketTree, p, cols)}
		${groupTable('lkr-fundtbl', 'By Fund', `Fund = top-level subsidiary (Amicus I / II / III). Expand a fund for its markets.${ly ? ` LY = ${esc(ly)}.` : ''}`, 'Fund ▸ Market.', s.byFundTree, p, cols)}

		<div class="card">
			<div class="head"><div><h3>By Lease Type</h3><p class="sec-note">Whole House covers every bed in a property (or the linked house). Unit covers every bed in a unit. Bedroom covers one bedroom.</p></div></div>
			<div class="wrap"><table class="dense">
				<thead>
					<tr><th class="l">Lease Type</th>${tcols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr>
					${notesRow(['Whole House / Unit / Bedroom', ...tcols.map((c) => c[1])])}
				</thead>
				<tbody>${s.byLeaseType.map((r) => `<tr class="${r.leases || r.excluded || r.pLeases ? '' : 'zero'}"><td class="l"><span class="tag ${tagClass[r.name]}">${esc(r.name)}</span></td>${tcols.map((c) => `<td>${c[2](r)}</td>`).join('')}</tr>`).join('')}</tbody>
				<tfoot><tr><td class="l">Total</td>${tcols.map((c) => `<td>${c[2](typeTotal)}</td>`).join('')}</tr></tfoot>
			</table></div>
		</div>


		${(() => {
			const st = s.shortTerm;
			if (!st || !st.properties) return '';
			const t = st.total;
			return `<details class="card fold" open>
				<summary class="head"><div><h3>Short-term rentals<em>${fInt(st.properties)} ${st.properties === 1 ? 'property' : 'properties'} &middot; ${fInt(t.beds)} beds &middot; ${fMoney(t.trev)}</em></h3>
					<p class="sec-note">Nightly and short-stay lettings. <strong>Not</strong> in any figure above: the booking cycle has nothing to do with the academic year and rent per bed runs several times the student rate, so mixing them would distort pre-lease and rent/bed.</p></div></summary>
				<div class="wrap"><table class="dense">
					<thead><tr><th class="l">Property</th><th class="l">Market</th><th class="l">Fund</th><th>Beds</th><th>Occupied</th><th>Occ. %</th><th>Leases</th><th>Excluded</th><th>Rent / Bed</th><th>Total Revenue</th></tr></thead>
					<tbody>${st.rows.map((r) => `<tr><td class="l">${esc(r.name)}</td><td class="l">${esc(r.market || '\u2013')}</td><td class="l">${esc(r.fund || '\u2013')}</td><td>${fInt(r.beds)}</td><td>${fInt(r.occ)}</td><td>${fPct(r.occPct)}</td><td>${fInt(r.leases)}</td><td>${fInt(r.excluded)}</td><td>${fMoney(r.rentBed)}</td><td>${fMoney(r.trev)}</td></tr>`).join('')}</tbody>
				</table></div>
			</details>`;
		})()}

		${(() => {
			const o = s.other;
			if (!o || !o.properties) return '';
			return `<details class="card fold"${o.leases ? ' open' : ''}>
				<summary class="head"><div><h3>Commercial, land &amp; office<em>${fInt(o.leased)} of ${fInt(o.properties)} leased &middot; ${fMoney(o.annual)}/yr</em></h3>
					<p class="sec-note">No student beds, so these are reported on rent alone and never touch occupancy. Annual is monthly &times; 12: Total Rent on these records holds a year, not the contract value, so a multi-year commercial lease would read short.</p></div></summary>
				<div class="wrap"><table class="dense">
					<thead><tr><th class="l">Property</th><th class="l">Market</th><th class="l">Fund</th><th class="l">Status</th><th>Leases</th><th>Monthly Rent</th><th>Annual Rent</th><th>Term Start</th><th>Term End</th></tr></thead>
					<tbody>${o.rows.map((r) => `<tr class="${r.leases ? '' : 'zero'}"><td class="l">${esc(r.name)}</td><td class="l">${esc(r.market || '\u2013')}</td><td class="l">${esc(r.fund || '\u2013')}</td><td class="l">${esc(r.status)}</td><td>${fInt(r.leases)}</td><td>${fMoney2(r.monthly)}</td><td>${fMoney(r.annual)}</td><td>${fDate(r.start)}</td><td>${fDate(r.end)}</td></tr>`).join('')}</tbody>
					<tfoot><tr><td class="l" colspan="4">Total</td><td>${fInt(o.leases)}</td><td>${fMoney2(o.monthly)}</td><td>${fMoney(o.annual)}</td><td></td><td></td></tr></tfoot>
				</table></div>
			</details>`;
		})()}

		<details class="card fold"${recent.length ? ' open' : ''}>
			<summary class="head"><div><h3>New Lease Records<em>created in the last 3 days &middot; ${fInt(recent.length)}</em></h3>
				<p class="sec-note">Active lease records created since ${esc(fDate(ctx.recentSince))}, all academic years${ctx.fund || ctx.market ? ', selected fund/market' : ''}.</p></div></summary>
			${recent.length ? `<div class="wrap scroll"><table class="dense">
				<thead><tr><th class="l">Lease</th><th class="l">Academic Year</th><th class="l">Status</th><th class="l">Market</th><th class="l">Property</th><th class="l">Units/Bedroom</th><th class="l">Lease Type</th><th>Tenants</th><th>Monthly Rent</th><th>Sent</th><th>Signed</th><th>Created</th></tr></thead>
				<tbody>${recent.map((e) => `<tr><td class="l">${leaseLink(e)}</td><td class="l">${esc(e.ay || '–')}</td><td class="l">${esc(e.status)}</td><td class="l">${esc(e.market || '–')}</td><td class="l">${esc(e.property || '–')}</td><td class="l">${esc(e.linked || '–')}</td><td class="l">${esc(e.type)}</td><td>${fInt(e.people)}</td><td>${fMoney2(e.mrev)}</td><td>${fDate(e.sent)}</td><td>${fDate(e.signed)}</td><td>${esc(e.created)}</td></tr>`).join('')}</tbody>
			</table></div>` : '<div class="empty"><strong>No new lease records</strong>Nothing created in the last 3 days.</div>'}
		</details>
		<div class="ties${tiesOk ? '' : ' bad'}">${tiesOk ? '&#10003; People, monthly and total revenue tie to the counted leases.' : '&#9888; Allocated totals do not tie to the counted leases. Check the script log.'}</div>`;
	};

	// ---- Leasing Details: one tree, report types pick the column groups ----
	const REPORT_TYPES = [
		{ key: 'occrev', label: 'Occupancy & Revenue', groups: ['occ', 'rev'], note: 'Beds, occupancy and revenue at every level.' },
		{ key: 'yoy', label: 'Year over Year', groups: ['yoy'], note: 'Occupied beds, occupancy and monthly revenue vs the prior academic year (final).' },
		{ key: 'vacancy', label: 'Vacancy', groups: ['occ', 'tgt'], vac: true, note: 'Only properties, units and bedrooms with vacant beds, with their target rent.' },
		{ key: 'rent', label: 'Rent & Same-Store', groups: ['rev', 'rent'], note: 'Rent per bed and per person; same-store rent on units 100% leased in both years.' },
		{ key: 'tgt', label: 'Targets', groups: ['occ', 'tgt'], note: 'Academic Year Details target and settle rent vs actual.' },
		{ key: 'lease', label: 'Leases & Headcount', groups: ['head', 'type', 'term'], note: 'People, lease counts, lease-type mix and lease terms.' },
		{ key: 'all', label: 'All Columns', groups: ['occ', 'rev', 'yoy', 'rent', 'tgt', 'head', 'type', 'term'], note: 'Every column (wide).' }
	];
	const COL_GROUPS = ['occ', 'rev', 'yoy', 'rent', 'tgt', 'head', 'type', 'term'];
	const reportTypeCss = () => REPORT_TYPES.map((rt) => COL_GROUPS.filter((g) => rt.groups.indexOf(g) < 0)
		.map((g) => `#lkr table.tree[data-rt="${rt.key}"] .g-${g}`).join(',')).filter(Boolean).map((sel) => `${sel}{display:none}`).join('\n');

	const renderDetails = (s, ctx) => {
		const p = s.portfolio;
		const v = ctx.vacancy;
		const ly = ctx.priorName ? ayShort(ctx.priorName) : 'Prior AY (none)';
		const cur = ayShort(ctx.ayName);
		return `
		<style>${reportTypeCss()}</style>
		<div class="card">
			<div class="head">
				<div class="row rt-pick"><label for="lkr-rt">Report</label>
					<select id="lkr-rt">${REPORT_TYPES.map((rt) => `<option value="${rt.key}">${esc(rt.label)}</option>`).join('')}</select>
					<span class="sec-note" id="lkr-rt-note"></span></div>
				<div class="row">
					<input type="search" id="lkr-find" placeholder="Find property…" aria-label="Find property">
					<button type="button" class="btn sm" id="lkr-tree-expand">Expand All</button>
					<button type="button" class="btn sm" id="lkr-tree-collapse">Collapse All</button>
					<button type="button" class="btn sm" id="lkr-tree-export">Export CSV</button>
				</div>
			</div>
			<div class="kpis four inset" id="lkr-vac-kpis" hidden>
				${tile('Vacant Beds', fInt(p.vacant), '', [], `of ${fInt(p.beds)} beds &middot; ${fPct(p.vacPct)}`)}
				${tile('Fully Vacant Units', fInt(v.fullUnits), '', [], `${fInt(v.fullBeds)} beds, no counted lease`)}
				${tile('Partly Vacant Units', fInt(v.partUnits), '', [], `${fInt(v.partBeds)} vacant beds`)}
				${tile('Vacant Target Rent', fMoney(p.tgtVacant), '', [], 'Monthly target on vacant beds')}
			</div>
			<div class="wrap"><table class="tree" id="lkr-tree" data-rt="occrev">
				<thead>
					<tr class="gh">
						<th class="l" rowspan="3">Fund / Market / Property / Unit / Bedroom</th>
						<th class="grp-start" rowspan="3">Total Beds</th>
						<th class="g-occ grp-start" colspan="4">Occupancy &middot; ${esc(cur)}</th>
						<th class="g-rev grp-start" colspan="2">Revenue &middot; ${esc(cur)}</th>
						<th class="g-yoy grp-start yoyh" colspan="9">${esc(cur)} <span class="vs">vs</span> ${esc(ly)}</th>
						<th class="g-rent grp-start" colspan="6">Rent &middot; ${esc(cur)}</th>
						<th class="g-tgt grp-start" colspan="6">Targets &middot; Academic Year Details</th>
						<th class="g-head grp-start" colspan="3">Headcount</th>
						<th class="g-type grp-start" colspan="3">Occupied by Lease Type</th>
						<th class="g-term grp-start" colspan="4">Lease Term</th>
					</tr>
					<tr>
						<th class="g-occ grp-start" rowspan="2">Occupied</th><th class="g-occ" rowspan="2">Vacant</th><th class="g-occ" rowspan="2">Occupancy %</th><th class="g-occ" rowspan="2">Financial Occ. %</th>
						<th class="g-rev grp-start" rowspan="2">Monthly Revenue</th><th class="g-rev" rowspan="2">Total Revenue</th>
						<th class="g-yoy grp-start ctr" colspan="3">Occupied Beds</th><th class="g-yoy grp-start ctr" colspan="3">Occupancy %</th><th class="g-yoy grp-start ctr" colspan="3">Monthly Revenue</th>
						<th class="g-rent grp-start" rowspan="2">Rent / Bed</th><th class="g-rent" rowspan="2">Rent / Person</th><th class="g-rent grp-start ctr" colspan="4">Same-Store Rent (100% leased both years)</th>
						<th class="g-tgt grp-start" rowspan="2">Target Rent (Monthly)</th><th class="g-tgt" rowspan="2">Target / Bed</th><th class="g-tgt" rowspan="2">Actual vs Target</th><th class="g-tgt" rowspan="2">Vacant Target Rent</th><th class="g-tgt" rowspan="2">Settle Rent (Monthly)</th><th class="g-tgt" rowspan="2">Prior-Yr Rent / Bed</th>
						<th class="g-head grp-start" rowspan="2">People</th><th class="g-head" rowspan="2">Active Leases</th><th class="g-head" rowspan="2">Excluded</th>
						<th class="g-type grp-start" rowspan="2">Whole House</th><th class="g-type" rowspan="2">Unit</th><th class="g-type" rowspan="2">Bedroom</th>
						<th class="g-term grp-start l" rowspan="2">Lease Type</th><th class="g-term" rowspan="2">Lease Start</th><th class="g-term" rowspan="2">Lease End</th><th class="g-term" rowspan="2">Months</th>
					</tr>
					<tr class="yr">
						${['', '', ''].map((x, i) => `<th class="g-yoy grp-start cy">${esc(cur)}</th><th class="g-yoy py">${esc(ly)}</th><th class="g-yoy">${i === 1 ? 'Change (pts)' : (i === 2 ? 'YoY %' : 'Change')}</th>`).join('')}
						<th class="g-rent grp-start">Beds</th><th class="g-rent cy">${esc(cur)}</th><th class="g-rent py">${esc(ly)}</th><th class="g-rent">YoY %</th>
					</tr>
				</thead>
				<tbody id="lkr-tbody"></tbody>
				<tfoot id="lkr-tfoot"></tfoot>
			</table></div>
			<p class="sec-note foot-note">Fund &rsaquo; Market &rsaquo; Property &rsaquo; Unit &rsaquo; Bedroom &middot; ${fInt(s.propertyCount)} properties. Export CSV includes every column for the selected report.</p>
		</div>`;
	};

	const leaseTable = (rows, cols, empty) => (rows.length ? `<div class="wrap scroll"><table class="dense">
		<thead><tr>${cols.map((c) => `<th class="${c[2] ? 'l' : ''}">${c[0]}</th>`).join('')}</tr></thead>
		<tbody>${rows.map((r) => `<tr data-mk="${esc(keyify(r.market || ''))}" data-beds="${Number(r.beds) || 0}" data-trev="${Number(r.trev) || 0}" data-mrev="${Number(r.mrev) || 0}">${cols.map((c) => `<td class="${c[2] ? 'l' : ''}">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody>
	</table></div>` : `<div class="empty"><strong>${empty}</strong></div>`);

	// ---- Weekly report: one tile row (this week vs prior week vs same week LY), market breakdown, trend, detail ----
	const renderWeekly = (w, ctx) => {
		if (!w) return '<div class="card empty"><strong>Weekly report unavailable</strong>Select an academic year.</div>';
		const sel = w.sel || {};
		const prev = w.prev || {};
		const ly = w.hasPrior && ctx.priorName ? ayShort(ctx.priorName) : null;
		const signedWord = w.basis === 'pf' ? 'Sent' : 'Signed';
		const basisNote = w.basis === 'pf' ? 'Pro-forma, dated by Lease Sent Date' : 'Fully Executed, dated by Lease Signed Date';
		const pl = w.pipeline;
		const diff = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
		const pw = (val, d) => ['Prior week', val, d];
		const lw = (val, d) => (ly ? ['Same week LY', val, d] : null);
		const option = (value, text, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(text)}</option>`;
		const groupLabel = w.groupBy === 'fund' ? 'Fund' : 'Market';
		const g = w.byGroup || [];
		const gRow = (r, total) => `<tr${total ? ' class="tot"' : ''}><td class="l">${total ? '<strong>Total</strong>' : esc(r.name)}</td><td>${fInt(r.beds)}</td><td>${ly ? pacePill(r.occPct, r.vsLyPct) : pill(r.occPct)}</td><td>${dlt(r.dOccPct, fPts)}</td>${ly ? `<td>${fPct(r.lyOccPct)}</td><td>${dlt(r.vsLyPct, fPts)}</td>` : ''}<td>${fInt(r.newBeds)}</td>${ly ? `<td>${fInt(r.lyNewBeds)}</td>` : ''}<td>${fInt(r.inProcess)}</td><td>${fMoney(r.trev)}</td>${ly ? `<td>${dlt(r.trevPace, fGrowth)}</td>` : ''}</tr>`;
		const totalRow = {
			beds: w.totalBeds, occPct: sel.occPct, dOccPct: sel.dOccPct, lyOccPct: sel.lyOccPct, vsLyPct: sel.vsLyPct, newBeds: sel.newBeds, lyNewBeds: sel.lyNewBeds,
			inProcess: pl.now, trev: sel.trev, trevPace: isNum(sel.lyTrev) && sel.lyTrev > 0 ? sel.trev / sel.lyTrev - 1 : null
		};
		const rows = w.history.slice().reverse();
		const histRow = (h, i) => `<tr class="${h.week === w.week ? 'cur' : ''}" data-i="${i}"${i >= 8 ? ' hidden' : ''}><td class="l">${fDate(h.week)} – ${fDate(h.weekEnd)}</td><td>${fInt(h.newLeases)}</td><td>${fInt(h.newBeds)}</td><td>${fInt(h.occ)}</td><td>${fPct(h.occPct)}</td><td>${dlt(h.dOccPct, fPts)}</td><td>${fMoney(h.trev)}</td>${ly ? `<td>${fInt(h.lyNewBeds)}</td><td>${fPct(h.lyOccPct)}</td><td>${dlt(h.vsLyPct, fPts)}</td>` : ''}</tr>`;
		// Rent per bed for this lease, beside the same unit's rent per bed in the prior AY.
		const rbCols = ly ? [
			['Rent / Bed', (r) => (r.rentBed === null ? '–' : fMoney2(r.rentBed))],
			[`${esc(ly)} Rent / Bed`, (r) => (r.lyRentBed === null || r.lyRentBed === undefined ? '<span class="muted">n/a</span>' : `${fMoney2(r.lyRentBed)}${r.lyPartial ? '<span class="muted">*</span>' : ''}`)],
			['vs LY', (r) => (isNum(r.rentBedPct) ? dlt(r.rentBedPct, fGrowth) : '<span class="muted">–</span>')]
		] : [['Rent / Bed', (r) => (r.rentBed === null ? '–' : fMoney2(r.rentBed))]];
		const inProcessCols = [
			['Lease', leaseLink, true], ['Market', (r) => esc(r.market || '–'), true], ['Property', (r) => esc(r.property || '–'), true],
			['Units/Bedroom', (r) => esc(r.linked || '–'), true], ['Lease Type', (r) => esc(r.type), true], ['Tenants', (r) => fInt(r.people)], ['Monthly Rent', (r) => fMoney2(r.mrev)],
			['Sent', (r) => fDate(r.sent)], ['Days in Process', (r) => (r.days === null ? '–' : `<strong class="${r.days > 21 ? 'late' : ''}">${fInt(r.days)}</strong>`)], ['Note', (r) => esc(r.note || ''), true]
		].slice(0, 7).concat(rbCols, [
			['Sent', (r) => fDate(r.sent)], ['Days in Process', (r) => (r.days === null ? '–' : `<strong class="${r.days > 21 ? 'late' : ''}">${fInt(r.days)}</strong>`)], ['Note', (r) => esc(r.note || ''), true]
		]);
		const execCols = [
			['Lease', leaseLink, true], ['Market', (r) => esc(r.market || '–'), true], ['Property', (r) => esc(r.property || '–'), true],
			['Units/Bedroom', (r) => esc(r.linked || '–'), true], ['Lease Type', (r) => esc(r.type), true], ['Beds', (r) => (r.beds === null ? '–' : fInt(r.beds))], ['Tenants', (r) => fInt(r.people)],
			['Monthly Rent', (r) => fMoney2(r.mrev)]
		].concat(rbCols, [['Sent', (r) => fDate(r.sent)], ['Signed', (r) => fDate(r.signed)], ['Note', (r) => esc(r.note || ''), true]]);
		const sentCols = [
			['Lease', leaseLink, true], ['Market', (r) => esc(r.market || '–'), true], ['Property', (r) => esc(r.property || '–'), true],
			['Units/Bedroom', (r) => esc(r.linked || '–'), true], ['Lease Type', (r) => esc(r.type), true], ['Beds', (r) => (r.beds === null ? '–' : fInt(r.beds))], ['Tenants', (r) => fInt(r.people)],
			['Monthly Rent', (r) => fMoney2(r.mrev)]
		].concat(rbCols, [['Sent', (r) => fDate(r.sent)], ['Signed', (r) => fDate(r.signed)], ['Note', (r) => esc(r.note || ''), true]]);

		// The YoY strip that sits above each of the two per-lease sections.
		const yoyStrip = (y, word) => {
			if (!y) return '';
			if (!y.ly) {
				const why = y.lyUnusable
					? `${esc(ly)} has too few Lease Sent Dates to compare against.`
					: (ly ? `No ${word.toLowerCase()} leases in the same week of ${esc(ly)}.` : 'No prior academic year in NetSuite.');
				return `<p class="sec-note yoy-none">Year over year: <strong>n/a</strong> &middot; ${why}</p>`;
			}
			// A prior AY short of Lease Sent Dates understates its own counts, so the volume deltas are not
			// like-for-like. Rent per bed is a ratio over whatever did match, so it still stands.
			const thin = !!y.volumeThin;
			const cell = (label, tyv, lyv, d, pct, drop) => `<div class="yoy-cell${drop ? ' thin' : ''}"><span>${label}</span>
				<strong>${tyv}</strong>
				<em>${esc(ly)} ${lyv}</em>
				<div>${drop ? '<span class="muted">not comparable</span>' : `${d === null ? '' : `${dlt(d.v, d.f)} `}${isNum(pct) ? dlt(pct, fGrowth) : ''}`}</div></div>`;
			const note = thin
				? `<p class="sec-note yoy-none">&#9888; ${esc(ly)} has a Lease Sent Date on ${fInt(y.coverage.sent)} of its ${fInt(y.coverage.signed)} signed leases, so its count here is a floor. Leases, Beds and Revenue are shown but not compared; Rent / Bed is a per-bed average of what did match and still stands.</p>`
				: '';
			return `<div class="yoy-strip">
				${cell('Leases', fInt(y.ty.leases), fInt(y.ly.leases), { v: y.dLeases, f: fSigned }, y.leasesPct, thin)}
				${cell('Beds', fInt(y.ty.beds), fInt(y.ly.beds), { v: y.dBeds, f: fSigned }, y.bedsPct, thin)}
				${cell('Rent / Bed', fMoney2(y.ty.rentBed), fMoney2(y.ly.rentBed), { v: y.dRentBed, f: (v) => (isNum(v) ? `${sign(v)}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '–') }, y.rentBedPct, false)}
				<div class="yoy-cell${thin ? ' thin' : ''}"><span>Total Revenue</span><strong>${thin ? '<span class="muted">n/a</span>' : (isNum(y.trevPct) ? dlt(y.trevPct, fGrowth) : '<span class="muted">–</span>')}</strong><em>vs ${esc(ly)}</em><div></div></div>
			</div>${note}`;
		};
		const inactCols = [
			['Lease', leaseLink, true], ['Academic Year', (r) => esc(r.ay || '–'), true], ['Market', (r) => esc(r.market || '–'), true],
			['Property', (r) => esc(r.property || '–'), true], ['Units/Bedroom', (r) => esc(r.linked || '–'), true], ['Monthly Rent', (r) => fMoney2(r.mrev)],
			['Inactivated', (r) => esc(r.changed), true], ['By', (r) => esc(r.changedBy), true], ['Now', (r) => (r.stillInactive ? 'Inactive' : '<span class="pill ok">Reactivated</span>'), true]
		];
		const undated = w.undated.leases ? `<p class="warn-note">&#9888; ${fInt(w.undated.leases)} counted lease${w.undated.leases === 1 ? '' : 's'} (${fInt(w.undated.beds)} beds) have no ${w.basis === 'pf' ? 'sent or signed' : 'signed'} date, so the weekly figures leave them out (Exceptions &rsaquo; Lease Records).</p>` : '';
		const fold = (title, count, note, body, open) => `<details class="card fold"${open ? ' open' : ''}><summary class="head"><div><h3>${title}<em>${count}</em></h3>${note ? `<p class="sec-note">${note}</p>` : ''}</div></summary>${body}</details>`;

		// ---- To-date comparison tiles: academic year, month, week, left to right ----
		// Each tile is always visible and leads with the one number that summarises the section it
		// belongs to; the full table sits behind a disclosure so the headline stays readable at a glance
		// and in Present mode.
		const c = w.cmp || null;
		const fMoneySigned = (v) => (isNum(v) ? `${sign(v)}${fMoneyK(Math.abs(v))}` : '–');
		const rentBedOf = (x) => (x && x.beds > 0 ? x.mrev / x.beds : null);
		const dMoney0 = (v) => (isNum(v) ? `${sign(v)}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '–');
		const cRow = (label, p, pwp, key, money) => {
			const f = money ? fMoney : fInt;
			const dv = p.d ? p.d[key] : null;
			const pv = p.pct ? p.pct[key] : null;
			// Movement since the same window a week ago, this year - separate from the year-on-year pair.
			const wow = pwp ? p.ty[key] - pwp.ty[key] : null;
			return `<tr><td class="l">${label}</td><td>${f(p.ty[key])}</td><td>${p.ly ? f(p.ly[key]) : '<span class="muted">n/a</span>'}</td>` +
				`<td>${p.ly ? `${dlt(dv, money ? fMoneySigned : fSigned)}${isNum(pv) ? `<span class="sub ${dcls(pv)}">${fGrowth(pv)}</span>` : ''}` : '<span class="muted">–</span>'}</td>` +
				`<td>${pwp ? dlt(wow, money ? fMoneySigned : fSigned) : '<span class="muted">–</span>'}</td></tr>`;
		};
		// The $ move in rent per bed year on year, which is the number that actually prices the book.
		const rentBedRow = (p, pwp) => {
			const ty = rentBedOf(p.ty), lyv = p.ly ? rentBedOf(p.ly) : null;
			const pwv = pwp ? rentBedOf(pwp.ty) : null;
			const d = isNum(ty) && isNum(lyv) ? ty - lyv : null;
			const pct = isNum(ty) && isNum(lyv) && lyv > 0 ? ty / lyv - 1 : null;
			return `<tr><td class="l">Rent / Bed</td><td>${fMoney2(ty)}</td><td>${isNum(lyv) ? fMoney2(lyv) : '<span class="muted">n/a</span>'}</td>` +
				`<td>${isNum(d) ? `${dlt(d, dMoney0)}${isNum(pct) ? `<span class="sub ${dcls(pct)}">${fGrowth(pct)}</span>` : ''}` : '<span class="muted">–</span>'}</td>` +
				`<td>${isNum(ty) && isNum(pwv) ? dlt(ty - pwv, dMoney0) : '<span class="muted">–</span>'}</td></tr>`;
		};
		const cmpCard = (p, kind, pwp, tail) => {
			const headline = kind === 'year' ? fPct(p.ty.occPct) : fInt(p.ty.leases);
			const headLabel = kind === 'year' ? 'Pre-lease %' : `Leases ${signedWord}`;
			const sub = kind === 'year' ? `${fInt(p.ty.beds)} of ${fInt(w.totalBeds)} beds`
				: `${fInt(p.ty.beds)} beds &middot; ${fMoneyK(p.ty.trev)}`;
			const vsLy = p.d ? (kind === 'year' ? dlt(p.d.occPts, fPts) : dlt(p.d.leases, fSigned)) : '<span class="muted">–</span>';
			const vsPw = pwp ? (kind === 'year'
				? dlt(isNum(p.ty.occPct) && isNum(pwp.ty.occPct) ? p.ty.occPct - pwp.ty.occPct : null, fPts)
				: dlt(p.ty.leases - pwp.ty.leases, fSigned)) : '<span class="muted">–</span>';
			return `
			<div class="card cmp-tile">
				<div class="head"><div><h3>${esc(p.label)}</h3>
					<p class="sec-note">${p.from ? `${fDate(p.from)} – ` : 'Through '}${fDate(p.to)}${p.ly ? ` &middot; ${esc(ly)} ${p.lyFrom ? `${fDate(p.lyFrom)} – ` : 'through '}${fDate(p.lyTo)}` : ''}</p></div></div>
				<div class="cmp-big" data-cmp="${kind}">
					<span>${esc(headLabel)}</span>
					<strong data-cmp-head>${headline}</strong>
					<small data-cmp-sub>${sub}</small>
					<div class="cmp-deltas"><em>vs ${esc(ly || 'LY')}</em><span data-cmp-ly>${vsLy}</span><em>vs prior wk</em><span data-cmp-pw>${vsPw}</span></div>
				</div>
				<details class="cmp-more"><summary>Detail</summary>
				<div class="wrap"><table class="dense cmp-tbl">
					<thead><tr><th class="l">Metric</th><th>This Year</th><th>${ly ? esc(ly) : 'Last Year'}</th><th>vs LY</th><th>vs Prior Wk</th></tr></thead>
					<tbody>${cRow('Beds Leased', p, pwp, 'beds')}${cRow(`Leases ${signedWord}`, p, pwp, 'leases')}${cRow('Revenue Leased', p, pwp, 'trev', true)}${rentBedRow(p, pwp)}${tail || ''}</tbody>
				</table></div></details>
			</div>`;
		};
		const yearTail = !c ? '' : (c.undatedBeds
			? `<tr class="recon"><td class="l">Not yet dated<span class="sub">${fInt(c.undatedLeases)} lease${c.undatedLeases === 1 ? '' : 's'} with no ${w.basis === 'pf' ? 'sent or signed' : 'signed'} date: counted on Summary, in no week</span></td><td>${fInt(c.undatedBeds)}</td><td><span class="muted">–</span></td><td><span class="muted">–</span></td><td><span class="muted">–</span></td></tr>` : '');
		const pwOf = (k) => (c && c.pw ? c.pw[k] : null);
		const cmpPanels = c ? `<div class="wk-cmp">${cmpCard(c.year, 'year', pwOf('year'), yearTail)}${cmpCard(c.month, 'month', pwOf('month'))}${cmpCard(c.week, 'week', pwOf('week'))}</div>
			<p class="sec-note wk-cmp-note">Figures run to ${fDate(c.asOf)}${c.partial ? ' (week still in progress)' : ''}. ${c.hasLy ? `Last year is the same number of elapsed days, ${fInt(c.lyShiftDays)} days back &mdash; whole weeks, so weekdays line up. ` : ''}${esc(basisNote)}.</p>` : '';

		// A section's own always-visible summary strip. rows = [[label, value, note]]
		const secTile = (cells) => `<div class="sec-tiles">${cells.filter(Boolean).map((x) =>
			`<div class="sec-tile${x[3] ? ` ${x[3]}` : ''}"${x[4] ? ` data-roll="${x[4]}"` : ''}${x[5] ? ` data-sel="${x[5]}"` : ''}><span>${esc(x[0])}</span><strong>${x[1]}</strong>${x[2] ? `<small>${x[2]}</small>` : ''}</div>`).join('')}</div>`;

		// Each detail section is its own slide: summary tiles always on, the table behind a disclosure.
		const sec = (id, title, count, note, tiles, body, open) => `
		<section class="wk-sec" data-sec="${id}" data-title="${esc(title)}">
			<div class="card fold-card">
				<div class="head"><div><h3>${title}<em>${count}</em></h3>${note ? `<p class="sec-note">${note}</p>` : ''}</div></div>
				${tiles || ''}
				<details class="sec-more"${open ? ' open' : ''}><summary>Detail</summary>${body}</details>
			</div>
		</section>`;

		const sentRoll = w.sentYoY && w.sentYoY.ty ? w.sentYoY.ty : null;
		const execRoll = w.execYoY && w.execYoY.ty ? w.execYoY.ty : null;
		const inacBeds = (w.inactivated || []).reduce((t, r) => t + (Number(r.beds) || 0), 0);
		// Newest first: the lease sent yesterday is the one with momentum. Sorted here rather than in the
		// engine so no other caller's ordering changes.
		const inProcessRows = (w.inProcess || []).slice().sort((a, b) =>
			(a.days === null ? 1e9 : a.days) - (b.days === null ? 1e9 : b.days));

		// Sections are built once and composed twice: in reading order for the tab, and grouped
		// differently for the deck. Nothing is rendered twice, which is what produced the repeats.
		const secSent = sec('sent', 'Leases Sent This Week', `${fInt((w.sentThisWeek || []).length)} leases`,
			`Lease Sent Date ${fDate(w.week)} – ${fDate(w.weekEnd)}. Rent / Bed is this lease's monthly rent over its beds; ${ly ? `${esc(ly)} Rent / Bed is the same unit or bedroom a year earlier (* = only part of the lease matched).` : 'there is no prior academic year to compare against.'}`,
			secTile([
				['Leases sent', fInt((w.sentThisWeek || []).length), ly && w.sentYoY && w.sentYoY.ly ? `${esc(ly)} ${fInt(w.sentYoY.ly.leases)}` : '', '', 'count'],
				['Beds', fInt(sentRoll ? sentRoll.beds : 0), ly && w.sentYoY ? dlt(w.sentYoY.dBeds, fSigned) : '', '', 'beds'],
				['Rent / bed', fMoney2(sentRoll ? sentRoll.rentBed : null), ly && w.sentYoY && isNum(w.sentYoY.dRentBed) ? dlt(w.sentYoY.dRentBed, dMoney0) : '', '', 'rentbed'],
				['Revenue', fMoneyK(sentRoll ? sentRoll.trev : 0), 'full term', '', 'trev'],
				['Prior week', fInt(prev.newLeases), dlt(diff(sel.newLeases, prev.newLeases), fSigned)]
			]),
			yoyStrip(w.sentYoY, 'Sent') + leaseTable(w.sentThisWeek || [], sentCols, 'No leases sent this week'));

		const secExec = sec('executed', 'Fully Executed This Week', `${fInt(w.executed.length)} leases`,
			`Lease Status = Fully Executed, signed ${fDate(w.week)} – ${fDate(w.weekEnd)}.`,
			secTile([
				['Executed', fInt(w.executed.length), ly && w.execYoY && w.execYoY.ly ? `${esc(ly)} ${fInt(w.execYoY.ly.leases)}` : '', '', 'count'],
				['Beds', fInt(execRoll ? execRoll.beds : 0), ly && w.execYoY ? dlt(w.execYoY.dBeds, fSigned) : '', '', 'beds'],
				['Rent / bed', fMoney2(execRoll ? execRoll.rentBed : null), ly && w.execYoY && isNum(w.execYoY.dRentBed) ? dlt(w.execYoY.dRentBed, dMoney0) : '', '', 'rentbed'],
				['Revenue', fMoneyK(execRoll ? execRoll.trev : 0), 'full term', '', 'trev']
			]),
			yoyStrip(w.execYoY, 'Executed') + leaseTable(w.executed, execCols, 'No leases fully executed this week'));

		const secInProc = sec('inprocess', 'Leases In Process', `${fInt(pl.now)} at week end${pl.noSent ? ` + ${fInt(pl.noSent)} with no sent date` : ''}`,
			`Lease Sent Date on or before ${fDate(w.weekEnd)} and not signed by then, newest first. Days = ${w.isCurrent ? 'today' : 'week end'} less Lease Sent Date.`,
			secTile([
				['In process', fInt(pl.now), `${fInt(pl.over21)} over 21 days`, pl.over21 ? 'warn' : '', 'count'],
				['Prior week', fInt(pl.prev), dlt(diff(pl.now, pl.prev), fSigned)],
				ly ? [`${ly}`, isNum(pl.ly) ? fInt(pl.ly) : 'n/a', isNum(pl.ly) ? dlt(diff(pl.now, pl.ly), fSigned) : 'no sent dates'] : null,
				pl.noSent ? ['No sent date', fInt(pl.noSent), 'not dated into any week', 'warn'] : null
			]),
			yoyStrip(w.inProcessYoY, 'In process') + leaseTable(inProcessRows, inProcessCols, 'No leases in process'));

		const secInact = sec('inactivated', 'Lease Records Made Inactive This Week', fInt(w.inactivated.length),
			`From system notes (Inactive set to Yes) ${fDate(w.week)} – ${fDate(w.weekEnd)}, all academic years.`,
			secTile([
				['Made inactive', fInt(w.inactivated.length), 'this week', w.inactivated.length ? 'warn' : '', 'count'],
				['Beds affected', fInt(inacBeds), 'across all academic years', '', 'beds'],
				['Still inactive', fInt((w.inactivated || []).filter((r) => r.stillInactive).length), 'not reactivated']
			]),
			leaseTable(w.inactivated, inactCols, 'No lease records were made inactive this week'));

		const secPace = `
		<section class="wk-sec" data-sec="pace" data-title="Leasing Pace">
			<div class="card">
				<div class="head"><div><h3>Leasing Pace<em>cumulative occupancy by week</em></h3>
					<p class="sec-note">Occupancy at each week end${ly ? `; ${esc(ly)} shifted onto this year’s calendar (same week of the leasing cycle)` : ''}. ${esc(basisNote)}.</p></div></div>
				${secTile([
					['Pre-leased', fPct(sel.occPct), `${fInt(sel.occ)} of ${fInt(w.totalBeds)} beds`],
					['vs prior week', dlt(sel.dOccPct, fPts), `${fInt(sel.newBeds)} beds this week`],
					ly ? [`vs ${ly}`, dlt(sel.vsLyPct, fPts), `${esc(ly)} ${fPct(sel.lyOccPct)}`] : null,
					['Beds to go', fInt(w.totalBeds - sel.occ), 'unleased at week end']
				])}
				<div class="chart" data-vel>${''}</div>
			</div>
		</section>`;

		const secHist = sec('history', 'Week-over-Week History', `${fInt(rows.length)} weeks`,
			`Cumulative figures at each week end, restated from today’s active leases.${ly ? ` ${esc(ly)} columns = the same week of the prior AY.` : ''}`,
			secTile([
				['This week', fPct(sel.occPct), `${fDate(w.week)} – ${fDate(w.weekEnd)}`],
				['Prior week', fPct(prev.occPct), dlt(sel.dOccPct, fPts)],
				['Weeks tracked', fInt(rows.length), 'restated from live leases']
			]), `
			${rows.length > 8 ? `<div class="toolbar"><span class="seg" data-hist-n><button type="button" data-n="8" class="on">Last 8</button>${rows.length > 26 ? '<button type="button" data-n="26">26</button>' : ''}<button type="button" data-n="0">All</button></span></div>` : ''}
			<div class="wrap"><table class="dense" data-hist>
				<thead><tr><th class="l">Week</th><th>Leases</th><th>Beds Leased</th><th>Occupied Beds</th><th>Occ. %</th><th>WoW</th><th>Total Revenue</th>${ly ? `<th>LY Beds Leased</th><th>LY Occ. %</th><th>vs LY</th>` : ''}</tr></thead>
				<tbody>${rows.map(histRow).join('')}</tbody>
			</table></div>`);

		// The deck asks for these three blocks plus a one-line summary for its opening slide.
		if (ctx.slidesOnly) {
			return {
				ayName: ctx.ayName,
				pre: {
					beds: w.totalBeds, occ: sel.occ, occPct: sel.occPct,
					lyOcc: sel.lyOcc, lyOccPct: sel.lyOccPct, vsLyPct: sel.vsLyPct, dOccPct: sel.dOccPct,
					newBeds: sel.newBeds, newLeases: sel.newLeases, leases: sel.leases, lyLeases: sel.lyLeases,
					trev: sel.trev, lyTrev: sel.lyTrev, mrev: sel.mrev, lyMrev: sel.lyMrev,
					inProcess: pl.now, over21: pl.over21,
					sent: (w.sentThisWeek || []).length, executed: w.executed.length,
					inactivated: (w.inactivated || []).length
				},
				chart: Object.assign({ cur: ayShort(ctx.ayName), ly: ly || null }, w.chart),
				group: secExec + secSent + secInProc + secInact,
				pace: secPace,
				history: secHist
			};
		}

		return `
		<div class="wk" id="lkr-wk">
		<div class="card wk-head">
			<div>
				<h3>Weekly Leasing Report &middot; ${esc(ayShort(ctx.ayName))}${ctx.scopeShort ? ` &middot; ${esc(ctx.scopeShort)}` : ''}</h3>
				<p class="sec-note wk-sub">Week of ${fDate(w.week)} – ${fDate(w.weekEnd)}${w.isCurrent ? ' (this week, to date)' : ''} &middot; ${esc(basisNote)}${ly ? ` &middot; LY = same week of ${esc(ly)} (${fDate(w.lyWeek)} – ${fDate(w.lyWeekEnd)})` : ''}</p>
			</div>
			<div class="row wk-nav">
				<button type="button" class="btn sm" data-week-step="-1" title="Previous week">&larr;</button>
				<select id="lkr-week" data-param="week" aria-label="Week">${w.weekOptions.map((o, i) => option(o.value, `${o.label}${i === 0 ? ' (this week)' : ''}`, o.value === w.week)).join('')}</select>
				<button type="button" class="btn sm" data-week-step="1" title="Next week"${w.isCurrent ? ' disabled' : ''}>&rarr;</button>
				<button type="button" class="btn sm present-btn" id="lkr-present">&#9974; Present</button>
			</div>
		</div>

		<section class="wk-sec" data-sec="overview" data-title="High level">
			${cmpPanels}
			<div class="kpis six wk-tiles">
				${tile('Occupancy', fPct(sel.occPct), ly ? paceTone(sel.vsLyPct) : tone(sel.occPct), [pw(fPct(prev.occPct), dlt(sel.dOccPct, fPts)), lw(fPct(sel.lyOccPct), dlt(sel.vsLyPct, fPts))], `of ${fInt(w.totalBeds)} beds at week end`)}
				${tile('Occupied Beds', fInt(sel.occ), '', [pw(fInt(prev.occ), dlt(sel.dOcc, fSigned)), lw(fInt(sel.lyOcc), dlt(diff(sel.occ, sel.lyOcc), fSigned))])}
				${tile('Beds Leased This Week', fInt(sel.newBeds), '', [pw(fInt(prev.newBeds), dlt(diff(sel.newBeds, prev.newBeds), fSigned)), lw(fInt(sel.lyNewBeds), dlt(diff(sel.newBeds, sel.lyNewBeds), fSigned))])}
				${tile(`Leases ${signedWord} This Week`, fInt(sel.newLeases), '', [pw(fInt(prev.newLeases), dlt(diff(sel.newLeases, prev.newLeases), fSigned)), lw(fInt(sel.lyNewLeases), dlt(diff(sel.newLeases, sel.lyNewLeases), fSigned))])}
				${tile('Total Revenue Leased', fMoney(sel.trev), '', [pw(fMoneyK(prev.trev), dlt(sel.dTrev, fMoneySigned)), lw(fMoneyK(sel.lyTrev), dlt(isNum(sel.lyTrev) && sel.lyTrev > 0 ? sel.trev / sel.lyTrev - 1 : null, fGrowth))], 'Rent actual, full term')}
				${tile('Leases In Process', fInt(pl.now), pl.over21 ? 'warn' : '', [pw(fInt(pl.prev), dlt(diff(pl.now, pl.prev), fSigned)), lw(isNum(pl.ly) ? fInt(pl.ly) : 'n/a', isNum(pl.ly) ? dlt(diff(pl.now, pl.ly), fSigned) : '')], `${fInt(pl.over21)} over 21 days${pl.noSent ? ` &middot; ${fInt(pl.noSent)} without a sent date` : ''}`)}
			</div>
			${undated}
			<div class="card">
				<div class="head"><div><h3>By ${groupLabel}<em>week ending ${fDate(w.weekEnd)}</em></h3>
					<p class="sec-note">Occupancy at week end; WoW = change vs the prior week end; ${ly ? `LY = the same week of ${esc(ly)}; ` : ''}Beds Leased = leases dated this week.</p></div></div>
				<div class="wrap"><table class="dense wk-grp" id="lkr-wk-grp">
					<thead><tr><th class="l">${groupLabel}</th><th>Total Beds</th><th>Occ. %</th><th>WoW</th>${ly ? `<th>${esc(ly)}</th><th>vs LY</th>` : ''}<th>Beds Leased</th>${ly ? `<th>LY Beds Leased</th>` : ''}<th>In Process</th><th>Total Revenue</th>${ly ? '<th>Rev. vs LY</th>' : ''}</tr></thead>
					<tbody>${g.map((r) => gRow(r)).join('')}</tbody>
					${g.length > 1 ? `<tfoot>${gRow(totalRow, true)}</tfoot>` : ''}
				</table></div>
			</div>
		</section>

		${secSent}
		${secExec}
		${secInProc}
		${secPace}
		${secHist}
		${secInact}

		<div class="deck" id="lkr-deck"></div>
		<div class="slide-bar" id="lkr-slide-bar">
			<b data-slide-title></b><span class="mk" data-slide-mk></span>
			<div class="spacer"></div>
			<span data-slide-pos></span>
			<button type="button" class="btn sm" data-slide="prev">&larr;</button>
			<button type="button" class="btn sm" data-slide="next">&rarr;</button>
			<button type="button" class="btn sm" data-slide="exit">Exit</button>
		</div>
		</div>`;
	};

	const KIND_LABEL = { lease: 'Lease', tenant: 'Tenant', unit: 'Unit/Bedroom', property: 'Property', details: 'Academic Year Details' };

	const fixSection = (kind, title, note, rows, opts = {}) => {
		const groups = {};
		rows.forEach((r) => {
			const g = groups[r.issue] || (groups[r.issue] = { issue: r.issue, count: 0, mrev: 0, excl: !!r.excluded, sev: 0 });
			g.count++;
			g.sev = Math.max(g.sev, r.sev || 0);
			g.mrev += r.excluded ? (r.mrev || 0) : 0;
		});
		// Severity first, so a double-booked tenant never sits below a missing email address.
		const list = Object.values(groups).sort((a, b) => (b.sev - a.sev) || (b.excl - a.excl) || (b.count - a.count));
		const showRent = list.some((g) => g.excl);
		const body = rows.length ? `
			<div class="fix-sum" data-fix-sum="${kind}">${list.map((g) => `<button type="button" class="fix-chip${g.sev > 1 ? ' sev' : ''}" data-value="${esc(g.issue)}"><b>${fInt(g.count)}</b> ${esc(g.issue)}${g.excl && g.mrev ? ` <span class="muted">· ${fMoney(g.mrev)}/mo not counted</span>` : ''}</button>`).join('')}</div>
			<div class="toolbar"><span class="sec-note">Click an issue to filter the list.</span>
				<div class="row"><input type="search" data-fix-search="${kind}" placeholder="Search record or property…" aria-label="Search ${esc(title)}">
				<button type="button" class="btn sm" data-fix-export="${kind}">Export CSV</button></div></div>
			<div class="wrap scroll"><table class="dense fix" id="lkr-fix-${kind}" data-rent="${showRent ? 1 : 0}" data-kind-col="${opts.showKind ? 1 : 0}">
				<thead><tr><th class="l">${opts.recordLabel || 'Record'}</th><th class="l">Issue</th><th class="l">Action to fix</th><th class="l">Related records</th><th class="l">Property</th><th class="l">Units/Bedroom</th>${showRent ? '<th>Monthly Rent</th>' : ''}</tr></thead>
				<tbody data-fix-rows="${kind}"></tbody>
			</table></div>` : `<div class="empty"><strong>Nothing to fix</strong>No ${esc(title.toLowerCase())} issues for this selection.</div>`;
		const head = `<div class="head"><div><h3>${title}<em>${fInt(rows.length)} to fix</em></h3><p class="sec-note">${note}</p></div></div>`;
		return opts.collapsed
			? `<details class="card fixcard"><summary class="head"><div><h3>${title}<em>${fInt(rows.length)} to fix</em></h3><p class="sec-note">${note}</p></div></summary>${body}</details>`
			: `<div class="card fixcard">${head}${body}</div>`;
	};

	const DUP_TENANT = 'Tenant is on more than one active lease in this AY';

	// Double-booked tenants get their own card: the same person counted on two leases inflates both
	// headcount and leased beds, and it usually means one of the two leases should not be there.
	const dupTenantCard = (rows, ctx) => {
		const dup = (rows || []).filter((r) => r.issue === DUP_TENANT);
		if (!dup.length) return '';
		const place = (r) => ((r.places || []).length ? r.places.join('<br>') : esc(r.property || '–'));
		const body = `
			<div class="wrap scroll"><table class="dense">
				<thead><tr><th class="l">Tenant</th><th>Leases</th><th class="l">Where</th><th class="l">Market</th><th>Duplicate Rent /mo</th><th class="l">Lease Records</th></tr></thead>
				<tbody>${dup.map((r) => `<tr><td class="l">${r.link ? `<a class="lnk" href="${esc(r.link)}" target="_blank">${esc(r.name)}</a>` : esc(r.name)}</td>` +
					`<td><strong>${fInt(r.dupLeases || (r.related || []).length)}</strong></td>` +
					`<td class="l wrapcell">${place(r)}</td>` +
					`<td class="l">${esc((r.markets || []).join(' + ') || r.market || '–')}</td><td>${r.mrev === null || r.mrev === undefined ? '–' : fMoney2(r.mrev)}</td>` +
					`<td class="l">${(r.related || []).map((y) => esc(y.name)).join('<br>')}</td></tr>`).join('')}</tbody>
			</table></div>`;
		return `<div class="card fixcard alert">
			<div class="head"><div><h3><span class="alert-dot">&#9888;</span>Tenants on More Than One Lease<em>${fInt(dup.length)} tenant${dup.length === 1 ? '' : 's'}</em></h3>
				<p class="sec-note">One person on two active ${esc(ayShort(ctx.ayName))} leases: both leases count their beds, their rent and their headcount. Clear these first &mdash; they move the numbers, not just the data quality. Duplicate Rent is the monthly rent on the surplus lease(s).</p></div></div>
			${body}</div>`;
	};

	// The blocking-exclusions card. Everything else on this tab is advisory; these are the rows actually taking
	// beds and revenue out of the report.
	const blockingCard = (ctx) => {
		const list = ctx.blocking || [];
		const t = ctx.blockingTotal || { leases: 0, beds: 0, people: 0, mrev: 0, trev: 0 };
		if (!list.length) {
			return `<div class="card"><div class="head"><div><h3>Nothing is being excluded</h3>
				<p class="sec-note">Every active lease in ${esc(ctx.ayName)} on the ${esc(ctx.basisLabel)} basis is counted. The sections below are advisory only.</p></div></div></div>`;
		}
		return `<div class="card">
			<div class="head"><div><h3>Excluded from the leasing numbers<em>${fInt(t.leases)} lease${t.leases === 1 ? '' : 's'} &middot; ${fInt(t.beds)} beds &middot; ${fMoney(t.trev)}</em></h3>
				<p class="sec-note">The only rows on this tab that change the numbers. Until each is fixed its beds sit as vacant and its rent is missing from every figure. Ranked by what they cost. Open a reason for the leases behind it &mdash; each name opens the record.</p></div></div>
			<div class="wrap"><table class="dense">
				<thead><tr><th class="l">Reason</th><th>Leases</th><th>Beds</th><th>People</th><th>Monthly Rent</th><th>Total Revenue</th></tr></thead>
				<tbody>${list.map((r) => `<tr><td class="l"><strong>${esc(r.label)}</strong></td><td>${fInt(r.leases)}</td><td>${fInt(r.beds)}</td><td>${fInt(r.people)}</td><td>${fMoney2(r.mrev)}</td><td>${fMoney(r.trev)}</td></tr>`).join('')}</tbody>
				<tfoot><tr><td class="l">Total</td><td>${fInt(t.leases)}</td><td>${fInt(t.beds)}</td><td>${fInt(t.people)}</td><td>${fMoney2(t.mrev)}</td><td>${fMoney(t.trev)}</td></tr></tfoot>
			</table></div>
			${list.map((r) => `<details class="fold">
				<summary class="head"><div><h3>${esc(r.label)}<em>${fInt(r.leases)} lease${r.leases === 1 ? '' : 's'} &middot; ${fInt(r.beds)} beds &middot; ${fMoney(r.trev)}</em></h3>
					<p class="sec-note">${esc(r.meaning)}${r.fix ? ` <strong>Fix:</strong> ${esc(r.fix)}` : ''}</p></div></summary>
				<div class="wrap"><table class="dense">
					<thead><tr><th class="l">Lease</th><th class="l">Market</th><th class="l">Property</th><th class="l">Units/Bedroom</th><th class="l">Type</th><th>Beds</th><th>People</th><th>Monthly Rent</th><th>Total Revenue</th></tr></thead>
					<tbody>${r.rows.map((e) => `<tr><td class="l">${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.name)}</a>` : esc(e.name)}</td><td class="l">${esc(e.market || '\u2013')}</td><td class="l">${esc(e.property || '\u2013')}</td><td class="l">${esc(e.linked || '\u2013')}</td><td class="l">${esc(e.type)}</td><td>${fInt(e.beds)}</td><td>${fInt(e.people)}</td><td>${fMoney2(e.mrev)}</td><td>${fMoney(e.trev)}</td></tr>`).join('')}</tbody>
				</table></div>
			</details>`).join('')}
		</div>`;
	};

	const renderExceptions = (fx, ctx) => `
		${blockingCard(ctx)}
		${dupTenantCard(fx.tenant, ctx)}
		${fixSection('lease', 'Lease Records', `Excluded leases are left out of every number until fixed; date and status gaps affect the weekly report. ${esc(ctx.basisLabel)} basis, ${esc(ctx.ayName)}.`, fx.lease)}
		${fixSection('tenant', 'Tenant Records', 'Tenants linked to this academic year\'s active leases (lease Tenants field). People counts use Number of Tenants, so mismatches change headcount.', fx.tenant, { showKind: true, recordLabel: 'Record' })}
		${fixSection('records', 'Property &amp; Unit Records', 'Inventory gaps the report works around; they do not exclude leases.', fx.records, { showKind: true, collapsed: true })}`;


	// ---- Pipeline ----
	// The shell only. Rows, the stat band and the distribution bar are drawn client-side from the single
	// copy in clientData, the same way Exceptions does it: 1,400 live inputs rendered server-side would
	// not perform, and filtering then costs nothing.
	const renderPipeline = (pl, ctx) => {
		if (pl.error) {
			return `<div class="card empty"><strong>The leasing pipeline could not be loaded</strong>${esc(pl.error)}</div>`;
		}
		const stageFilterOpts = ['<option value="">All stages</option>'].concat(STAGE_ORDER.map((s) =>
			`<option value="${s === '' ? '_blank' : s}">${esc(s === '' ? NO_STAGE_LABEL : STAGE_LABEL[s])}</option>`)).join('');
		const bulkOpts = ['<option value="">Set stage on selected&hellip;</option>']
			.concat(STAGE_EDITABLE.map((s) => `<option value="${s}">${esc(STAGE_LABEL[s])}</option>`))
			.concat([`<option value="_blank">${esc(NO_STAGE_LABEL)}</option>`]).join('');
		const marketOpts = ['<option value="">All markets</option>'].concat(
			ctx.marketOptions.map((m) => `<option value="${esc(m.key)}">${esc(m.label)}</option>`)).join('');
		const legend = STAGE_ORDER.map((s) =>
			`<span><b class="${STAGE_CLASS[s]}"></b>${esc(s === '' ? NO_STAGE_LABEL : STAGE_LABEL[s])}</span>`).join('');
		const tieNote = pl.ties.beds ? '' :
			`<p class="warn-note">&#9888; Pipeline beds (${fInt(pl.beds)}) do not match Summary total beds (${fInt(pl.summaryBeds)}). The grid and the KPIs are out of step - do not work from this tab until it is fixed.</p>`;
		const gapNote = pl.missingStatus
			? `<p class="sec-note">${fInt(pl.missingStatus)} unit${pl.missingStatus === 1 ? ' has' : 's have'} no status record for this academic year. Saving one creates it and logs a provisioning gap.</p>` : '';
		const noteGap = pl.notesOn ? '' :
			`<p class="warn-note">&#9888; Notes are unavailable - the Unit Leasing Note record could not be read. Everything else on this tab still works.</p>`;
		return `
		${tieNote}
		${noteGap}
		<div class="card pl-band" id="lkr-pl-band"></div>
		<div class="card">
			<div class="head"><div><h3>Leasing Pipeline<em id="lkr-pl-count"></em></h3>
				<p class="sec-note">One row per leasable unit for ${esc(ctx.ayName)}. Stage comes from the lease where a lease drives it (Lease Out - Unsigned and Fully Executed are read-only here); every other stage is yours to set. ${esc(ctx.scopeLabel)}.</p>
				<p class="sec-note">Beds tie to Summary exactly, but the stage counts do not: a stage follows the one lease its unit's status record points at, while Summary counts every counted lease. Leases with no unit link (Exceptions &rsaquo; Not linked to a unit/bedroom record) drive no stage, so Executed here reads lower than pre-leased on Summary. Use Summary for pre-leasing, this tab for what to work next.</p>
				${gapNote}</div></div>
			<div class="pl-bar" id="lkr-pl-bar"></div>
			<div class="pl-legend">${legend}</div>
			<div class="pl-tools">
				<div class="fld"><label for="lkr-pl-market">Market</label><select id="lkr-pl-market">${marketOpts}</select></div>
				<div class="fld"><label for="lkr-pl-stage">Stage</label><select id="lkr-pl-stage">${stageFilterOpts}</select></div>
				<div class="fld"><label for="lkr-pl-q">Property, unit or tenant</label><input type="search" id="lkr-pl-q" placeholder="Search&hellip;"></div>
				<label class="pl-tog" id="lkr-pl-action-l"><input type="checkbox" id="lkr-pl-action"> Needs action</label>
				<label class="pl-tog" id="lkr-pl-free-l"><input type="checkbox" id="lkr-pl-free"> Beds available</label>
				${pl.notesOn ? '<label class="pl-tog" id="lkr-pl-me-l"><input type="checkbox" id="lkr-pl-me"> Mentions me</label>' : ''}
				<button type="button" class="btn sm" id="lkr-pl-expand">Expand all</button>
				<div class="spacer"></div>
				<div class="fld"><label for="lkr-pl-bulk">Bulk</label><select id="lkr-pl-bulk">${bulkOpts}</select></div>
				<button type="button" class="btn sm" id="lkr-pl-export">Export CSV</button>
			</div>
			<div class="wrap scroll"><table class="dense pl" id="lkr-pl-table">
				<thead><tr>
					<th class="chev"></th>
					<th class="sel"><input type="checkbox" id="lkr-pl-all" title="Select all shown"></th>
					<th class="l">Property / Unit</th><th>Beds</th>
					<th class="l">Leasing stage</th><th>Days in stage</th>
					<th>Target rent</th><th>Offered /bed</th><th>Signed</th>
					<th class="l">Expected tenants</th><th class="l">Follow&#8209;up</th><th class="l">Notes</th>
				</tr>${notesRow(['', '', 'Units/Bedrooms record, its property and market',
					'Beds from the inventory leaves — ties to Summary',
					'Where the unit sits in the funnel. Lease Out and Fully Executed are set by the lease and are read-only here.',
					'Days since whatever set the current stage: the lease’s signed or sent date where a lease drives it, otherwise the day leasing last changed it. Blank stages have nothing to measure.',
					'Monthly target over target per bed, from Academic Year Details for this AY',
					'Last rent quoted, per bed — not per person',
					'Monthly rent on the lease. ▲ marks a lease signed below the settle floor.',
					'Names the agent expects to sign, so ops can watch for their applications',
					'The date to chase this unit. On or before today counts as needing action.',
					'Date-stamped notes, most recent shown. Open the thread to add one or tag someone.'])}</thead>
				<tbody data-pl-rows></tbody>
			</table></div>
			<div class="pl-foot" id="lkr-pl-foot"></div>
		</div>
		<div class="pl-save" id="lkr-pl-save" hidden>
			<strong id="lkr-pl-dirty">0 rows edited</strong>
			<span class="msg" id="lkr-pl-msg"></span>
			<div class="spacer"></div>
			<label class="auto"><input type="checkbox" id="lkr-pl-auto" checked> Autosave</label>
			<button type="button" class="btn sm" id="lkr-pl-revert">Revert</button>
			<button type="button" class="btn sm primary" id="lkr-pl-savebtn">Save now</button>
		</div>
		<div id="lkr-pl-over"></div>
		<div id="lkr-pl-lease"></div>`;
	};

	const CLIENT_SCRIPT = String.raw`
	<script>
	(function () {
		/* freeze:start — header cells below the first row need their own sticky offset; rerun whenever the report redraws or resizes. */
		var freezeTimer = null;
		function freezeHeads() {
			freezeTimer = null;
			var heads = document.querySelectorAll('#lkr .wrap thead');
			for (var h = 0; h < heads.length; h++) {
				var rows = heads[h].rows, y = 0;
				for (var i = 0; i < rows.length; i++) {
					var cells = rows[i].cells;
					for (var j = 0; j < cells.length; j++) cells[j].style.top = y + 'px';
					y += rows[i].getBoundingClientRect().height;
				}
			}
		}
		function queueFreeze() { if (freezeTimer === null) freezeTimer = window.requestAnimationFrame(freezeHeads); }
		queueFreeze();
		window.addEventListener('resize', queueFreeze);
		if (window.MutationObserver) new MutationObserver(queueFreeze).observe(document.getElementById('lkr'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-rt', 'class', 'hidden'] });
		/* freeze:end */
		var D = window.LKR_DATA || {};
		var root = document.getElementById('lkr');

		for (var el = root && root.parentElement; el && el !== document.body; el = el.parentElement) {
			if (/^(TABLE|TD|DIV)$/.test(el.tagName)) {
				el.style.width = '100%';
				el.style.maxWidth = 'none';
				if (el.tagName === 'TABLE') el.removeAttribute('width');
			}
		}

		function $(id) { return document.getElementById(id); }
		function esc(s) {
			return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
				return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
			});
		}
		function fInt(n) { return Math.round(n || 0).toLocaleString('en-US'); }
		function fMoney(n) { return n == null ? '–' : '$' + Math.round(n).toLocaleString('en-US'); }
		function fMoney2(n) { return n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
		function ratio(a, b) { return b > 0 ? a / b : null; }
		function fPct(r) { return r == null ? '–' : (Math.round(r * 1000) / 10).toFixed(1) + '%'; }
		function tone(r) { return r >= 0.95 ? 'ok' : (r >= 0.8 ? 'warn' : 'bad'); }
		function fDate(s) { if (!s) return '–'; var p = s.split('-'); return p[1] + '/' + p[2] + '/' + p[0]; }
		function sgn(v) { return v > 1e-9 ? '+' : (v < -1e-9 ? '−' : ''); }
		function r1(v) { return Math.round(v * 1000) / 10; }
		function fPts(d) { return d == null || isNaN(d) ? '–' : sgn(r1(d)) + Math.abs(r1(d)).toFixed(1) + ' pts'; }
		function fGrowth(g) { return g == null || isNaN(g) ? '–' : sgn(r1(g)) + Math.abs(r1(g)).toFixed(1) + '%'; }
		function dlt(v, fmt) { var c = v == null || isNaN(v) || Math.abs(v) < 0.0005 ? '' : (v > 0 ? 'up' : 'down'); return '<span class="dlt ' + c + '">' + fmt(v) + '</span>'; }
		function growth(cur, prev) { return prev > 0 ? cur / prev - 1 : null; }

		var TABS = ['summary', 'details', 'weekly', 'exceptions', 'pipeline'];
		var RTS = ['occrev', 'yoy', 'vacancy', 'rent', 'tgt', 'lease', 'all'];
		function parseHash() {
			var h = (window.location.hash || '').replace('#', '').split('/');
			var tab = h[0], rt = h[1] || '';
			if (tab === 'report') tab = 'details';
			if (tab === 'vacancy') { tab = 'details'; rt = 'vacancy'; }
			return { tab: TABS.indexOf(tab) > -1 ? tab : 'summary', rt: RTS.indexOf(rt) > -1 ? rt : '' };
		}
		var state = parseHash();
		function currentTab() { return state.tab; }
		function hashNow() { return '#' + state.tab + (state.tab === 'details' && state.rt && state.rt !== 'occrev' ? '/' + state.rt : ''); }

		window.LKR_PARAMS = function () {
			var o = {};
			var els = root.querySelectorAll('[data-param]');
			for (var i = 0; i < els.length; i++) o[els[i].getAttribute('data-param')] = els[i].value;
			// The week only applies to the Weekly Report; other tabs always open on the current week.
			if (currentTab() !== 'weekly') delete o.week;
			if (o.ay !== D.ay) delete o.week;
			return o;
		};
		$('lkr-run').onclick = function () {
			// Re-running reloads the page, so warn before throwing away unsaved pipeline edits.
			if (!plConfirmLeave()) return;
			var p = window.LKR_PARAMS();
			if (!p.ay) { $('lkr-error').textContent = 'Select an academic year to run the report.'; return; }
			var q = '';
			for (var k in p) if (p[k]) q += '&' + k + '=' + encodeURIComponent(p[k]);
			this.disabled = true;
			this.textContent = 'Running…';
			window.location.href = D.baseUrl + q + hashNow();
		};
		$('lkr-reset').onclick = function () { window.location.href = D.baseUrl; };
		// Criteria changed but not run yet: highlight Run.
		var crit = root.querySelectorAll('.hdr [data-param]');
		for (var ci = 0; ci < crit.length; ci++) crit[ci].addEventListener('change', function () { $('lkr-run').classList.add('dirty'); $('lkr-run').textContent = 'Run ▸'; });

		var desc = $('lkr-desc');
		if (desc) {
			var showDesc = false;
			try { showDesc = window.localStorage.getItem('lkr.descriptions') === '1'; } catch (err) { showDesc = false; }
			desc.checked = showDesc;
			root.classList.toggle('hide-desc', !showDesc);
			desc.onchange = function () {
				root.classList.toggle('hide-desc', !this.checked);
				try { window.localStorage.setItem('lkr.descriptions', this.checked ? '1' : '0'); } catch (err) { /* storage unavailable */ }
			};
		}

		if (!D.tree) return;

		var inited = {};
		var tabButtons = root.querySelectorAll('.tabs button');
		function showTab(name) {
			// Unsaved stage edits live only in the browser; changing tab would silently drop them.
			if (state.tab === 'pipeline' && name !== 'pipeline' && !plConfirmLeave()) return;
			for (var i = 0; i < tabButtons.length; i++) {
				var on = tabButtons[i].getAttribute('data-tab') === name;
				tabButtons[i].classList.toggle('active', on);
				tabButtons[i].setAttribute('aria-selected', on ? 'true' : 'false');
			}
			var panels = root.querySelectorAll('.tab-panel');
			for (var j = 0; j < panels.length; j++) panels[j].classList.toggle('active', panels[j].id === 'tab-' + name);
			state.tab = name;
			if (window.history && history.replaceState) history.replaceState(null, '', hashNow());
			if (!inited[name]) {
				inited[name] = true;
				if (name === 'details' && tree) tree.init();
				if (name === 'weekly') drawVelocity();
				if (name === 'exceptions') ['lease', 'tenant', 'records'].forEach(fixRows);
				if (name === 'pipeline') plInit();
			}
		}
		for (var t = 0; t < tabButtons.length; t++) {
			tabButtons[t].onclick = function () { showTab(this.getAttribute('data-tab')); };
		}
		root.addEventListener('click', function (e) {
			var go = e.target.closest('[data-goto]');
			if (go) { e.preventDefault(); showTab(go.getAttribute('data-goto')); window.scrollTo(0, root.getBoundingClientRect().top + window.pageYOffset - 10); }
		});


		// ---- Summary: collapsible fund / market tables ----
		function setGroup(tbl, tr, open) {
			tr.classList.toggle('open', open);
			var kids = tbl.querySelectorAll('tr[data-parent="' + tr.getAttribute('data-grp') + '"]');
			for (var i = 0; i < kids.length; i++) kids[i].hidden = !open;
		}
		root.addEventListener('click', function (e) {
			var all = e.target.closest('[data-expand],[data-collapse]');
			if (all) {
				var id = all.getAttribute('data-expand') || all.getAttribute('data-collapse');
				var tbl = $(id), open = all.hasAttribute('data-expand');
				var grps = tbl.querySelectorAll('tr.grp');
				for (var i = 0; i < grps.length; i++) setGroup(tbl, grps[i], open);
				return;
			}
			var tr = e.target.closest('table.grouped tr.grp');
			if (!tr || e.target.closest('[data-goto]')) return;
			if (e.target.closest('td') !== tr.firstElementChild) return;
			setGroup(tr.closest('table'), tr, !tr.classList.contains('open'));
		});

		// ---- Leasing Details: one tree; the report type picks column groups (and the vacancy filter) ----
		var LEVELS = ['Fund', 'Market', 'Property', 'Unit', 'Bedroom'];
		var TYPE_TAG = { 'Whole House': 't-wh', 'Unit': 't-unit', 'Bedroom': 't-bed', 'Mixed': 't-mixed' };
		var NUM_KEYS = ['o', 'f', 'wh', 'un', 'bd', 'p', 'l', 'x', 'mr', 'tr', 'po', 'pm', 'sb', 'sc', 'sp', 'tg', 'tb', 'to', 'mt', 'st', 'rx', 'rb'];
		function norm(n) {
			if (n._n) return n;
			for (var i = 0; i < NUM_KEYS.length; i++) n[NUM_KEYS[i]] = n[NUM_KEYS[i]] || 0;
			n.ty = n.ty || 'Vacant';
			if (n.mo === undefined) n.mo = null;
			n._n = true;
			return n;
		}
		function isLeaf(n) { return n.lv === 4 || (n.lv >= 2 && !n.c); }
		function occPill(n) {
			if (isLeaf(n)) return n.o ? '<span class="pill ok">Occupied</span>' : (n.b ? '<span class="pill vac">Vacant</span>' : '<span class="muted">–</span>');
			var r = ratio(n.o, n.b);
			return r == null ? '<span class="muted">–</span>' : '<span class="pill ' + tone(r) + '">' + fPct(r) + '</span>';
		}
		var WHY = { v: 'vacant ' + (D.ayShort || 'this AY'), p: 'vacant ' + (D.lyShort || 'prior AY'), x: 'excluded lease' };
		function fSignedInt(v) { return v == null || isNaN(v) ? '–' : sgn(v) + Math.abs(Math.round(v)).toLocaleString('en-US'); }
		function curPill(n) { return n.o ? '<span class="pill ok">Occupied</span>' : (n.b ? '<span class="pill vac">Vacant</span>' : '–'); }
		function lyPill(n) {
			if (!D.hasPrior) return '–';
			if (isLeaf(n)) return n.po ? '<span class="pill ok">Occupied</span>' : (n.b ? '<span class="pill vac">Vacant</span>' : '–');
			return fInt(n.po);
		}
		function td(g, v, start, cls) { return '<td class="' + (g ? 'g-' + g : '') + (start ? ' grp-start' : '') + (cls ? ' ' + cls : '') + '">' + v + '</td>'; }
		function cells(n) {
			norm(n);
			var fin = ratio(n.f, n.b), occ = ratio(n.o, n.b), pocc = D.hasPrior ? ratio(n.po, n.b) : null;
			var P = D.hasPrior, leaf = isLeaf(n);
			var h = td('', fInt(n.b), 1);
			h += td('occ', fInt(n.o), 1) + td('occ', fInt(n.b - n.o)) + td('occ', occPill(n)) + td('occ', fin == null ? '–' : fPct(fin));
			h += td('rev', fMoney2(n.mr), 1) + td('rev', fMoney2(n.tr));
			h += td('yoy', leaf ? curPill(n) : fInt(n.o), 1, 'cy') + td('yoy', leaf ? lyPill(n) : (P ? fInt(n.po) : '–'), 0, 'py') + td('yoy', P ? dlt(n.o - n.po, fSignedInt) : '–') +
				td('yoy', fPct(occ), 1, 'cy') + td('yoy', P ? fPct(pocc) : '–', 0, 'py') + td('yoy', P && occ != null ? dlt(occ - pocc, fPts) : '–') +
				td('yoy', fMoney2(n.mr), 1, 'cy') + td('yoy', P ? fMoney2(n.pm) : '–', 0, 'py') + td('yoy', P ? dlt(growth(n.mr, n.pm), fGrowth) : '–');
			h += td('rent', fMoney2(ratio(n.mr, n.o)), 1) + td('rent', fMoney2(ratio(n.mr, n.p))) +
				td('rent', P && n.sb ? fInt(n.sb) : (P && n.sw ? '<span class="why">' + esc(WHY[n.sw]) + '</span>' : '–'), 1) +
				td('rent', P && n.sb ? fMoney2(n.sc) : '–', 0, 'cy') + td('rent', P && n.sb ? fMoney2(n.sp) : '–', 0, 'py') + td('rent', P && n.sb ? dlt(growth(n.sc, n.sp), fGrowth) : '–');
			h += td('tgt', n.tb ? fMoney(n.tg) : '–', 1) + td('tgt', n.tb ? fMoney2(n.tg / n.tb) : '–') + td('tgt', n.to ? dlt(n.mt / n.to - 1, fGrowth) : '–') +
				td('tgt', n.tb ? fMoney(n.tg - n.to) : '–') + td('tgt', n.st ? fMoney(n.st) : '–') + td('tgt', n.rb ? fMoney2(n.rx / n.rb) : '–');
			h += td('head', fInt(n.p), 1) + td('head', fInt(n.l)) + td('head', n.x ? '<a class="lnk" data-goto="exceptions">' + fInt(n.x) + '</a>' : '0');
			h += td('type', fInt(n.wh), 1) + td('type', fInt(n.un)) + td('type', fInt(n.bd));
			h += td('term', n.ty === 'Vacant' ? '<span class="muted">Vacant</span>' : '<span class="tag ' + (TYPE_TAG[n.ty] || '') + '">' + esc(n.ty) + '</span>', 1, 'l') +
				td('term', fDate(n.s)) + td('term', fDate(n.e)) + td('term', n.mo == null ? '–' : n.mo);
			return h;
		}
		function vacFilter(list) {
			var out = [];
			(list || []).forEach(function (n) {
				norm(n);
				if (n.b - n.o <= 0) return;
				var copy = {};
				for (var k in n) copy[k] = n[k];
				if (n.c) { copy.c = vacFilter(n.c); if (!copy.c.length) delete copy.c; }
				out.push(copy);
			});
			return out;
		}
		var CY = D.ayShort || 'This AY', PY = D.lyShort || 'Prior AY';
		var CSV_HEAD = ['Level', 'Fund', 'Market', 'Property', 'Unit', 'Bedroom', 'Total Beds', 'Occupied Beds', 'Vacant Beds', 'Occupancy %', 'Financial Occupancy %',
			'Occupied Beds ' + PY, 'Occupancy % ' + PY, 'Monthly Revenue ' + PY, 'Same-Store Beds', 'Same-Store Rent ' + CY, 'Same-Store Rent ' + PY, 'Not Same-Store Because', 'Target Rent (Monthly)', 'Target Rent / Bed', 'Actual vs Target %',
			'Vacant Target Rent', 'Settle Rent (Monthly)', 'Prior-Yr Rent / Bed', 'Occ. Beds - Whole House', 'Occ. Beds - Unit', 'Occ. Beds - Bedroom', 'Lease Type', 'Lease Start',
			'Lease End', 'Lease Months', 'People', 'Active Leases', 'Excluded Leases', 'Monthly Revenue', 'Total Revenue', 'Rent / Bed', 'Rent / Person'];
		function csvRow(n, path) {
			norm(n);
			var p = path.concat([n.n]);
			var pad = [0, 1, 2, 3, 4].map(function (i) { return p[i] || ''; });
			var occ = ratio(n.o, n.b), fin = ratio(n.f, n.b), rb = ratio(n.mr, n.o), rp = ratio(n.mr, n.p), pct = function (r) { return r == null ? '' : (r * 100).toFixed(1); };
			return [LEVELS[n.lv]].concat(pad).concat([n.b, n.o, n.b - n.o, pct(occ), pct(fin),
				D.hasPrior ? n.po : '', D.hasPrior ? pct(ratio(n.po, n.b)) : '', D.hasPrior ? n.pm : '', D.hasPrior && n.sb ? n.sb : '', D.hasPrior && n.sb ? n.sc : '', D.hasPrior && n.sb ? n.sp : '', D.hasPrior && n.sw ? WHY[n.sw] : '',
				n.tb ? n.tg : '', n.tb ? (n.tg / n.tb).toFixed(2) : '', n.to ? pct(n.mt / n.to - 1) : '', n.tb ? n.tg - n.to : '', n.st || '', n.rb ? (n.rx / n.rb).toFixed(2) : '',
				n.wh, n.un, n.bd, n.ty, n.s || '', n.e || '', n.mo == null ? '' : n.mo, n.p, n.l, n.x, n.mr, n.tr, rb == null ? '' : rb.toFixed(2), rp == null ? '' : rp.toFixed(2)]);
		}

		var RT_NOTE = D.reportTypes || {};
		function makeTree() {
			var tbody = $('lkr-tbody'), table = $('lkr-tree'), pick = $('lkr-rt');
			if (!tbody) return null;
			var vacOnly = false, cache = {}, reg = {};
			function data() { var k = vacOnly ? 'v' : 'a'; if (!cache[k]) cache[k] = vacOnly ? vacFilter(D.tree) : D.tree; return cache[k]; }
			function rowHtml(n, id, depthOpen) {
				reg[id] = n;
				var kids = n.c && n.c.length;
				var open = kids && n.lv < depthOpen;
				var h = '<tr class="tr lv' + n.lv + (kids ? ' kids' : '') + (open ? ' open' : '') + '" data-id="' + id + '" data-lv="' + n.lv + '">' +
					'<td class="l" style="padding-left:' + (14 + n.lv * 22) + 'px">' +
					(kids ? '<button type="button" class="caret" aria-label="Expand ' + esc(n.n) + '">&#9654;</button>' : '<span class="sp"></span>') +
					'<span class="nm">' + esc(n.n) + '</span><span class="lvl">' + LEVELS[n.lv] + '</span></td>' + cells(n) + '</tr>';
				if (open) for (var i = 0; i < n.c.length; i++) h += rowHtml(n.c[i], id + '.' + i, depthOpen);
				return h;
			}
			function render(depthOpen, nodes) {
				reg = {};
				var list = nodes || data(), h = '';
				for (var i = 0; i < list.length; i++) h += rowHtml(list[i], String(i), depthOpen);
				tbody.innerHTML = h || '<tr><td class="l" colspan="40"><div class="empty"><strong>' + (vacOnly ? 'No vacant beds' : 'No matching properties') + '</strong></div></td></tr>';
			}
			function expand(tr) {
				var id = tr.getAttribute('data-id'), n = reg[id], h = '';
				for (var i = 0; i < n.c.length; i++) h += rowHtml(n.c[i], id + '.' + i, -1);
				tr.insertAdjacentHTML('afterend', h);
				tr.classList.add('open');
			}
			function collapse(tr) {
				var lv = +tr.getAttribute('data-lv'), next = tr.nextElementSibling;
				while (next && +next.getAttribute('data-lv') > lv) { var gone = next; next = next.nextElementSibling; gone.parentNode.removeChild(gone); }
				tr.classList.remove('open');
			}
			tbody.addEventListener('click', function (e) {
				if (e.target.closest('[data-goto]')) return;
				var cell = e.target.closest('td');
				var tr = e.target.closest('tr.tr');
				if (!tr || !tr.classList.contains('kids') || !cell || cell !== tr.firstElementChild) return;
				if (tr.classList.contains('open')) collapse(tr); else expand(tr);
			});
			$('lkr-tfoot').innerHTML = '<tr><td class="l">Total</td>' + cells(D.total) + '</tr>';
			var find = $('lkr-find');
			var findTimer;
			function applyFind() {
				var q = find ? find.value.trim().toLowerCase() : '';
				if (!q) { render(D.defaultDepth); return; }
				var filtered = [];
				data().forEach(function (fund) {
					var markets = [];
					(fund.c || []).forEach(function (mk) {
						var props = (mk.c || []).filter(function (p) { return String(p.n).toLowerCase().indexOf(q) > -1; });
						if (props.length) markets.push(Object.assign({}, mk, { c: props }));
					});
					if (markets.length) filtered.push(Object.assign({}, fund, { c: markets }));
				});
				render(2, filtered);
			}
			if (find) find.oninput = function () { clearTimeout(findTimer); findTimer = setTimeout(applyFind, 200); };
			function setType(rt, draw) {
				if (RTS.indexOf(rt) < 0) rt = 'occrev';
				state.rt = rt;
				if (pick) pick.value = rt;
				table.setAttribute('data-rt', rt);
				var wasVac = vacOnly;
				vacOnly = rt === 'vacancy';
				$('lkr-vac-kpis').hidden = !vacOnly;
				$('lkr-rt-note').textContent = RT_NOTE[rt] || '';
				if (draw && wasVac !== vacOnly) applyFind();
				if (window.history && history.replaceState && state.tab === 'details') history.replaceState(null, '', hashNow());
				try { window.localStorage.setItem('lkr.reportType', rt); } catch (err) { /* storage unavailable */ }
			}
			if (pick) pick.onchange = function () { setType(this.value, true); };
			$('lkr-tree-expand').onclick = function () { if (find) find.value = ''; render(9); };
			$('lkr-tree-collapse').onclick = function () { if (find) find.value = ''; render(0); };
			$('lkr-tree-export').onclick = function () {
				var rows = [CSV_HEAD];
				(function walk(list, path) { list.forEach(function (n) { rows.push(csvRow(n, path)); if (n.c) walk(n.c, path.concat([n.n])); }); })(data(), []);
				download('Lease_KPI_' + (vacOnly ? 'Vacancy_' : 'Leasing_Details_') + D.ayName.replace(/\s+/g, '_') + '_' + D.basis + '.csv', rows);
			};
			var start = state.rt;
			if (!start) { try { start = window.localStorage.getItem('lkr.reportType') || ''; } catch (err) { start = ''; } }
			setType(start || 'occrev', false);
			return { init: function () { render(D.defaultDepth); } };
		}
		var tree = makeTree();

		var KIND_LABEL = { lease: 'Lease', tenant: 'Tenant', unit: 'Unit/Bedroom', property: 'Property', details: 'Academic Year Details' };
		function fixRows(kind) {
			var tb = root.querySelector('[data-fix-rows="' + kind + '"]');
			if (!tb || tb.getAttribute('data-done')) return;
			var tbl = tb.parentNode, rent = tbl.getAttribute('data-rent') === '1', showKind = tbl.getAttribute('data-kind-col') === '1';
			function a(href, text) { return href ? '<a class="lnk" href="' + esc(href) + '" target="_blank">' + esc(text) + '</a>' : esc(text); }
			tb.innerHTML = ((D.fixes || {})[kind] || []).map(function (r) {
				var rel = r.r.length ? r.r.slice(0, 4).map(function (y) { return a(y[2], y[1]); }).join('<br>') + (r.rc > 4 ? '<br><span class="muted small">+' + (r.rc - 4) + ' more</span>' : '') : '<span class="muted">–</span>';
				return '<tr class="' + (r.v > 1 ? 'sevrow' : '') + '" data-value="' + esc(r.s) + '" data-text="' + esc((r.n + ' ' + r.p + ' ' + r.u).toLowerCase()) + '">' +
					'<td class="l">' + (showKind ? '<span class="tag">' + esc(KIND_LABEL[r.k] || r.k) + '</span> ' : '') + a(r.l, r.n) + '</td>' +
					'<td class="l">' + esc(r.s) + (r.d ? '<div class="muted small">' + esc(r.d) + '</div>' : '') + '</td>' +
					'<td class="l wrapcell fixcell">' + esc(r.f) + '</td><td class="l">' + rel + '</td>' +
					'<td class="l">' + esc(r.p || '–') + '</td><td class="l">' + esc(r.u || '–') + '</td>' + (rent ? '<td>' + (r.m == null ? '–' : fMoney2(r.m)) + '</td>' : '') + '</tr>';
			}).join('');
			tb.setAttribute('data-done', '1');
		}
		function wireFix(kind) {
			var tbl = $('lkr-fix-' + kind);
			if (!tbl) return;
			var chips = root.querySelectorAll('[data-fix-sum="' + kind + '"] .fix-chip');
			var search = root.querySelector('[data-fix-search="' + kind + '"]');
			var active = null;
			function apply() {
				var q = search ? search.value.trim().toLowerCase() : '';
				var rows = tbl.tBodies[0].rows;
				for (var i = 0; i < rows.length; i++) {
					var okValue = !active || rows[i].getAttribute('data-value') === active;
					var okText = !q || rows[i].getAttribute('data-text').indexOf(q) > -1;
					rows[i].style.display = okValue && okText ? '' : 'none';
				}
			}
			for (var c = 0; c < chips.length; c++) {
				chips[c].onclick = function () {
					var value = this.getAttribute('data-value');
					active = active === value ? null : value;
					for (var k = 0; k < chips.length; k++) chips[k].classList.toggle('on', chips[k].getAttribute('data-value') === active);
					apply();
				};
			}
			if (search) search.oninput = apply;
		}
		['lease', 'tenant', 'records'].forEach(wireFix);


		// ---- Pipeline: one row per leasable unit, edited in place ----
		var PL = D.pipeline || null;
		var plDirty = {};          // unitId -> changed fields, not yet written
		var plErr = {};            // unitId -> message from the last save attempt
		var plFlight = {};         // unitId -> in the request currently on the wire
		var plOk = {};             // unitId -> written a moment ago, tick still showing
		var plOpen = {};           // unitId -> drawer expanded
		var plSaving = false;
		var plAutoT = null;        // debounce handle
		var plOkT = null;          // handle for clearing the saved ticks
		var plAgain = false;       // an edit landed while a request was in flight
		var plNoteFor = null;
		// Rows with the lease dialog open. Their edits stay out of autosave until the dialog is
		// saved, so closing it leaves the unit exactly as it was - no half-entered terms, and no
		// stage change that the dialog was supposed to justify.
		var plHold = {};
		var plLeaseCancel = null;   // the open dialog's cancel, so Escape takes the same path
		var PL_LABEL = { '1': 'Renewal Declined', '3': 'Ready For Lease - Waiting on Forms', '4': 'Lease Out - Unsigned', '5': 'Fully Executed', '6': 'Offline', '7': 'Renewal Offered' };
		var PL_CLASS = { '1': 'st-decl', '3': 'st-ready', '4': 'st-out', '5': 'st-exec', '6': 'st-off', '7': 'st-renew', '': 'st-none' };
		var PL_ORDER = ['7', '1', '3', '4', '5', '6', ''];
		var PL_EDIT = ['7', '1', '3', '6'];
		// 2 was Lease Form Collection, merged into 3. Fold it so it can never render as a twin.
		function plStageFold(v) { var k = v == null ? '' : String(v); return k === '2' ? '3' : k; }
		var PL_NONE = 'No stage set';

		function plCount() { var n = 0; for (var k in plDirty) if (plDirty.hasOwnProperty(k) && !plHold[k]) n += 1; return n; }
		// Every lease puts its id on the bedroom leaves it covers, whole-house and unit leases
		// included, so one count answers "are any beds still available here" for all three types.
		function plBeds(r) {
			var rooms = r.bd || [];
			if (!rooms.length) return { total: Number(r.b) || 0, let_: r.li ? (Number(r.b) || 0) : 0, rooms: [] };
			var taken = rooms.filter(function (b) { return b[3]; });
			return { total: rooms.length, let_: taken.length, rooms: rooms };
		}
		function plFree(r) { var b = plBeds(r); return b.total - b.let_; }
		// The same split Leasing Details carries under "Occupied by Lease Type".
		function plTypeSplit(r) {
			var o = r.ob || [0, 0, 0, 0];
			if (r.lty !== 'Mixed') return '';
			var bits = [];
			if (o[0]) bits.push(fInt(o[0]) + ' whole house');
			if (o[1]) bits.push(fInt(o[1]) + ' unit');
			if (o[2]) bits.push(fInt(o[2]) + ' bedroom');
			return bits.length ? '<div class="muted small">' + bits.join(' \u00b7 ') + ' beds</div>' : '';
		}
		function plBedsCell(r) {
			var b = plBeds(r);
			if (!b.total) return '<span class="muted">\u2013</span>';
			if (!b.let_) return fInt(b.total) + '<div class="bedfree">all free</div>';
            if (b.let_ >= b.total) return fInt(b.total) + '<div class="bedfull">full</div>';
			return fInt(b.total) + '<div class="bedpart">' + fInt(b.total - b.let_) + ' free</div>';
		}
		function plLeaseOwned(r) { return String(r.sr || '') === '2'; }
		function plEditable(r) { return !r.ro && !plLeaseOwned(r); }
		function plStageOf(r) {
			var d = plDirty[r.u];
			if (d && d.hasOwnProperty('manualStage')) return plStageFold(d.manualStage);
			return plStageFold(r.g);
		}
		function plVal(r, key, base) {
			var d = plDirty[r.u];
			if (d && d.hasOwnProperty(key)) return d[key];
			return base == null ? '' : base;
		}
		// What put this unit in its current stage, and when. For a lease-driven stage that is the lease's
		// own date, not the day the sync wrote the row - otherwise every executed lease reads "2 days".
		function plAge(r) {
			var st = plStageOf(r);
			if (st === '') return null;
			if (plLeaseOwned(r)) {
				if (st === '5' && r.sgn) return { on: r.sgn, why: 'lease signed' };
				if (r.sent) return { on: r.sent, why: 'lease sent' };
			}
			if (r.sd) return { on: r.sd, why: plLeaseOwned(r) ? 'stage recorded by the sync' : 'stage set by leasing' };
			return null;
		}
		function plDays(r) {
			var a = plAge(r);
			if (!a) return null;
			return Math.round((Date.parse(PL.today) - Date.parse(a.on)) / 86400000);
		}
		function plBreach(r) { return r.mr != null && r.sf > 0 && r.mr < r.sf; }
		function plNotes(r) { return r.no || []; }
		function plMentionsMe(r) {
			if (!PL.me) return false;
			return plNotes(r).some(function (n) { return (n.m || []).indexOf(PL.me) > -1; });
		}
		function plNeedsAction(r) {
			if (!plEditable(r)) return false;
			if (plStageOf(r) === '') return true;
			var f = plVal(r, 'followup', r.fu);
            return !!f && f <= PL.today;
		}
		function plList() {
			var mk = $('lkr-pl-market').value, st = $('lkr-pl-stage').value;
			var q = $('lkr-pl-q').value.trim().toLowerCase(), act = $('lkr-pl-action').checked;
			var freeEl = $('lkr-pl-free'), freeOnly = freeEl && freeEl.checked;
			var meEl = $('lkr-pl-me'), me = meEl && meEl.checked;
			return PL.rows.filter(function (r) {
				if (mk && r.m !== mk) return false;
				if (st) { var cur = plStageOf(r); if (st === '_blank' ? cur !== '' : cur !== st) return false; }
				if (q && (r.p + ' ' + r.n + ' ' + plVal(r, 'expected', r.ex) + ' ' + (r.pt || '')).toLowerCase().indexOf(q) < 0) return false;
				if (act && !plNeedsAction(r)) return false;
				if (freeOnly && plFree(r) <= 0) return false;
				if (me && !plMentionsMe(r)) return false;
				return true;
			});
		}
		function plBand(list) {
			var t = { beds: 0, by: {} };
			PL_ORDER.forEach(function (s) { t.by[s] = { u: 0, b: 0 }; });
			list.forEach(function (r) {
				var s = plStageOf(r);
				if (!t.by[s]) t.by[s] = { u: 0, b: 0 };
				t.beds += r.b; t.by[s].u += 1; t.by[s].b += r.b;
			});
			var breach = list.filter(plBreach).length;
			function stat(v, l, cls) { return '<div class="pl-stat' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + l + '</span></div>'; }
			var all = list.length === PL.rows.length;
			$('lkr-pl-band').innerHTML =
				stat(fInt(list.length), all ? 'Units' : 'Units of ' + fInt(PL.rows.length)) +
				stat(fInt(t.beds), all ? 'Beds' : 'Beds of ' + fInt(PL.beds)) +
				stat(fPct(ratio(t.by['5'].b, t.beds)), 'Executed', 'ok') +
				stat(fInt(t.by['4'].u), 'Out unsigned', 'warn') +
				stat(fInt(t.by[''].u), 'No stage') +
				stat(fInt(t.by['6'].u), 'Offline') +
				stat(fInt(breach), 'Below settle', breach ? 'bad' : '');
			$('lkr-pl-bar').innerHTML = t.beds ? PL_ORDER.map(function (s) {
				var b = t.by[s].b;
				if (!b) return '';
				return '<i class="' + PL_CLASS[s] + '" style="width:' + (b / t.beds * 100) + '%" title="' +
					esc((s === '' ? PL_NONE : PL_LABEL[s]) + ': ' + fInt(t.by[s].u) + ' units, ' + fInt(b) + ' beds') + '"></i>';
			}).join('') : '';
			$('lkr-pl-count').textContent = fInt(list.length) + (list.length === 1 ? ' unit' : ' units') + ' · ' + fInt(t.beds) + ' beds';
		}
		function plStageCell(r) {
			var st = plStageOf(r);
			if (!plEditable(r)) {
				return '<span class="pill ' + PL_CLASS[st] + '" style="color:#fff">' + esc(st === '' ? PL_NONE : PL_LABEL[st]) + '</span>' +
					'<div class="pl-ro">' + (r.ro ? 'No unit record' : 'Set by the lease') + '</div>';
			}
			var o = '<option value=""' + (st === '' ? ' selected' : '') + '>' + esc(PL_NONE) + '</option>';
			PL_EDIT.forEach(function (s) { o += '<option value="' + s + '"' + (st === s ? ' selected' : '') + '>' + esc(PL_LABEL[s]) + '</option>'; });
			var t = plTermsOf(r);
			var open = (st === '3' || t)
				? '<div class="pl-ro"><button type="button" class="lfopen" data-pl-lease="' + esc(r.u) + '">' +
					(t ? 'Lease terms \u00b7 captured' : 'Add lease terms') + '</button></div>'
				: '';
			return '<select data-pl-f="manualStage" data-pl-u="' + esc(r.u) + '">' + o + '</select>' + open;
		}
		function plTgtCell(r) {
			if (r.tm == null && r.tb == null) return '<span class="muted">no target</span>';
			var v = '';
			if (r.mr != null && r.tm) {
				var d = r.mr - r.tm;
				if (Math.abs(d) >= 1) v = '<div class="tvar ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '−') + fMoney(Math.abs(d)).slice(1) + ' vs target</div>';
			}
			return '<div class="tgt"><b>' + fMoney(r.tm) + '</b><span>' + fMoney(r.tb) + ' /bed</span>' + v + '</div>';
		}
		function plAgeCell(r) {
			var d = plDays(r), a = plAge(r);
			if (d == null) return '<span class="muted">–</span>';
			return '<span class="age' + (d >= 21 ? ' stale' : (d >= 10 ? ' old' : '')) + '" title="' + esc(a.why + ' ' + fDate(a.on)) + '">' + d + '</span>';
		}
		function plNoteCell(r) {
			if (!PL.notesOn) return '<span class="muted">–</span>';
			var ns = plNotes(r), last = ns.length ? ns[ns.length - 1] : null;
			var tagged = last && (last.m || []).length;
			return '<button type="button" class="notebtn" data-pl-note="' + esc(r.u) + '">' +
				(tagged ? '<span class="atb">@</span>' : '') +
				(last ? '<span class="notetext">' + esc(last.t) + '</span>' : '<span class="notetext none">Add a note</span>') +
				(ns.length ? '<span class="ncount">' + ns.length + '</span>' : '') + '</button>';
		}
		function plRow(r) {
			var open = !!plOpen[r.u], ed = plEditable(r);
			var fu = plVal(r, 'followup', r.fu), due = ed && fu && fu <= PL.today;
			var state = plFlight[r.u] ? 'flight' : plErr[r.u] ? 'rowerr' : plDirty[r.u] ? 'dirty' : plOk[r.u] ? 'okrow' : '';
			var tag = state === 'flight' ? '<span class="rowtag">saving</span>'
				: state === 'okrow' ? '<span class="rowtag">saved</span>' : '';
			var h = '<tr class="' + state + (open ? ' open' : '') + '" data-pl-row="' + esc(r.u) + '">' +
				'<td class="chev"><button type="button" class="chevbtn" data-pl-x="' + esc(r.u) + '" aria-expanded="' + open + '" aria-label="Leasing history">' + (open ? '&#9660;' : '&#9654;') + '</button></td>' +
				'<td class="sel">' + (ed ? '<input type="checkbox" data-pl-sel="' + esc(r.u) + '">' : '') + '</td>' +
				'<td class="l"><strong>' + esc(r.n) + '</strong><div class="muted small">' + esc(r.p) + ' · ' + esc(r.ml) + '</div>' +
					(r.li ? '<div class="small">' + (r.lk
						? '<a class="lnk" href="' + esc(r.lk) + '" target="_blank" rel="noopener">' + esc(r.ln || ('Lease ' + r.li)) + '</a>'
						: esc(r.ln || ('Lease ' + r.li))) +
						(r.ns ? ' <span class="nostat" title="No Lease Status, so it is not in the leasing statistics">no status</span>' : '') +
						(r.sy ? ' <span class="spanyr" title="One lease record covering more than one academic year">yr ' + r.sy[0] + '/' + r.sy[1] + '</span>' : '') + '</div>' : '') +
					(plErr[r.u] ? '<div class="small" style="color:var(--bad);font-weight:600">' + esc(plErr[r.u]) +
						'<button type="button" class="retry" data-pl-retry="' + esc(r.u) + '">retry</button></div>' : '') + tag + '</td>' +
				'<td>' + plBedsCell(r) + '</td>' +
				'<td class="l">' + plStageCell(r) + '</td>' +
				'<td>' + plAgeCell(r) + '</td>' +
				'<td>' + plTgtCell(r) + '</td>' +
				'<td>' + (ed ? '<input type="number" step="5" min="0" style="width:72px;text-align:right" data-pl-f="lastOffer" data-pl-u="' + esc(r.u) + '" value="' + esc(plVal(r, 'lastOffer', r.lo)) + '">' : fMoney(r.lo === '' ? null : r.lo)) + '</td>' +
				'<td>' + fMoney(r.mr) + (plBreach(r) ? '<span class="breach" title="Signed below the ' + esc(fMoney(r.sf)) + ' settle floor">&#9650;</span>' : '') + '</td>' +
				'<td class="l">' + (ed ? '<input type="text" maxlength="300" style="width:150px" placeholder="Names…" data-pl-f="expected" data-pl-u="' + esc(r.u) + '" value="' + esc(plVal(r, 'expected', r.ex)) + '">' : '<span class="muted small">on the lease</span>') + '</td>' +
				'<td class="l' + (due ? ' due' : '') + '">' + (ed ? '<input type="date" style="width:124px" data-pl-f="followup" data-pl-u="' + esc(r.u) + '" value="' + esc(fu) + '">' : '<span class="muted">–</span>') + '</td>' +
				'<td class="l">' + plNoteCell(r) + '</td></tr>';
			if (open) h += plDrawer(r);
			return h;
		}
		function plDrawer(r) {
			function row(label, monthly, perBed, status, now) {
				return '<tr' + (now ? ' class="now"' : '') + '><td class="l">' + esc(label) + '</td><td>' + monthly + '</td><td>' + perBed + '</td><td class="l muted">' + esc(status) + '</td></tr>';
			}
			var st = plStageOf(r);
			var rows = '';
			if (PL.priorName) {
				rows += row(PL.priorName, fMoney(r.pr), r.pr != null && r.b ? fMoney(r.pr / r.b) : '–', r.pr != null ? 'Signed' : 'No lease on this unit');
			}
			rows += row(PL.ayName, fMoney(r.tm), fMoney(r.tb),
				r.mr != null ? 'Signed ' + fMoney(r.mr) : (st === '' ? 'Not started' : PL_LABEL[st]), true);
			if (PL.nextName) {
				rows += row(PL.nextName, fMoney(r.xm), fMoney(r.xb), r.xm == null ? 'Targets not set yet' : 'Target');
			}
			var tn = plVal(r, 'expected', r.ex);
			var d = plDays(r), a = plAge(r);
			return '<tr class="pl-drawer"><td colspan="12"><div class="dw">' +
				'<div><h4>Rent by academic year</h4><table class="hist"><thead><tr><th class="l">Academic year</th><th>Monthly</th><th>Per bed</th><th class="l">Status</th></tr></thead><tbody>' + rows + '</tbody></table>' +
				'<dl class="kv" style="margin-top:8px">' +
					'<dt>Settle floor</dt><dd>' + fMoney(r.sf) + (plBreach(r) ? ' <span style="color:var(--bad);font-weight:600">signed below it</span>' : '') + '</dd>' +
					'<dt>Offered /bed</dt><dd>' + fMoney(plVal(r, 'lastOffer', r.lo) === '' ? null : plVal(r, 'lastOffer', r.lo)) + '</dd>' +
					(function () {
						var b = plBeds(r);
						if (!b.rooms.length) return '';
						var free = b.rooms.filter(function (x) { return !x[3]; });
						return '<dt>Beds available</dt><dd>' + (free.length
							? fInt(free.length) + ' of ' + fInt(b.total) + ' \u00b7 ' + free.map(function (x) { return esc(x[1]); }).join(', ')
							: 'none \u2014 all ' + fInt(b.total) + ' are spoken for') + '</dd>';
					})() +
					(r.lty && r.lty !== 'Vacant'
						? '<dt>Occupied by</dt><dd>' + esc(r.lty) + plTypeSplit(r) +
							(r.ls || r.le ? '<div class="muted small">' + fDate(r.ls) + ' \u2013 ' + fDate(r.le) + '</div>' : '') + '</dd>'
						: '') +
				'</dl></div>' +
				'<div><h4>Pre-leasing</h4><dl class="kv">' +
					'<dt>Stage</dt><dd>' + esc(st === '' ? PL_NONE : PL_LABEL[st]) + (plLeaseOwned(r) ? ' (from the lease)' : ' (set by leasing)') + '</dd>' +
					'<dt>Days in stage</dt><dd>' + (d == null ? '–' : d + ' <span class="muted small">since ' + esc(a.why) + ' ' + fDate(a.on) + '</span>') + '</dd>' +
					'<dt>Lease</dt><dd>' + (r.li ? (r.lk ? '<a class="lnk" href="' + esc(r.lk) + '" target="_blank">' + esc(r.ln) + '</a>' : esc(r.ln)) : '<span class="muted">none yet</span>') +
						(r.lu ? '<div class="small" style="color:#b45309">Found on the unit’s inventory, not linked on the status record</div>' : '') +
						(r.ns ? '<div class="small" style="color:#b45309">This lease has no Lease Status, so it is out of every leasing statistic. Set it to In Process with the Sent Date once it goes out.</div>' : '') +
						(r.sy ? '<div class="small" style="color:#1f5fb4">Year ' + r.sy[0] + ' of a ' + r.sy[1] + '-year lease \u2014 one record, counted in each year it runs.</div>' : '') +
						(r.lc > 1 ? '<div class="muted small">' + fInt(r.lc) + ' leases cover beds in this unit</div>' : '') + '</dd>' +
					'<dt>Sent / signed</dt><dd>' + fDate(r.sent) + ' · ' + fDate(r.sgn) + '</dd>' +
					'<dt>Current tenants</dt><dd>' + (r.pt ? esc(r.pt) + ' <span class="muted small">(' + esc(PL.priorName || 'prior AY') + ')</span>' : '<span class="muted">none on record</span>') + '</dd>' +
					'<dt>Expected tenants</dt><dd>' + (tn ? esc(tn) : '<span class="muted">none recorded</span>') + '</dd>' +
					'<dt>Follow-up</dt><dd>' + fDate(plVal(r, 'followup', r.fu)) + '</dd>' +
					'<dt>Notes</dt><dd>' + plNotes(r).length + '</dd>' +
				'</dl></div></div></td></tr>';
		}
		function plDraw() {
			if (!PL) return;
			var fk = plFocusKey();
			var list = plList();
			plBand(list);
			var shown = list.slice(0, PL.cap);
			$('lkr-pl-table').tBodies[0].innerHTML = shown.map(plRow).join('') ||
				'<tr><td colspan="12" class="l muted" style="padding:14px 20px">No units match these filters.</td></tr>';
			$('lkr-pl-all').checked = false;
			var unlinked = list.filter(function (x) { return x.lu; }).length;
			$('lkr-pl-foot').innerHTML = (list.length > shown.length
				? 'Showing the first ' + fInt(shown.length) + ' of ' + fInt(list.length) + ' rows. Narrow the filters to see the rest — edits you have already made are kept.'
				: fInt(list.length) + (list.length === 1 ? ' row' : ' rows') + '. Stage, follow-up, offered rent and expected tenants save back to the unit’s status record.') +
				(unlinked
					? '<div style="color:#b45309;margin-top:3px">' + fInt(unlinked) + (unlinked === 1 ? ' unit shows a lease that is' : ' units show a lease that is') +
					  ' not linked on the status record — read from the inventory instead. Mostly whole-house leases with no unit link, and bedroom leases, which AD_UE_Lease_Stage_Sync does not pick up.</div>'
					: '') +
				(function () {
					var ns = list.filter(function (x) { return x.ns; }).length;
					return ns
						? '<div style="color:#b45309;margin-top:3px">' + fInt(ns) + (ns === 1 ? ' unit has a lease with no Lease Status' : ' units have a lease with no Lease Status') +
						  ' — shown here as Ready For Lease - Waiting on Forms, but excluded from every leasing statistic until the status is set.</div>'
						: '';
				})();
			plSaveBar();
			plFocusBack(fk);
		}
		function plAnyOk() { for (var k in plOk) if (plOk.hasOwnProperty(k)) return true; return false; }
		function plSaveBar() {
			var n = plCount(), bad = 0;
			for (var k in plErr) if (plErr.hasOwnProperty(k)) bad += 1;
			$('lkr-pl-save').hidden = !(n || plSaving || bad || plAnyOk());
			$('lkr-pl-dirty').textContent = n
				? n + (n === 1 ? ' row edited' : ' rows edited')
				: plSaving ? 'Saving\u2026'
				: bad ? bad + (bad === 1 ? ' row needs attention' : ' rows need attention')
				: 'All changes saved';
			$('lkr-pl-savebtn').disabled = plSaving || !n;
			$('lkr-pl-revert').disabled = plSaving || !n;
		}
		function plConfirmLeave() {
			if (!plCount() || plSaving) return true;
			return window.confirm(plCount() + ' edited row(s) have not been saved. Leave anyway and lose them?');
		}
		function plMark(u, field, value, quiet) {
			var r = PL.byId[u];
			if (!r) return;
			// Ready For Lease is stage 3. Ask for the terms there and then, while whoever agreed
			// them still has them in their head. Only on the way in, and only once.
			if (field === 'manualStage' && String(value) === '3' && !r.li && !plTermsOf(r)) {
				plHold[u] = 1;
				window.setTimeout(function () { plLease(r, true); }, 0);
			}
			var raw = field === 'manualStage' ? (r.g == null ? '' : r.g)
				: field === 'followup' ? r.fu : field === 'lastOffer' ? r.lo : r.ex;
			var base = String(raw == null ? '' : raw);
			var d = plDirty[u] || {};
			if (String(value == null ? '' : value) === base) { delete d[field]; } else { d[field] = String(value == null ? '' : value); }
			var any = false;
			for (var k in d) if (d.hasOwnProperty(k)) any = true;
			if (any) plDirty[u] = d; else delete plDirty[u];
			delete plErr[u]; delete plOk[u];
			if (quiet) plSaveBar(); else plDraw();
			plQueue();
		}
		// Autosave. Edits go up about a second after you stop touching the row, so there is no
		// Save step to forget. One request is on the wire at a time; anything edited while it is
		// out stays dirty and goes in the next one. The market lock and the lease-owned stage
		// check still run server-side on every call, so a row can still come back rejected.
		function plAutoOn() { var e = $('lkr-pl-auto'); return !e || e.checked; }
		function plQueue() {
			if (!plAutoOn() || !plCount()) return;
			if (plSaving) { plAgain = true; return; }
			if (plAutoT) window.clearTimeout(plAutoT);
			$('lkr-pl-msg').textContent = 'Autosaving\u2026';
			plAutoT = window.setTimeout(function () { plAutoT = null; plSave(); }, 1200);
		}
		function plStamp() {
			var d = new Date(), h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am';
			h = h % 12 || 12;
			return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
		}
		// plDraw() replaces every row, which drops the caret out of whatever is being typed in.
		function plFocusKey() {
			var a = document.activeElement;
			if (!a || !a.getAttribute) return null;
			var f = a.getAttribute('data-pl-f'), u = a.getAttribute('data-pl-u');
			if (!f || !u) return null;
			var k = { f: f, u: u, s: null, e: null };
			try { k.s = a.selectionStart; k.e = a.selectionEnd; } catch (err) { /* number inputs throw */ }
			return k;
		}
		function plFocusBack(k) {
			if (!k) return;
			var el = root.querySelector('[data-pl-u="' + k.u + '"][data-pl-f="' + k.f + '"]');
			if (!el) return;
			try { el.focus(); if (k.s != null && el.setSelectionRange) el.setSelectionRange(k.s, k.e); } catch (err) { /* ignore */ }
		}
		// ---- Ready For Lease dialog ----
		// Ready For Lease is the moment the deal is real. Capturing the terms then, rather than
		// reconstructing them weeks later when someone finally builds the lease, is the whole point.
		// Everything here maps field-for-field onto the lease record; it is held on the status row as
		// JSON only until "Create lease record" writes the real thing.
		var PL_LTYPE = { 1: 'Whole House', 2: 'Unit', 3: 'Bedroom' };
		var PL_GTYPE = { 1: 'New Group', 2: 'Transfers', 3: 'Renewal' };
		// Lease dates per market, as [startMonth, startDay, endMonth, endDay]. The start year comes
		// from the academic year; the end is always the following year. Oxford has no agreed
		// calendar yet, so its dates are left for the user to enter.
		var PL_CAL = {
			'binghamton': [6, 1, 5, 23],
			'troy': [6, 1, 5, 18],
			'bethlehem': [6, 15, 5, 22],
			'charleston': [8, 5, 7, 25],
			'savannah': [6, 5, 5, 31],
			'new orleans': [6, 4, 5, 27],
			'providence': [6, 22, 5, 23]
		};
		function plPad(n) { return (n < 10 ? '0' : '') + n; }
		function plAyStartYear() {
			var m = /^(\d{4})/.exec(String(PL.ayStart || ''));
			return m ? Number(m[1]) : null;
		}
		function plCalDates(marketKey, years) {
			var cal = PL_CAL[String(marketKey || '').toLowerCase()], y = plAyStartYear();
			if (!cal || !y) return null;
			return {
				start: y + '-' + plPad(cal[0]) + '-' + plPad(cal[1]),
				end: (y + (years || 1)) + '-' + plPad(cal[2]) + '-' + plPad(cal[3])
			};
		}
		// Term is whatever the dates say, rounded UP: a lease running 1 June to 23 May is eleven
		// and a bit months of occupancy but twelve months of service, and that is how they are priced.
		function plTermMonths(start, end) {
			var a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''));
			var b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(end || ''));
			if (!a || !b) return null;
			var months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
			if (Number(b[3]) > Number(a[3])) months += 1;
			return months > 0 ? months : null;
		}
		var plLeaseFor = null;
		function plAddMonths(d, n) {
			var p = String(d || '').split('-');
			if (p.length !== 3) return '';
			var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
			dt.setUTCMonth(dt.getUTCMonth() + n);
			dt.setUTCDate(dt.getUTCDate() - 1);
			return dt.toISOString().slice(0, 10);
		}
		function plTermsOf(r) {
			var raw = plVal(r, 'terms', r.lt);
            if (!raw) return null;
			try { var o = JSON.parse(raw); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
		}
		function plCloseLease() { plLeaseFor = null; plLeaseCancel = null; $('lkr-pl-lease').innerHTML = ''; }
		function plLease(r, fromStage) {
			if (!r) return;
			plLeaseFor = r.u;
			var host = $('lkr-pl-lease');
			var existing = plTermsOf(r);
			// Unit is the default: it is the commonest type and, on a single-unit property, identical
			// to Whole House. Defaulting to Whole House on a big unit would quietly commit the
			// whole property.
			var cal0 = plCalDates(r.m, 1);
			var lf = existing || {
				type: '2', twoYear: false,
				start: cal0 ? cal0.start : '', end: cal0 ? cal0.end : '',
				months: cal0 ? plTermMonths(cal0.start, cal0.end) : '',
				perBed: '',
				names: plVal(r, 'expected', r.ex) || (r.pt ? r.pt : ''),
				group: r.pt ? '3' : '1',
				water: false, gas: false,
				provisions: '', notes: '',
				bedroomIds: []
			};
			var perBedTouched = !!(existing && existing.perBed);
			// Prior tenants are only a sensible guess on a renewal. On a new group or a transfer the
			// names are someone else entirely, so the box starts empty and refills only if the type
			// is switched back. Anything saved earlier, or typed here, counts as the agent's and is
			// never overwritten.
			var namesTouched = !!(existing || plVal(r, 'expected', r.ex));
			// [id, name, beds, leaseId] per bedroom. A Bedroom lease links one of these, never the
			// unit, and a part-let house therefore becomes one lease record per bedroom.
			var rooms = (r.bd || []).map(function (b) {
				return { id: String(b[0]), name: b[1], beds: Number(b[2]) || 1, leaseId: b[3] || null };
			});
			var freeRooms = rooms.filter(function (b) { return !b.leaseId; });
			if (!Array.isArray(lf.bedroomIds)) lf.bedroomIds = [];
			// The three scopes, as the engine reads them:
			//   Whole House - linked to the property, no unit link, covers every unit there
			//   Unit        - linked to the unit, covers that unit
			//   Bedroom     - linked to a bedroom child, covers one bed
			var sibs = (PL.rows || []).filter(function (x) { return x.pi && x.pi === r.pi && !x.ro; });
			if (!sibs.length) sibs = [r];
			var sibsFree = sibs.filter(function (x) { return !x.li; });
			function isBedType() { return String(lf.type) === '3'; }
			function isHouseType() { return String(lf.type) === '1'; }
			// Monthly rent starts at target. Whole House sums every unit's target at the property,
			// Unit uses that unit's, Bedroom uses the unit's divided by its beds. All three come out
			// as the same per-bed number, which is what the field holds.
			function targetPerBed() {
				var tm, tb;
				if (isHouseType()) {
					tm = sibs.reduce(function (sum, x) { return sum + (Number(x.tm) || 0); }, 0);
					tb = sibs.reduce(function (sum, x) { return sum + (Number(x.b) || 0); }, 0);
				} else {
					tm = Number(r.tm) || 0;
					tb = Number(r.b) || 0;
				}
				if (!tb || !tm) return null;
				return Math.round((tm / tb) * 100) / 100;
			}
			function applyTarget() {
				if (perBedTouched) return;
				var t = targetPerBed();
				lf.perBed = t === null ? '' : t;
				var e = $('lkr-lf-perbed');
				if (e) e.value = lf.perBed;
			}
			function applyNames() {
				if (namesTouched) return;
				lf.names = String(lf.group) === '3' ? (r.pt || '') : '';
				var e = $('lkr-lf-names');
				if (e) e.value = lf.names;
			}
			function targetNote() {
				if (targetPerBed() !== null) return '';
				return '<div class="hint" style="color:var(--bad)">No ' + esc(PL.ayName) + ' target rent is set for ' +
					(isHouseType() ? 'these units' : 'this unit') + ', so there is nothing to prefill. Enter the rent by hand.</div>';
			}
            function picked() {
				return lf.bedroomIds.filter(function (id) {
					return freeRooms.some(function (b) { return b.id === id; });
				});
			}
			// Beds the lease will actually cover: the chosen bedrooms, or the whole unit.
			function scopeBeds() {
				if (isHouseType()) return sibs.reduce(function (sum, x) { return sum + (Number(x.b) || 0); }, 0) || (Number(r.b) || 1);
				if (!isBedType()) return Number(r.b) || 1;
				return picked().reduce(function (sum, id) {
					var b = freeRooms.filter(function (x) { return x.id === id; })[0];
					return sum + (b ? b.beds : 0);
				}, 0);
			}
			function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
			function opt(map, cur) {
				var o = '';
				for (var k in map) if (map.hasOwnProperty(k)) {
					o += '<option value="' + k + '"' + (String(cur) === k ? ' selected' : '') + '>' + esc(map[k]) + '</option>';
				}
				return o;
			}
			function calc() {
				var pb = num(lf.perBed), m = num(lf.months) || 12, sb = scopeBeds();
				var unitBeds = Number(r.b) || 1;
				// The settle floor is a per-unit monthly figure, so it is shared down for a bedroom
				// lease and summed across the property for a whole-house one.
				var floor = isBedType()
					? (num(r.sf) / unitBeds) * (sb || 1)
					: isHouseType()
						? sibs.reduce(function (sum, x) { return sum + num(x.sf); }, 0)
						: num(r.sf);
				return {
					monthly: pb * sb, total: pb * sb * m, perBed: pb, months: m,
					beds: sb, floor: floor, records: isBedType() ? picked().length : 1,
					underSettle: r.sf != null && sb > 0 && pb * sb < floor
				};
			}
			function outHtml() {
				var c = calc();
				var scopeNote = isBedType()
					? (c.records
						? c.records + (c.records === 1 ? ' bedroom' : ' bedrooms') + ' \u00b7 ' + c.records + (c.records === 1 ? ' lease record' : ' lease records')
						: 'No bedrooms chosen')
					: isHouseType()
						? fInt(sibs.length) + (sibs.length === 1 ? ' unit' : ' units') + ' \u00b7 ' + fInt(c.beds) + ' beds \u00b7 whole property'
						: fInt(c.beds) + ' beds \u00b7 this unit only';
				return '<div class="lfcalc">' +
					'<div><span>' + (isBedType() ? 'Monthly rent, all chosen' : 'Monthly rent') + '</span><b>' + fMoney(c.monthly) + '</b></div>' +
					'<div><span>Total for term</span><b>' + fMoney(c.total) + '</b></div>' +
					'<div><span>Term</span><b>' + c.months + ' mo</b></div>' +
					'<div><span>Covers</span><b style="font-size:12px">' + esc(scopeNote) + '</b></div></div>' +
					(isBedType() && !c.records
						? '<div class="lfflag">Choose at least one bedroom. A bedroom lease has to name the room it covers.</div>'
						: (c.perBed && r.sf != null
							? (c.underSettle
								? '<div class="lfflag">' + fMoney(c.monthly) + ' is below the ' + fMoney(c.floor) + ' settle floor for ' + (isBedType() ? 'these bedrooms' : 'this unit') + '.</div>'
								: '<div class="lfflag ok">At or above the settle floor.</div>')
							: ''));
			}
			function scopeHtml() {
				if (!isHouseType()) return '';
				var taken = sibs.filter(function (x) { return x.li; });
				var noTarget = sibs.filter(function (x) { return !Number(x.tm); });
				if (sibs.length === 1) {
					return '<div class="hint">' + esc(r.p) + ' has one unit, so Whole House and Unit cover the same thing here.</div>';
				}
				return '<div class="lfscope">' +
					'<b>Covers all ' + fInt(sibs.length) + ' units at ' + esc(r.p) + '</b>' +
					'<div>' + sibs.map(function (x) {
						return '<span class="' + (x.li ? 'taken' : '') + '">' + esc(x.n) + ' \u00b7 ' + fInt(x.b) + 'b' + (x.li ? ' (leased)' : '') + '</span>';
					}).join('') + '</div>' +
					(taken.length
						? '<div class="lfflag" style="margin-top:7px">' + fInt(taken.length) + ' of these already ' + (taken.length === 1 ? 'has a lease' : 'have leases') + ' for this year, so a whole-house lease cannot be created. Lease the free units individually instead.</div>'
						: '<div class="hint">The lease is written against the property with no unit link, which is what scopes it to all of them. Every unit\u2019s row is pointed at it.</div>') +
					(noTarget.length
						? '<div class="lfflag" style="margin-top:7px">' + fInt(noTarget.length) + ' of these ' + (noTarget.length === 1 ? 'unit has' : 'units have') + ' no ' + esc(PL.ayName) + ' target rent, so the prefilled rent is short by whatever they should contribute. Set the targets or enter the rent by hand.</div>'
						: '') +
					'</div>';
			}
			function roomsHtml() {
				if (!isBedType()) return '';
				if (!rooms.length) return '<div class="hint">This unit has no bedroom records, so it cannot take a bedroom lease. Use Whole House or Unit.</div>';
				return '<div class="lfbeds">' + rooms.map(function (b) {
					if (b.leaseId) {
						return '<label class="taken" title="Already leased for this year"><input type="checkbox" disabled> <s>' + esc(b.name) + '</s></label>';
					}
					var on = lf.bedroomIds.indexOf(b.id) > -1;
					return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-lf-bed="' + esc(b.id) + '"' + (on ? ' checked' : '') + '> ' + esc(b.name) + '</label>';
				}).join('') + '</div>';
			}
			// Only the derived readouts change as you type. Rebuilding the dialog on each keystroke
			// is what throws the caret out of the field.
			function refresh(sync) {
				var e, i;
				var derived = plTermMonths(lf.start, lf.end);
				if (derived !== null) lf.months = derived;
				e = $('lkr-lf-rooms');
				if (e) {
					e.innerHTML = roomsHtml() + scopeHtml();
					e.parentNode.className = 'lff' + (isBedType() || isHouseType() ? ' wide' : '');
				}
				e = $('lkr-lf-out'); if (e) e.innerHTML = outHtml();
				e = $('lkr-lf-end'); if (e) e.value = lf.end || '';
				e = $('lkr-lf-months'); if (e) e.value = lf.months === '' || lf.months === null ? '' : lf.months;
				e = $('lkr-lf-tnote'); if (e) e.innerHTML = targetNote();
			}
			function pull() {
				function v(id) { var e = $(id); return e ? e.value : ''; }
				function ck(id) { var e = $(id); return !!(e && e.checked); }
				lf.type = v('lkr-lf-type'); lf.twoYear = ck('lkr-lf-2yr');
				lf.start = v('lkr-lf-start'); lf.end = v('lkr-lf-end');
				lf.months = plTermMonths(lf.start, lf.end);
				lf.perBed = v('lkr-lf-perbed');
				lf.group = v('lkr-lf-group'); lf.names = v('lkr-lf-names');
				lf.water = ck('lkr-lf-water'); lf.gas = ck('lkr-lf-gas');
				lf.provisions = v('lkr-lf-prov'); lf.notes = v('lkr-lf-notes');
			}
			function st(t) { var e = $('lkr-lf-st'); if (e) e.textContent = t; }
			// Deliberately NOT autosaved. A half-entered set of lease terms is worse than none, and
			// the stage change that opened this dialog is only justified once the terms are in. So
			// nothing leaves this dialog until Save, and Cancel puts the unit back as it was.
			var dirtyHere = false;
			function touch() { dirtyHere = true; st('Not saved yet \u2014 Cancel discards this and leaves the unit as it was.'); }
			function commit() {
				pull();
				plMark(r.u, 'terms', JSON.stringify(lf), true);
				if (String(lf.perBed || '') !== String(plVal(r, 'lastOffer', r.lo) || '')) plMark(r.u, 'lastOffer', lf.perBed, true);
				if (lf.names) plMark(r.u, 'expected', String(lf.names).replace(/\s*\n\s*/g, ', ').slice(0, 300), true);
				dirtyHere = false;
				delete plHold[r.u];
				plQueue();
			}
			// Cancel removes everything this dialog put on the row, including the stage change that
			// opened it, so the unit falls back to No stage set with nothing filled in.
			plLeaseCancel = function cancel() {
				var d = plDirty[r.u];
				if (d) {
					delete d.terms; delete d.lastOffer; delete d.expected;
					if (fromStage) delete d.manualStage;
					var any = false;
					for (var k in d) if (d.hasOwnProperty(k)) any = true;
					if (!any) delete plDirty[r.u];
				}
				delete plHold[r.u];
				plCloseLease();
				plDraw();
			};
			var cancel = plLeaseCancel;
			host.innerHTML =
				'<div class="lfscrim" data-lf-x></div><div class="lfwrap"><div class="lfbox" role="dialog" aria-label="Lease details">' +
				'<div class="lfhd"><h3>Lease details \u2014 ' + esc(r.n) + '</h3>' +
				'<p>' + esc(r.p) + ' \u00b7 ' + esc(r.ml) + ' \u00b7 ' + fInt(r.b) + ' beds \u00b7 ' + esc(PL.ayName) +
				' \u00b7 captured when the unit goes Ready For Lease</p></div>' +
				'<div class="lfbd">' +
					'<fieldset class="lfset"><legend>Term</legend><div class="lfgrid">' +
						'<div class="lff' + (isBedType() ? ' wide' : '') + '"><label for="lkr-lf-type">Lease type</label><select id="lkr-lf-type">' + opt(PL_LTYPE, lf.type) + '</select>' +
							'<div id="lkr-lf-rooms">' + roomsHtml() + scopeHtml() + '</div></div>' +
						'<label class="lfchk"><input type="checkbox" id="lkr-lf-2yr"' + (lf.twoYear ? ' checked' : '') + '> Two-year lease</label>' +
						'<div class="lff"><label for="lkr-lf-start">Lease start</label><input type="date" id="lkr-lf-start" value="' + esc(lf.start) + '"></div>' +
						'<div class="lff"><label for="lkr-lf-end">Lease end</label><input type="date" id="lkr-lf-end" value="' + esc(lf.end) + '"></div>' +
						'<div class="lff ro"><label for="lkr-lf-months">Term (months)</label>' +
							'<input type="number" id="lkr-lf-months" value="' + esc(lf.months) + '" readonly>' +
							'<div class="hint">' + (cal0
								? esc(r.ml) + ' calendar, rounded up'
								: 'No lease calendar set for ' + esc(r.ml) + ' \u2014 enter the dates') + '</div></div>' +
					'</div></fieldset>' +
					'<fieldset class="lfset"><legend>Rent</legend><div class="lfgrid">' +
						'<div class="lff"><label for="lkr-lf-perbed">Rent per bed (monthly)</label><input type="number" id="lkr-lf-perbed" step="5" min="0" value="' + esc(lf.perBed) + '">' +
							'<div id="lkr-lf-tnote">' + targetNote() + '</div></div>' +
						'<div class="lff ro"><label>Target per bed</label><input type="text" value="' + esc(fMoney(r.tb)) + '" readonly></div>' +
						'<div class="lff ro"><label>Settle floor (monthly)</label><input type="text" value="' + esc(fMoney(r.sf)) + '" readonly></div>' +
					'</div><div id="lkr-lf-out">' + outHtml() + '</div></fieldset>' +
					'<fieldset class="lfset"><legend>People</legend><div class="lfgrid">' +
						'<div class="lff"><label for="lkr-lf-group">Group type</label><select id="lkr-lf-group">' + opt(PL_GTYPE, lf.group) + '</select></div>' +
						'<div class="lff wide"><label for="lkr-lf-names">Expected names on lease</label>' +
							'<textarea id="lkr-lf-names" rows="2" placeholder="One per line, or comma separated">' + esc(lf.names) + '</textarea>' +
							'<div class="hint">These carry into Expected Tenants so ops can watch for the applications. Linking the real tenant records happens on the lease.</div></div>' +
					'</div></fieldset>' +
					'<fieldset class="lfset"><legend>Utilities included</legend><div class="lfgrid">' +
						'<label class="lfchk"><input type="checkbox" id="lkr-lf-water"' + (lf.water ? ' checked' : '') + '> Water / sewer included</label>' +
						'<label class="lfchk"><input type="checkbox" id="lkr-lf-gas"' + (lf.gas ? ' checked' : '') + '> Gas / electric included</label>' +
					'</div></fieldset>' +
					'<fieldset class="lfset"><legend>Additional provisions</legend><div class="lfgrid">' +
						'<div class="lff wide"><label for="lkr-lf-prov">Additional provisions</label>' +
							'<textarea id="lkr-lf-prov" rows="3" placeholder="Anything that needs to appear on the lease">' + esc(lf.provisions) + '</textarea></div>' +
					'</div></fieldset>' +
					'<fieldset class="lfset"><legend>General lease notes</legend><div class="lfgrid">' +
						'<div class="lff wide"><label for="lkr-lf-notes">Anything unusual about this deal</label>' +
							'<textarea id="lkr-lf-notes" rows="3" placeholder="Odd terms, side agreements, parent guarantees, what was promised verbally, anything the person drafting the lease needs to know">' + esc(lf.notes) + '</textarea>' +
							'<div class="hint">Carried onto the lease record. For day-to-day chatter use the unit\u2019s notes thread instead \u2014 that one is dated and taggable.</div></div>' +
					'</div></fieldset>' +
					(r.li ? '<div class="lfmade">Lease ' + esc(r.ln || r.li) + ' already exists for this unit. Change its terms on the lease record itself.</div>' : '') +
				'</div>' +
				'<div class="lfft"><span class="lfst" id="lkr-lf-st">' +
					(fromStage
						? 'Nothing is saved until you press Save. Cancel leaves the unit at No stage set.'
						: 'Nothing is saved until you press Save.') + '</span>' +
					'<button type="button" class="btn sm" data-lf-x>Cancel</button>' +
					'<button type="button" class="btn sm" id="lkr-lf-save">Save details</button>' +
					(r.li ? '' : '<button type="button" class="btn sm primary" id="lkr-lf-make">Create lease record</button>') +
				'</div></div></div>';

			var xs = host.querySelectorAll('[data-lf-x]');
			for (var i = 0; i < xs.length; i++) xs[i].onclick = function () {
				if (dirtyHere && !window.confirm('Discard these lease details?' + (fromStage ? ' The unit goes back to No stage set.' : ''))) return;
				cancel();
			};
			$('lkr-lf-save').onclick = function () {
				pull();
				if (!Number(lf.perBed)) { st('Enter a rent per bed before saving.'); return; }
				if (isBedType() && !picked().length) { st('Choose at least one bedroom first.'); return; }
				commit(); plCloseLease(); plDraw();
			};
			// A two-year lease ends on the same market date two years out, not twelve months after
			// whatever happens to be in the end box.
			$('lkr-lf-2yr').onchange = function () {
				pull(); lf.twoYear = this.checked;
				var c = plCalDates(r.m, lf.twoYear ? 2 : 1);
				if (c) { lf.start = c.start; lf.end = c.end; }
				else if (lf.start) { lf.end = plAddMonths(lf.start, lf.twoYear ? 24 : 12); }
				var e = $('lkr-lf-start'); if (e) e.value = lf.start || '';
				e = $('lkr-lf-end'); if (e) e.value = lf.end || '';
				refresh(true);
			};
			$('lkr-lf-type').onchange = function () {
				pull();
				// Default to every free bedroom on the first switch: part-letting the whole house is
				// the common case, and unticking is quicker than ticking nine boxes.
				if (isBedType() && !picked().length) lf.bedroomIds = freeRooms.map(function (b) { return b.id; });
				// The scope changed, so the target the rent is priced off changed with it.
				applyTarget();
				refresh(true);
			};
			$('lkr-lf-perbed').oninput = function () { perBedTouched = true; pull(); refresh(); };
			$('lkr-lf-group').onchange = function () { pull(); applyNames(); refresh(); };
			$('lkr-lf-names').oninput = function () { namesTouched = true; pull(); };
			$('lkr-lf-start').onchange = function () { pull(); refresh(); };
			$('lkr-lf-end').onchange = function () { pull(); refresh(); };
			$('lkr-lf-water').onchange = function () { pull(); refresh(); };
			$('lkr-lf-gas').onchange = function () { pull(); refresh(); };
			host.addEventListener('click', function (e) {
				var cb = e.target.closest ? e.target.closest('[data-lf-bed]') : null;
				if (!cb) return;
				var id = cb.getAttribute('data-lf-bed'), at = lf.bedroomIds.indexOf(id);
				if (cb.checked && at < 0) lf.bedroomIds.push(id);
				else if (!cb.checked && at > -1) lf.bedroomIds.splice(at, 1);
				refresh();
			});
			host.addEventListener('input', function () { pull(); touch(); });
			host.addEventListener('change', function () { pull(); touch(); });

			var mk = $('lkr-lf-make');
			if (mk) mk.onclick = function () {
				pull();
				if (!Number(lf.perBed)) { st('Enter a rent per bed before creating the lease.'); return; }
				var sel = picked();
				if (isBedType() && !sel.length) { st('Choose at least one bedroom first.'); return; }
				if (isHouseType() && sibsFree.length < sibs.length) {
					st('Some units at ' + r.p + ' are already leased, so a whole-house lease cannot be created.');
					return;
				}
				var what = isBedType()
					? sel.length + (sel.length === 1 ? ' bedroom lease' : ' separate bedroom lease records') + ' for ' + r.n
					: isHouseType()
						? 'a whole-house lease covering all ' + sibs.length + (sibs.length === 1 ? ' unit' : ' units') + ' at ' + r.p
						: 'a lease record for ' + r.n + ' only';
				if (!window.confirm('Create ' + what + '?\n\nWritten with no Lease Status, so ' + (sel.length > 1 ? 'they stay' : 'it stays') + ' out of the leasing statistics. Set the status to In Process with the Sent Date once the lease actually goes out.')) return;
				this.disabled = true; this.textContent = 'Creating\u2026';
				var btn = this;
				lf.bedroomIds = sel;
				plPost({ action: 'lease', ay: D.ay, unitId: r.u, terms: JSON.stringify(lf) })
					.then(function (out) {
						if (!out.ok) { st(out.message || 'The lease could not be created.'); btn.disabled = false; btn.textContent = 'Create lease record'; return; }
						r.li = String(out.leaseId); r.ln = out.leaseName || ''; r.lt = '';
						if (out.leaseUrl) r.lk = out.leaseUrl;
						if (out.stage) { r.g = out.stage; r.sr = '1'; r.sd = PL.today; }
						(out.bedroomIds || []).forEach(function (id) {
							(r.bd || []).forEach(function (b) { if (String(b[0]) === String(id)) b[3] = out.leaseId; });
						});
						// A whole-house lease covers the siblings too, so their rows have to show it
						// or the board would still offer them as available.
						// A whole-house lease covers the siblings, so they move to the same stage and
						// point at the same lease record. Their beds read as taken from the same data.
						(out.unitIds || []).forEach(function (id) {
							var sib = PL.byId[String(id)];
							if (!sib || sib === r) return;
							sib.li = String(out.leaseId); sib.ln = out.leaseName || ''; sib.lt = '';
							if (out.leaseUrl) sib.lk = out.leaseUrl;
							if (out.stage) { sib.g = out.stage; sib.sr = '1'; sib.sd = PL.today; }
							(sib.bd || []).forEach(function (b) { if (!b[3]) b[3] = out.leaseId; });
							delete plDirty[sib.u];
						});
						// Whole House and Unit cover every bed in the unit, so mark them all taken.
						if (out.scope !== 'bedroom') {
							(r.bd || []).forEach(function (b) { if (!b[3]) b[3] = out.leaseId; });
						}
						if (out.statusId) r.s = String(out.statusId);
						if (out.monthly != null) r.mr = out.monthly;
						delete (plDirty[r.u] || {}).terms;
						delete plHold[r.u];
						if (plDirty[r.u]) { delete plDirty[r.u].terms; delete plDirty[r.u].manualStage; }
						plLeaseCancel = null;
						plCloseLease(); plDraw();
						$('lkr-pl-msg').textContent = 'Lease ' + (out.leaseName || out.leaseId) + ' created. ' + (out.message || '');
					})
					.catch(function (err) {
						st('The lease could not be created: ' + (err && err.message ? err.message : err));
						btn.disabled = false; btn.textContent = 'Create lease record';
					});
			};
			applyTarget();
			refresh();
		}
		// ---- notes ----
		function plFmtNote(n) {
			var h = esc(n.t);
			(n.m || []).forEach(function (id) {
				var who = PL.teamById[id];
				if (!who) return;
				h = h.split('@' + who).join('<span class="mention' + (id === PL.me ? ' me' : '') + '">@' + esc(who) + '</span>');
			});
			return h;
		}
		function plCloseNotes() { plNoteFor = null; plRenderOver(); }
		function plRenderOver() {
			var host = $('lkr-pl-over');
			host.innerHTML = '';
			if (!plNoteFor) return;
			var r = PL.byId[plNoteFor];
			if (!r) return;
			var ns = plNotes(r);
			var items = ns.slice().reverse().map(function (n, i) {
				return '<div class="note' + (i === 0 ? ' newest' : '') + '"><div class="meta"><b>' + esc(n.w || 'Unknown') + '</b><span>' + fDate(n.d) + '</span></div><p>' + plFmtNote(n) + '</p></div>';
			}).join('') || '<div class="muted" style="text-align:center;padding:22px 0">No notes on this unit yet.</div>';
			var composer = PL.team.length
				? '<div class="overft"><div class="acwrap"><textarea id="lkr-pl-ntext" rows="3" placeholder="Add a note. Type @ to tag someone."></textarea><div class="ac" id="lkr-pl-ac" hidden></div></div>' +
				  '<div style="display:flex;gap:8px;align-items:center"><span class="muted small">Stamped with today’s date and your name \u00b7 ' + PL.team.length + ' taggable</span><div class="spacer" style="flex:1"></div>' +
				  '<button type="button" class="btn sm primary" id="lkr-pl-nadd">Add note</button></div></div>'
				: '<div class="overft"><p class="muted small">The employee list could not be read, so notes cannot be added from here.</p></div>';
			host.innerHTML = '<div class="scrim" id="lkr-pl-scrim"></div><div class="over" role="dialog" aria-label="Notes">' +
				'<div class="overhd"><div style="flex:1;min-width:0"><h3>' + esc(r.n) + '</h3>' +
				'<div class="muted small">' + esc(r.p) + ' · ' + esc(r.ml) + ' · ' + ns.length + (ns.length === 1 ? ' note' : ' notes') + '</div></div>' +
				'<button type="button" class="btn sm" id="lkr-pl-nclose">Close</button></div>' +
				'<div class="overbody">' + items + '</div>' + composer + '</div>';
			$('lkr-pl-scrim').onclick = plCloseNotes;
			$('lkr-pl-nclose').onclick = plCloseNotes;
			if (!PL.team.length) return;
			var ta = $('lkr-pl-ntext'), ac = $('lkr-pl-ac');
			function hideAc() { ac.hidden = true; ac.innerHTML = ''; }
			function showAc() {
				var head = ta.value.slice(0, ta.selectionStart);
				var m = /@([A-Za-z.\-']*(?:\s[A-Za-z.\-']*)?)$/.exec(head);
				if (!m) { hideAc(); return; }
				var q = m[1].toLowerCase();
				// Match any part of the name, not just the start of it, so a surname finds the person.
				// Prefix matches rank first and the list scrolls, so a bare @ shows the whole team.
				var hits = PL.team.filter(function (t) { return !q || t.n.toLowerCase().indexOf(q) > -1; })
					.sort(function (x, y) {
						var a = x.n.toLowerCase().indexOf(q) === 0 ? 0 : 1, b = y.n.toLowerCase().indexOf(q) === 0 ? 0 : 1;
						return a - b || x.n.localeCompare(y.n);
					}).slice(0, 25);
				if (!hits.length) { hideAc(); return; }
				ac.innerHTML = hits.map(function (t) { return '<button type="button" class="acitem" data-pl-ac="' + esc(t.n) + '">' + esc(t.n) + '</button>'; }).join('');
				ac.hidden = false;
			}
			ta.oninput = showAc;
			ta.onblur = function () { setTimeout(hideAc, 160); };
			ac.onmousedown = function (e) {
				var b = e.target.closest('[data-pl-ac]');
				if (!b) return;
				e.preventDefault();
				var name = b.getAttribute('data-pl-ac'), c = ta.selectionStart;
				ta.value = ta.value.slice(0, c).replace(/@([A-Za-z.\-']*(?:\s[A-Za-z.\-']*)?)$/, '@' + name + ' ') + ta.value.slice(c);
				ta.focus(); hideAc();
			};
			$('lkr-pl-nadd').onclick = function () {
				var text = ta.value.trim();
				if (!text) return;
				var tagged = PL.team.filter(function (t) { return text.indexOf('@' + t.n) > -1; }).map(function (t) { return t.i; });
				this.disabled = true;
				this.textContent = 'Saving…';
				plPost({ action: 'note', ay: D.ay, unitId: r.u, statusId: r.s, text: text, mentions: tagged })
					.then(function (out) {
						if (!out.ok) { window.alert(out.message || 'The note could not be saved.'); plRenderOver(); return; }
						if (out.statusId) r.s = String(out.statusId);
						r.no = plNotes(r).concat([{ i: String(out.noteId || ''), d: PL.today, w: out.author || 'You', t: text, m: tagged }]);
						ta.value = '';
						plRenderOver(); plDraw();
					})
					.catch(function (err) { window.alert('The note could not be saved: ' + (err && err.message ? err.message : err)); plRenderOver(); });
			};
			ta.focus();
		}
		function plPost(payload) {
			return fetch(D.baseUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify(payload)
			}).then(function (res) { return res.json(); });
		}
		// Chunked at 50 and run one chunk at a time: a custom-record submitFields costs 2 governance units
		// against the Suitelet's 1,000, and a failed chunk must leave the rest visibly unsaved.
		function plSave() {
			if (plSaving) return;
			if (plAutoT) { window.clearTimeout(plAutoT); plAutoT = null; }
			// Snapshot what goes on the wire. A row edited again while the request is out must not
			// be cleared by that request's answer, or the second edit is silently dropped.
			var pending = [], sent = {};
			for (var u in plDirty) if (plDirty.hasOwnProperty(u) && !plHold[u]) {
				var row = { unitId: u };
				var d = plDirty[u];
				for (var f in d) if (d.hasOwnProperty(f)) row[f] = d[f];
				pending.push(row);
				sent[u] = plSig(plDirty[u]);
				plFlight[u] = 1;
			}
			if (!pending.length) { plFlight = {}; return; }
			plSaving = true; plAgain = false; plErr = {};
			var done = 0, failed = 0, held = 0;
			plDraw();
			function finish(msg) {
				plSaving = false;
				plFlight = {};
				$('lkr-pl-msg').textContent = msg;
				plDraw();
				plFade();
				if (plAgain || plCount()) { plAgain = false; plQueue(); }
			}
			function chunk(i) {
				if (i >= pending.length) {
					finish(done
						? 'Saved ' + done + (done === 1 ? ' row' : ' rows') + ' at ' + plStamp() + '.' +
							(failed ? ' ' + failed + ' could not be saved \u2014 see the rows marked in red.' : '') +
							(held ? ' ' + held + ' changed again and will go next.' : '')
						: (failed ? failed + (failed === 1 ? ' row was' : ' rows were') + ' not saved.' : 'Nothing to save.'));
					return;
				}
				var slice = pending.slice(i, i + 50);
				$('lkr-pl-msg').textContent = pending.length > 50
					? 'Saving ' + (i + 1) + '\u2013' + (i + slice.length) + ' of ' + pending.length + '\u2026'
					: 'Saving\u2026';
				plPost({ action: 'save', ay: D.ay, rows: slice }).then(function (out) {
					(out.results || []).forEach(function (x) {
						var r = PL.byId[x.unit];
						var d = plDirty[x.unit] || {};
						var stale = plSig(d) !== sent[x.unit];
						if (x.action === 'updated' || x.action === 'created') {
							done += 1;
							if (r) {
								if (x.id) r.s = String(x.id);
								if (d.hasOwnProperty('manualStage')) { r.g = d.manualStage; r.sr = '1'; r.sd = d.manualStage ? PL.today : null; }
								if (d.hasOwnProperty('followup')) r.fu = d.followup;
								if (d.hasOwnProperty('lastOffer')) r.lo = d.lastOffer;
								if (d.hasOwnProperty('expected')) r.ex = d.expected;
							}
							if (stale) { held += 1; } else { delete plDirty[x.unit]; plOk[x.unit] = 1; }
						} else if (x.action === 'skipped') {
							if (!stale) delete plDirty[x.unit];
						} else {
							failed += 1;
							plErr[x.unit] = x.message || 'Not saved';
						}
					});
					if (out.ok === false || out.stopped) { finish((out.message || 'Some rows were not saved.') + ' The rest are still marked unsaved.'); return; }
					chunk(i + 50);
				}).catch(function (err) {
					finish('Could not reach NetSuite: ' + (err && err.message ? err.message : err) + '. Your edits are still here \u2014 use Save now once you are back online.');
				});
			}
			chunk(0);
		}
		function plSig(d) {
			var ks = [], k;
			for (k in d) if (d.hasOwnProperty(k)) ks.push(k);
			ks.sort();
			return ks.map(function (x) { return x + '=' + d[x]; }).join('|');
		}
		// The green tick is a receipt, not a state. Clear it so the board goes quiet again.
		function plFade() {
			if (plOkT) window.clearTimeout(plOkT);
			if (!plAnyOk()) return;
			plOkT = window.setTimeout(function () {
				plOkT = null; plOk = {};
				if (!plCount() && !plSaving) $('lkr-pl-msg').textContent = '';
				plDraw();
			}, 3000);
		}
		function plInit() {
			if (!PL) return;
			PL.byId = {}; PL.teamById = {};
			PL.rows.forEach(function (r) { PL.byId[r.u] = r; });
			(PL.team || []).forEach(function (t) { PL.teamById[t.i] = t.n; });
			['lkr-pl-market', 'lkr-pl-stage'].forEach(function (id) { $(id).onchange = plDraw; });
			$('lkr-pl-q').oninput = plDraw;
			$('lkr-pl-action').onchange = function () { $('lkr-pl-action-l').classList.toggle('on', this.checked); plDraw(); };
			$('lkr-pl-free').onchange = function () { $('lkr-pl-free-l').classList.toggle('on', this.checked); plDraw(); };
			var meEl = $('lkr-pl-me');
			if (meEl) meEl.onchange = function () { $('lkr-pl-me-l').classList.toggle('on', this.checked); plDraw(); };
			$('lkr-pl-expand').onclick = function () {
				var list = plList(), any = list.some(function (r) { return !plOpen[r.u]; });
				list.slice(0, PL.cap).forEach(function (r) { if (any) plOpen[r.u] = 1; else delete plOpen[r.u]; });
				this.textContent = any ? 'Collapse all' : 'Expand all';
				plDraw();
			};
			$('lkr-pl-all').onclick = function () {
				var on = this.checked, b = root.querySelectorAll('[data-pl-sel]');
				for (var i = 0; i < b.length; i++) b[i].checked = on;
			};
			$('lkr-pl-bulk').onchange = function () {
				var v = this.value; this.value = '';
				if (!v) return;
				var sel = root.querySelectorAll('[data-pl-sel]:checked');
				if (!sel.length) { $('lkr-pl-msg').textContent = 'Tick some rows first.'; $('lkr-pl-save').hidden = false; return; }
				for (var i = 0; i < sel.length; i++) plMark(sel[i].getAttribute('data-pl-sel'), 'manualStage', v === '_blank' ? '' : v);
			};
			$('lkr-pl-revert').onclick = function () {
				if (plSaving) return;
				if (!window.confirm('Discard ' + plCount() + ' edited row(s) that have not been written yet?')) return;
				if (plAutoT) { window.clearTimeout(plAutoT); plAutoT = null; }
				plDirty = {}; plErr = {}; plOk = {}; $('lkr-pl-msg').textContent = ''; plDraw();
			};
			$('lkr-pl-savebtn').onclick = function () { if (!plSaving && plCount()) plSave(); };
			$('lkr-pl-auto').onchange = function () {
				if (this.checked) {
					$('lkr-pl-msg').textContent = plCount() ? 'Autosaving\u2026' : 'Autosave on.';
					plQueue();
				} else {
					if (plAutoT) { window.clearTimeout(plAutoT); plAutoT = null; }
					$('lkr-pl-msg').textContent = 'Autosave off \u2014 use Save now.';
				}
				plSaveBar();
			};
			$('lkr-pl-export').onclick = function () {
				var rows = [['Market', 'Property', 'Unit', 'Beds', 'Stage', 'Days in stage', 'Stage set', 'Stage source',
					'Target monthly', 'Target per bed', 'Settle floor', 'Offered per bed', 'Signed', 'Below settle',
					'Expected tenants', 'Current tenants', 'Follow-up', 'Notes', 'Latest note', 'Lease']];
				plList().forEach(function (r) {
					var st = plStageOf(r), ns = plNotes(r), last = ns.length ? ns[ns.length - 1] : null;
					rows.push([r.ml, r.p, r.n, r.b, st === '' ? PL_NONE : PL_LABEL[st], plDays(r) == null ? '' : plDays(r),
						r.sd || '', plLeaseOwned(r) ? 'Lease' : 'Manual', r.tm == null ? '' : r.tm, r.tb == null ? '' : r.tb,
						r.sf == null ? '' : r.sf, plVal(r, 'lastOffer', r.lo), r.mr == null ? '' : r.mr, plBreach(r) ? 'Y' : '',
						plVal(r, 'expected', r.ex), r.pt || '', plVal(r, 'followup', r.fu), ns.length, last ? last.t : '', r.ln || '']);
				});
				download('Lease_KPI_Pipeline_' + D.ayName.replace(/\s+/g, '_') + '.csv', rows);
			};
			root.addEventListener('change', function (e) {
				var el = e.target.closest ? e.target.closest('[data-pl-f]') : null;
				if (el) plMark(el.getAttribute('data-pl-u'), el.getAttribute('data-pl-f'), el.value);
			});
			// Typed fields mark quietly: redrawing the table on every keystroke threw the caret
			// out of the box being typed in.
			root.addEventListener('input', function (e) {
				var el = e.target.closest ? e.target.closest('input[data-pl-f="expected"],input[data-pl-f="lastOffer"]') : null;
				if (el) plMark(el.getAttribute('data-pl-u'), el.getAttribute('data-pl-f'), el.value, true);
			});
			root.addEventListener('click', function (e) {
				var rt = e.target.closest ? e.target.closest('[data-pl-retry]') : null;
				if (rt) {
					var ru = rt.getAttribute('data-pl-retry');
					delete plErr[ru];
					plDraw();
					if (plAutoOn()) plQueue(); else if (!plSaving) plSave();
					return;
				}
				var x = e.target.closest ? e.target.closest('[data-pl-x]') : null;
				if (x) { var id = x.getAttribute('data-pl-x'); if (plOpen[id]) delete plOpen[id]; else plOpen[id] = 1; plDraw(); return; }
				var lf = e.target.closest ? e.target.closest('[data-pl-lease]') : null;
				if (lf) { plLease(PL.byId[lf.getAttribute('data-pl-lease')]); return; }
				var n = e.target.closest ? e.target.closest('[data-pl-note]') : null;
				if (n) { plNoteFor = n.getAttribute('data-pl-note'); plRenderOver(); }
			});
			document.addEventListener('keydown', function (e) {
				if (e.key !== 'Escape') return;
				if (plLeaseFor) { if (plLeaseCancel) plLeaseCancel(); else { plCloseLease(); plDraw(); } return; }
				if (plNoteFor) plCloseNotes();
			});
			window.addEventListener('beforeunload', function (e) {
				if (!plCount() || plSaving) return;
				e.preventDefault(); e.returnValue = '';
			});
			plDraw();
		}

		function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
		function download(name, rows) {
			var blob = new Blob(['\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name;
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
		}
		root.addEventListener('click', function (e) {
			var b = e.target.closest('[data-fix-export]');
			if (!b) return;
			var kind = b.getAttribute('data-fix-export');
			var rows = [['Record Type', 'Record ID', 'Record', 'Issue', 'Detail', 'Action to Fix', 'Related Records', 'Property', 'Units/Bedroom', 'Monthly Rent', 'Link']];
			((D.fixes || {})[kind] || []).forEach(function (r) {
				rows.push([r.k, r.i, r.n, r.s, r.d || '', r.f, r.r.map(function (x) { return x[1]; }).join('; ') + (r.rc > r.r.length ? '; +' + (r.rc - r.r.length) + ' more' : ''),
					r.p || '', r.u || '', r.m == null ? '' : r.m, r.l ? new URL(r.l, window.location.href).href : '']);
			});
			download('Lease_KPI_To_Fix_' + kind + '_' + D.ayName.replace(/\s+/g, '_') + '.csv', rows);
		});

		// ---- Weekly report ----
		// Delegated, because the history table now appears both on the tab and inside a deck slide.
		root.addEventListener('click', function (e) {
			var b = e.target.closest ? e.target.closest('[data-hist-n] button[data-n]') : null;
			if (!b) return;
			var seg = b.parentNode, card = seg.closest('[data-sec="history"]') || root;
			var n = Number(b.getAttribute('data-n'));
			var rows = card.querySelectorAll('[data-hist] tbody tr');
			for (var i = 0; i < rows.length; i++) rows[i].hidden = n > 0 && Number(rows[i].getAttribute('data-i')) >= n;
			var bs = seg.querySelectorAll('button');
			for (var j = 0; j < bs.length; j++) bs[j].classList.toggle('on', bs[j] === b);
		});
		var weekSel = $('lkr-week');
		if (weekSel) weekSel.onchange = function () { $('lkr-run').click(); };
		root.addEventListener('click', function (e) {
			var b = e.target.closest('[data-week-step]');
			if (!b || b.disabled || !weekSel) return;
			var i = weekSel.selectedIndex - Number(b.getAttribute('data-week-step'));
			if (i < 0 || i >= weekSel.options.length) return;
			weekSel.selectedIndex = i;
			$('lkr-run').click();
		});

		// Present: full screen, Weekly tiles + breakdown + pace chart only.
		// ---- Present mode ----
		// A deck built from the forward academic years. Each AY's sections are fetched the first time
		// the deck is opened, so a normal page load computes nothing extra. Market scope comes from the
		// report filter, so the deck always shows whatever is on screen.
		var deck = [], deckAt = 0, deckData = {}, deckReady = false;
		function fwdAys() { return (D.wk && D.wk.forward) || []; }
		function deckUrl(ayId) {
			var p = window.LKR_PARAMS(), q = '';
			for (var k in p) if (p[k] && k !== 'ay') q += '&' + k + '=' + encodeURIComponent(p[k]);
			return D.baseUrl + q + '&ay=' + encodeURIComponent(ayId) + '&wkay=1';
		}
		function deckEl() { return $('lkr-deck'); }
		function deckSay(msg) { deckEl().innerHTML = '<div class="deck-slide on"><div class="card empty"><strong>' + esc(msg) + '</strong></div></div>'; }
		function buildDeck() {
			var ays = fwdAys();
			var slides = [{ kind: 'pre', title: 'Pre-leasing by academic year', ay: null }];
			ays.forEach(function (a) {
				slides.push({ kind: 'group', title: 'Leasing activity this week', ay: a.id, name: a.name });
				slides.push({ kind: 'pace', title: 'Leasing Pace', ay: a.id, name: a.name });
			});
			return slides;
		}
		// "AY 2027-2028" is fine in a filter and too terse on a slide someone walks in on.
		function ayFull(n) { return String(n || '').replace(/^AY\s+/, 'Academic Year '); }
		function deckHead(sl) {
			var W = D.wk || {};
			var line = [W.weekLabel ? 'Week of ' + W.weekLabel : '', W.scope || '', W.basis || ''].filter(Boolean).join(' \u00b7 ');
			return '<div class="deck-head"><div>' +
				'<span class="ay">' + esc(sl.name ? ayFull(sl.name) : 'All future academic years') + '</span>' +
				'<h2>' + esc(sl.title) + '</h2><p>' + esc(line) + '</p></div>' +
				'<span class="pos">' + (deckAt + 1) + ' of ' + deck.length + '</span></div>';
		}
		function preSlide() {
			var ays = fwdAys();
			var cells = ays.map(function (a) {
				var d = deckData[a.id];
				if (!d) return '';
				var p = d.pre;
				return '<div class="card cmp-tile"><div class="head"><div><h3>' + esc(ayFull(a.name)) + '</h3>' +
					'<p class="sec-note">Pre-leasing to ' + esc(d.ayName) + '</p></div></div>' +
					'<div class="cmp-big"><span>Pre-leased</span><strong>' + fPct(p.occPct) + '</strong>' +
					'<small>' + fInt(p.occ) + ' of ' + fInt(p.beds) + ' beds</small>' +
					'<div class="cmp-deltas"><em>vs ' + esc((D.wk && D.wk.ly) || 'LY') + '</em><span>' + dlt(p.vsLyPct, fPts) + '</span>' +
					'<em>vs prior wk</em><span>' + dlt(p.dOccPct, fPts) + '</span></div></div>' +
					'<div class="sec-tiles">' +
						'<div class="sec-tile"><span>This week</span><strong>' + fInt(p.newBeds) + '</strong><small>beds leased</small></div>' +
						'<div class="sec-tile"><span>Sent</span><strong>' + fInt(p.sent) + '</strong><small>this week</small></div>' +
						'<div class="sec-tile"><span>Executed</span><strong>' + fInt(p.executed) + '</strong><small>this week</small></div>' +
						'<div class="sec-tile"><span>In process</span><strong>' + fInt(p.inProcess) + '</strong><small>at week end</small></div>' +
					'</div></div>';
			}).join('');
			// Side by side on the same measures, because the question on this slide is always
			// "how does next year compare with the one after it".
			var ly = (D.wk && D.wk.ly) || 'LY';
			function row(label, pick, cls) {
				return '<tr><td class="l">' + esc(label) + '</td>' +
					ays.map(function (a) {
						var d = deckData[a.id];
						return '<td class="v' + (cls ? ' ' + cls : '') + '">' + (d ? pick(d.pre) : '<span class="muted">\u2013</span>') + '</td>';
					}).join('') + '</tr>';
			}
			// Named bands instead of blank spacers: the eye needs to know which question it is reading.
			function grp(label) { return '<tr class="grp"><td colspan="' + (ays.length + 1) + '">' + esc(label) + '</td></tr>'; }
			function rentBed(p) { return p.occ > 0 ? p.mrev / p.occ : null; }
			function lyRentBed(p) { return p.lyOcc > 0 ? p.lyMrev / p.lyOcc : null; }
			var table = '<div class="card"><div class="head"><div><h3>Side by side<em>same week, same markets</em></h3>' +
				'<p class="sec-note">Every academic year that has not started yet, measured at the same week ending and under the same market scope.</p></div></div>' +
				'<div class="ay-wrap"><table class="dense ay-tbl"><thead><tr><th class="l">Metric</th>' +
				ays.map(function (a) { return '<th class="v">' + esc(ayFull(a.name)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
				grp('Where the year stands') +
				row('Total beds', function (p) { return fInt(p.beds); }) +
				row('Pre-leased beds', function (p) { return fInt(p.occ); }) +
				row('Pre-lease %', function (p) { return fPct(p.occPct); }, 'hi') +
				row('vs ' + ly, function (p) { return dlt(p.vsLyPct, fPts); }) +
				row('vs prior week', function (p) { return dlt(p.dOccPct, fPts); }) +
				row('Beds still to lease', function (p) { return fInt(p.beds - p.occ); }) +
				grp('Movement this week') +
				row('Beds leased this week', function (p) { return fInt(p.newBeds); }) +
				row('Leases sent this week', function (p) { return fInt(p.sent); }) +
				row('Executed this week', function (p) { return fInt(p.executed); }) +
				row('In process at week end', function (p) { return fInt(p.inProcess) + (p.over21 ? ' <span class="muted small">(' + fInt(p.over21) + ' over 21d)</span>' : ''); }) +
				row('Made inactive this week', function (p) { return fInt(p.inactivated); }) +
				grp('Cumulative to date') +
				row('Leases to date', function (p) { return fInt(p.leases) + (p.lyLeases != null ? ' <span class="muted small">' + esc(ly) + ' ' + fInt(p.lyLeases) + '</span>' : ''); }) +
				row('Rent / bed', function (p) {
					var r = rentBed(p), l = lyRentBed(p);
					return fMoney2(r) + (r != null && l != null ? ' <span class="muted small">' + (r - l >= 0 ? '+' : '\u2212') + '$' + Math.abs(Math.round(r - l)) + ' vs ' + esc(ly) + '</span>' : '');
				}) +
				row('Revenue leased', function (p) { return fMoney(p.trev); }) +
				row('vs ' + ly + ' revenue', function (p) { return p.lyTrev > 0 ? dlt(p.trev / p.lyTrev - 1, fGrowth) : '<span class="muted">\u2013</span>'; }) +
				'</tbody></table></div></div>';
			return '<div class="wk-cmp">' + cells + '</div>' + table;
		}
		function renderSlide(i) {
			var sl = deck[i];
			if (!sl) return '';
            if (sl.kind === 'pre') return preSlide();
			var d = deckData[sl.ay];
			if (!d) return '<div class="card empty"><strong>' + esc(sl.name) + ' could not be loaded</strong></div>';
			// The activity slide carries week-over-week history under the four sections.
			if (sl.kind === 'group') return (d.group || '') + (d.history || '');
			return d[sl.kind] || '';
		}
		function showSlide(i) {
			if (!deck.length) return;
			deckAt = Math.max(0, Math.min(deck.length - 1, i));
			var sl = deck[deckAt];
			deckEl().innerHTML = '<div class="deck-slide on">' + deckHead(sl) + renderSlide(deckAt) + '</div>';
			if (sl.kind === 'pace') {
				var d = deckData[sl.ay];
				drawVelocity(deckEl().querySelector('[data-vel]'), d ? d.chart : null);
			}
			var bar = $('lkr-slide-bar');
			if (bar) {
				bar.querySelector('[data-slide-pos]').textContent = (deckAt + 1) + ' / ' + deck.length;
				bar.querySelector('[data-slide-title]').textContent = sl.title;
				bar.querySelector('[data-slide-mk]').textContent = sl.name || '';
			}
			window.scrollTo(0, 0);
		}
		function present(on) {
			root.classList.toggle('present', on);
			try {
				if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(function () { /* not allowed */ });
				if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ignore */ });
			} catch (err) { /* fullscreen unavailable */ }
			if (!on) { drawVelocity(); return; }
			deck = buildDeck();
			if (deckReady) { showSlide(0); return; }
			var ays = fwdAys();
			if (!ays.length) { deckSay('No future academic years to present. Add an Academic Year that starts after today, with leases against it.'); return; }
			deckSay('Preparing ' + ays.length + ' academic year' + (ays.length === 1 ? '' : 's') + '…');
			Promise.all(ays.map(function (a) {
				return fetch(deckUrl(a.id), { credentials: 'same-origin' })
					.then(function (r) { return r.json(); })
					.then(function (j) { if (j && j.ok) deckData[a.id] = j; })
					.catch(function () { /* slide shows its own message */ });
			})).then(function () { deckReady = true; showSlide(0); });
		}
		if ($('lkr-present')) $('lkr-present').onclick = function () { present(true); };
		root.addEventListener('click', function (e) {
			var b = e.target.closest ? e.target.closest('[data-slide]') : null;
			if (!b) return;
			var v = b.getAttribute('data-slide');
			if (v === 'exit') { present(false); return; }
			showSlide(deckAt + (v === 'next' ? 1 : -1));
		});
		document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && root.classList.contains('present')) present(false); });
		document.addEventListener('keydown', function (e) {
			if (!root.classList.contains('present')) return;
			if (e.key === 'Escape') { present(false); return; }
			if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) return;
			// Let a disclosure take its own Enter and Space.
			if (e.target && e.target.tagName === 'SUMMARY') return;
			if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); showSlide(deckAt + 1); }
			if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); showSlide(deckAt - 1); }
		});

		function drawVelocity(box, C) {
			box = box || root.querySelector('.wk > .wk-sec[data-sec="pace"] [data-vel]');
			C = C || D.pace;
			if (!box || !C || !C.pts || !C.pts.length) return;
			// x = week index; this AY to the selected week, LY on the same calendar (through 4 weeks after AY start).
			var weeks = C.pts.map(function (p) { return p[0]; }).concat((C.ahead || []).map(function (a) { return a[0]; }));
			var cur = C.pts.map(function (p, i) { return { i: i, v: p[1] }; });
			var ly = C.ly ? C.pts.map(function (p, i) { return { i: i, v: p[2] }; }).concat((C.ahead || []).map(function (a, k) { return { i: C.pts.length + k, v: a[1] }; })) : [];
			var selI = C.pts.length - 1, n = weeks.length;
			var ymax = 0;
			cur.concat(ly).forEach(function (p) { if (p.v > ymax) ymax = p.v; });
			var tick = ymax > 0.5 ? 0.2 : 0.1;
			ymax = Math.min(1, Math.max(tick, Math.ceil(ymax / tick - 1e-9) * tick));
			var big = root.classList.contains('present');
			var W = 960, H = big ? 330 : 270, L = 46, R = 64, T = 14, B = 32;
			var xs = function (i) { return L + i / Math.max(1, n - 1) * (W - L - R); };
			var ys = function (v) { return T + (1 - v / ymax) * (H - T - B); };
			var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
			function lab(s, yr) { var p = s.split('-'); return MON[Number(p[1]) - 1] + ' ' + Number(p[2]) + (yr ? ', ' + p[0] : ''); }
			var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Leasing pace chart">';
			for (var g = 0; g <= Math.round(ymax / tick); g++) {
				var v = tick * g, y = ys(v);
				s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#eef0f3"/><text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#667085">' + Math.round(v * 100) + '%</text>';
			}
			var step = Math.max(1, Math.ceil(n / 12));
			for (var x = 0; x < n; x += step) s += '<text x="' + xs(x) + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="11" fill="#667085">' + lab(weeks[x]) + '</text>';
			if (C.ayStart) {
				var ai = -1;
				for (var k = 0; k < n; k++) if (weeks[k] <= C.ayStart) ai = k;
				if (ai >= 0 && ai < n - 1) s += '<line x1="' + xs(ai) + '" x2="' + xs(ai) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#98a2b3" stroke-dasharray="4 4"/><text x="' + (xs(ai) - 4) + '" y="' + (T + 10) + '" text-anchor="end" font-size="11" fill="#667085">AY start</text>';
			}
			s += '<line x1="' + xs(selI) + '" x2="' + xs(selI) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#1f5fb4" stroke-opacity=".2" stroke-width="6"/>';
			function line(pts, color, main, name) {
				pts = pts.filter(function (p) { return p.v != null; });
				if (!pts.length) return '';
				var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + xs(p.i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
				var h = '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (main ? 3 : 1.8) + '"' + (main ? '' : ' stroke-dasharray="6 4"') + '/>';
				pts.forEach(function (p) {
					h += '<circle cx="' + xs(p.i).toFixed(1) + '" cy="' + ys(p.v).toFixed(1) + '" r="' + (main ? 3 : 2) + '" fill="' + color + '"><title>' + esc(name) + ' · week of ' + lab(weeks[p.i], true) + ': ' + fPct(p.v) + '</title></circle>';
				});
				var at = pts.filter(function (p) { return p.i === selI; })[0];
				if (at) labels.push({ x: xs(at.i) + 8, y: ys(at.v) + 4, t: fPct(at.v), c: color, b: main });
				return h;
			}
			var labels = [];
			s += line(ly, '#c2410c', false, (C.ly || 'LY') + ' (same week)') + line(cur, '#1f5fb4', true, C.cur || 'This AY');
			// Keep the two value labels at the selected week from overlapping.
			if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 16) {
				var hi = labels[0].y <= labels[1].y ? labels[0] : labels[1], lo = hi === labels[0] ? labels[1] : labels[0];
				var mid = (hi.y + lo.y) / 2; hi.y = mid - 8; lo.y = mid + 8;
			}
			labels.forEach(function (l) { s += '<text x="' + l.x.toFixed(1) + '" y="' + l.y.toFixed(1) + '" font-size="12" font-weight="' + (l.b ? 700 : 400) + '" fill="' + l.c + '">' + l.t + '</text>'; });
			s += '</svg>';
			var legend = '<div class="legend"><span><i style="background:#1f5fb4"></i>' + esc(C.cur || 'This AY') + '</span>' + (C.ly ? '<span><i style="background:#c2410c"></i>' + esc(C.ly) + ', same week of the cycle</span>' : '') +
				'<span class="muted">shaded = selected week</span></div>';
			box.innerHTML = s + legend;
		}

		showTab(currentTab());
	})();
	</script>`;

	const vacancyCounts = (tree) => {
		const out = { fullUnits: 0, fullBeds: 0, partUnits: 0, partBeds: 0 };
		const walk = (n) => {
			const unitLevel = n.lv === 3 || (n.lv === 2 && !n.c);
			if (unitLevel) {
				const b = n.b || 0;
				const o = n.o || 0;
				if (b > 0 && o === 0) { out.fullUnits++; out.fullBeds += b; } else if (b > o) { out.partUnits++; out.partBeds += b - o; }
				return;
			}
			(n.c || []).forEach(walk);
		};
		tree.forEach(walk);
		return out;
	};

	// Market lock (deployment parameter). Returns the allowed market keys, or null for the whole company.
	const marketLock = (script) => {
		let raw = '';
		try { raw = String(script.getParameter({ name: MARKET_PARAM }) || ''); } catch (e) { raw = ''; }
		const keys = raw.split(/[,;\n]/).map(keyify).filter(Boolean);
		return keys.length ? new Set(keys) : null;
	};

	// Viewer lock. null = not narrowed (box off, or the employee's field is blank). A Set of market keys = narrowed to
	// those. An EMPTY Set = deny everything, used when the box is on but the viewer's markets cannot be established.
	const viewerLock = (script) => {
		let on = false;
		try {
			const flag = script.getParameter({ name: VIEWER_LOCK_PARAM });
			on = flag === true || String(flag) === 'T' || String(flag) === 'true';
		} catch (e) { on = false; }
		if (!on) return null;
		const user = runtime.getCurrentUser() || {};
		const userId = Number(user.id);
		if (!userId || userId < 1) {
			log.error('Viewer market lock', 'No employee id on the current user; showing nothing.');
			return new Set();
		}
		let raw = null;
		try {
			const looked = search.lookupFields({ type: search.Type.EMPLOYEE, id: userId, columns: [VIEWER_MARKETS_FIELD] });
			if (!looked || !(VIEWER_MARKETS_FIELD in looked)) throw new Error('field ' + VIEWER_MARKETS_FIELD + ' not on the employee record');
			raw = looked[VIEWER_MARKETS_FIELD];
		} catch (e) {
			log.error('Viewer market lock', `Could not read ${VIEWER_MARKETS_FIELD} for employee ${userId}: ${e.message || e}; showing nothing.`);
			return new Set();
		}
		// A Multiple Select returns [{ value, text }] - match on text, which is the list item name and therefore the
		// market spelling. A Free-Form Text field returns a comma-separated string; both shapes are accepted.
		const names = Array.isArray(raw)
			? raw.map((o) => (o && typeof o === 'object' ? (o.text !== undefined && o.text !== null && o.text !== '' ? o.text : o.value) : o))
			: String(raw === null || raw === undefined ? '' : raw).split(/[,;\n]/);
		const keys = names.map(keyify).filter(Boolean);
		// A blank field denies: a new employee sees nothing until someone assigns their markets. Failing closed is the
		// point of the lock, and "blank means the whole portfolio" is the opposite of that.
		if (!keys.length) log.audit('Viewer market lock', `Employee ${userId} has no markets assigned; showing nothing.`);
		return new Set(keys);
	};

	// The academic year being leased: the first AY that starts after today (else the latest one that has started).
	const leasingAy = (years, day) => {
		// The year in occupancy today is the default. Fall back to the next one to start, then the last that started.
		const current = years.find((a) => a.start_date && a.end_date && a.start_date <= day && a.end_date >= day);
		if (current) return String(current.id);
		const next = years.find((a) => a.start_date && a.start_date > day);
		if (next) return String(next.id);
		const started = years.filter((a) => a.start_date && a.start_date <= day);
		return started.length ? String(started[started.length - 1].id) : (years.length ? String(years[0].id) : '');
	};


	// ---- Writes ----
	// The market lock is recomputed here from the deployment parameter and the signed-in employee. Whatever
	// market the browser believes a row is in is ignored: a hand-crafted POST must not be able to reach
	// another market's unit. The only records this Suitelet writes are the unit status row, its notes and
	// its stage log.
	const jsonOut = (context, obj) => {
		context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
		context.response.write(JSON.stringify(obj));
	};

	const resolveLock = (script) => {
		const deployLock = marketLock(script);
		const userLock = viewerLock(script);
		return deployLock && userLock
			? new Set([...deployLock].filter((k) => userLock.has(k)))
			: (deployLock || userLock);
	};

	// One pass authorises and reads current state: the unit's market and property, and the status row as
	// it stands right now, so a stage the lease owns cannot be overwritten from a stale browser.
	// One row per bedroom, with the lease already sitting on it for this year if there is one.
	// A scalar subquery rather than a join: two leases on one bedroom would duplicate rows and
	// trip runQuery's paging check.
	// A lease longer than one academic year covers two. The record stays single - it is one
	// signed document, and every reconciliation we have depends on that - so it is instead
	// presented to each year it runs in, carrying that year's months and revenue.
	//
	// The TERM decides, not the end date against the academic-year window: a perfectly ordinary
	// 12-month Savannah or Charleston lease runs August to July and overruns a June-May window
	// by two months without being a two-year lease at all. Testing an overlap rule against live
	// data turned 79 such leases into phantom second years, so the rule is term length.
	//
	// The year is anchored on the lease START DATE, not on its Academic Year field, because the
	// tagging is inconsistent - some two-year leases are tagged to their first year and some to
	// their second. The dates are unambiguous, so this also makes the tagging self-correcting.
	const SPAN_MIN_MONTHS = 15;
	const monthsBetween = (from, to) => {
		const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from || ''));
		const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to || ''));
		if (!a || !b) return null;
		let m = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
		if (Number(b[3]) > Number(a[3])) m += 1;
		return m;
	};
	const dayMs = (d) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
		return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
	};
	const plusMonths = (d, n) => {
		const p = String(d).split('-');
		if (p.length !== 3) return d;
		const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
		dt.setUTCMonth(dt.getUTCMonth() + n);
		return dt.toISOString().slice(0, 10);
	};
	// Every lease running in the academic year `ay`, each carrying that year's share. `carry`
	// marks a year the lease runs into rather than its first: the signing happened once, in the
	// first year, so carried instances stay out of the weekly sections and the quality lists.
	const leasesForYear = (all, ay, years) => {
		const order = years.map((y) => String(y.id));
		const idx = order.indexOf(String(ay));
		const starts = years.map((y) => dayMs(y.start_date));
		const anchorOf = (startDate) => {
			const sd = dayMs(startDate);
			if (sd === null) return -1;
			let best = -1;
			starts.forEach((ys, i) => { if (ys !== null && ys <= sd) best = i; });
			return best;
		};
		const out = [];
		all.forEach((l) => {
			const term = monthsBetween(l.start_date, l.end_date);
			if (term === null || term < SPAN_MIN_MONTHS) {
				if (String(l.ay) === String(ay)) out.push(l);
				return;
			}
			const anchor = anchorOf(l.start_date);
			if (anchor < 0 || idx < 0) { if (String(l.ay) === String(ay)) out.push(l); return; }
			const offset = idx - anchor;
			if (offset < 0 || offset >= Math.ceil(term / 12)) return;
			const inYear = Math.min(12, term - offset * 12);
			if (inYear <= 0) return;
			const from = plusMonths(l.start_date, offset * 12);
			const monthly = Number(l.monthly_rent) || 0;
			out.push(Object.assign({}, l, {
				months: inYear,
				total_rent: monthly * inYear,
				span: Math.ceil(term / 12),
				spanYear: offset + 1,
				carry: offset > 0 ? 1 : 0,
				spanFrom: from,
				spanTo: plusMonths(from, inYear)
			}));
		});
		return out;
	};

	const recordUrl = (kind, id) => {
		try { return RECORD_TYPES[kind] && id ? url.resolveRecord({ recordType: RECORD_TYPES[kind], recordId: id }) : null; }
		catch (e) { return null; }
	};

	const bedroomsOf = (ay, unitId) => runQuery(`
		SELECT b.id AS id, b.name AS name, b.custrecord_serp_number_of_beds AS beds,
			(SELECT MIN(l.id) FROM ${LEASE.record} l
				WHERE l.${LEASE.unit} = b.id AND l.isinactive = 'F'
					AND l.${LEASE.ay} = ?) AS lease_id
		FROM customrecord_serp_units_bedrooms b
		WHERE b.isinactive = 'F' AND b.parent = ?
		ORDER BY b.name`, [ay, unitId]);

	const propertyUnits = (ay, propertyId) => runQuery(`
		SELECT u.id AS id, u.name AS name, u.custrecord_serp_number_of_beds AS beds,
			s.id AS status_id, s.${UAS.lease} AS lease_id,
			(SELECT COUNT(*) FROM customrecord_serp_units_bedrooms b
				JOIN ${LEASE.record} bl ON bl.${LEASE.unit} = b.id
				WHERE b.parent = u.id AND b.isinactive = 'F' AND bl.isinactive = 'F'
					AND bl.${LEASE.ay} = ?) AS bedroom_leases
		FROM customrecord_serp_units_bedrooms u
		LEFT JOIN ${UAS.record} s ON s.${UAS.unit} = u.id AND s.${UAS.ay} = ? AND s.isinactive = 'F'
		WHERE u.isinactive = 'F' AND u.parent IS NULL
			AND u.custrecord_serp_parent_property = ?
		ORDER BY u.name`, [ay, ay, propertyId]);

	const authUnits = (ay, ids) => {
		const auth = {};
		if (!ids.length) return auth;
		runQuery(`
			SELECT u.id AS id, u.name AS unit_name, u.custrecord_serp_number_of_beds AS beds,
				p.id AS property_id, p.name AS property_name, p.parent AS property_parent,
				p.custrecord_serp_prop_city AS city,
				s.id AS status_id, s.${UAS.stage} AS stage_id, s.${UAS.source} AS source_id,
				s.${UAS.lease} AS lease_id, l.name AS lease_name
			FROM customrecord_serp_units_bedrooms u
			JOIN customrecord_serp_property_record p ON p.id = u.custrecord_serp_parent_property
			LEFT JOIN ${UAS.record} s ON s.${UAS.unit} = u.id AND s.${UAS.ay} = ? AND s.isinactive = 'F'
			LEFT JOIN ${LEASE.record} l ON l.id = s.${UAS.lease}
			WHERE u.isinactive = 'F' AND u.parent IS NULL AND p.isinactive = 'F'
				AND u.id IN (${ids.join(',')})`, [ay]).forEach((r) => { auth[String(r.id)] = r; });
		return auth;
	};

	const ayNameOf = (ay) => {
		try {
			const yr = runQuery(`SELECT id, name FROM customrecord_serp_academic_yr_list WHERE id = ?`, [ay]);
			return yr.length ? String(yr[0].name) : `AY ${ay}`;
		} catch (e) { return `AY ${ay}`; }
	};

	// A stage change is the only thing worth a history row. stage_date holds just the latest one, so
	// without this there is no way to measure time in stage or conversion between stages later, and none
	// of it can be reconstructed. Never allowed to fail a save.
	const writeStageLog = (statusId, fromStage, toStage, source, unitName, ayName) => {
		try {
			const rec = record.create({ type: LOG.record });
			rec.setValue({ fieldId: 'name', value: `${unitName} — ${ayName} — ${todayStr().day}`.slice(0, 300) });
			rec.setValue({ fieldId: LOG.status, value: Number(statusId) });
			if (fromStage) rec.setValue({ fieldId: LOG.from, value: Number(fromStage) });
			if (toStage) rec.setValue({ fieldId: LOG.to, value: Number(toStage) });
			rec.setValue({ fieldId: LOG.date, value: toDateValue(todayStr().day) });
			rec.setValue({ fieldId: LOG.source, value: Number(source) });
			// Changed By was not in the account when this shipped; its absence costs a log line, not a save.
			try { rec.setValue({ fieldId: LOG.user, value: Number((runtime.getCurrentUser() || {}).id) }); }
			catch (e) { /* field not present */ }
			rec.save({ ignoreMandatoryFields: true });
		} catch (e) {
			log.error('Stage log not written', `Status ${statusId}: ${e.message || e}`);
		}
	};

	const doStageSave = (context, payload) => {
		const script = runtime.getCurrentScript();
		const ay = String(payload.ay);
		const rows = payload.rows.slice(0, 100);
		const lock = resolveLock(script);
		if (lock && lock.size === 0) {
			log.error('Pipeline save denied', `Employee ${(runtime.getCurrentUser() || {}).id} has an empty market lock; refused ${rows.length} row(s).`);
			jsonOut(context, { ok: false, results: [], message: 'No markets are assigned to your user, so nothing can be saved.' });
			return;
		}
		const ids = [...new Set(rows.map((r) => String(r.unitId === null || r.unitId === undefined ? '' : r.unitId)).filter((v) => /^\d+$/.test(v)))];
		if (!ids.length) { jsonOut(context, { ok: false, results: [], message: 'No valid unit ids in the request.' }); return; }

		let auth;
		try { auth = authUnits(ay, ids); }
		catch (e) {
			log.error('Pipeline save lookup failed', e);
			jsonOut(context, { ok: false, results: [], message: `Could not read the units being saved: ${e.message || e}` });
			return;
		}
		const ayName = ayNameOf(ay);
		const today = toDateValue(todayStr().day);
		const results = [];
		let stopped = false;

		for (let i = 0; i < rows.length; i += 1) {
			const r = rows[i];
			const unitId = String(r.unitId === null || r.unitId === undefined ? '' : r.unitId);
			const a = auth[unitId];
			const reject = (message) => results.push({ unit: unitId, id: null, action: 'rejected', message });

			if (!a) { reject('Not a leasable unit, or it is inactive'); continue; }
			const city = keyify(a.city);
			if (!city) { reject('Its property has no City, so no market can be checked'); continue; }
			if (lock && !lock.has(city)) {
				log.error('Pipeline save blocked by market lock',
					`Employee ${(runtime.getCurrentUser() || {}).id} tried to write unit ${unitId} (${a.unit_name}, ${a.city}); allowed markets: ${[...lock].join('/')}`);
				reject(`${a.city} is outside your markets`);
				continue;
			}
			if (NON_STUDENT_PROPS.has(String(a.property_id)) || NON_STUDENT_PROPS.has(String(a.property_parent || ''))) {
				reject('Not a student rental, so it is not on this board');
				continue;
			}

			const setsStage = Object.prototype.hasOwnProperty.call(r, 'manualStage');
			const manual = r.manualStage === null || r.manualStage === undefined ? '' : String(r.manualStage);
			if (setsStage && manual && STAGE_EDITABLE.indexOf(manual) < 0) {
				reject(`${STAGE_LABEL[manual] || `Stage ${manual}`} is set by the lease, not from this board`);
				continue;
			}
			if (setsStage && String(a.source_id || '') === SOURCE_LEASE) {
				reject(`Stage is currently driven by the lease (${STAGE_LABEL[String(a.stage_id || '')] || 'lease-owned'}); reload the tab`);
				continue;
			}

			const values = {};
			const fromStage = String(a.stage_id || '');
			if (setsStage) {
				// Source is Manual on this path, so the effective stage follows the manual one. The lease
				// User Event owns the other direction and overwrites both on the next lease event.
				values[UAS.manualStage] = manual;
				values[UAS.stage] = manual;
				values[UAS.source] = SOURCE_MANUAL;
				values[UAS.stageDate] = manual ? today : '';
			}
			if (Object.prototype.hasOwnProperty.call(r, 'followup')) values[UAS.followup] = toDateValue(r.followup) || '';
			if (Object.prototype.hasOwnProperty.call(r, 'lastOffer')) {
				const n = r.lastOffer === '' || r.lastOffer === null || r.lastOffer === undefined ? '' : Number(r.lastOffer);
				if (n !== '' && !Number.isFinite(n)) { reject('Offered rent is not a number'); continue; }
				values[UAS.lastOffer] = n;
			}
			if (Object.prototype.hasOwnProperty.call(r, 'expected')) {
				values[UAS.expected] = String(r.expected === null || r.expected === undefined ? '' : r.expected).slice(0, 300);
			}
			if (Object.prototype.hasOwnProperty.call(r, 'terms')) {
				values[UAS.terms] = String(r.terms === null || r.terms === undefined ? '' : r.terms).slice(0, TERMS_MAX);
			}
			if (!Object.keys(values).length) { results.push({ unit: unitId, id: a.status_id ? String(a.status_id) : null, action: 'skipped', message: 'Nothing changed' }); continue; }

			// submitFields costs 2 governance units on a custom record, save 4, against a 1,000 budget.
			// Stop before the floor rather than dying mid-chunk and leaving the browser unsure what landed.
			if (script.getRemainingUsage() < 80) {
				results.push({ unit: unitId, id: null, action: 'error', message: 'Governance budget reached; the rest are still marked unsaved' });
				stopped = true;
				break;
			}

			try {
				let statusId = a.status_id;
				if (statusId) {
					try {
						record.submitFields({ type: UAS.record, id: statusId, values, options: { enableSourcing: false, ignoreMandatoryFields: true } });
					} catch (we) {
						// Same missing-field bargain as the read path: drop the terms and save the rest.
						if (!Object.prototype.hasOwnProperty.call(values, UAS.terms)) throw we;
						log.error('Lease terms not written', `${UAS.terms} is not on ${UAS.record}; saved unit ${unitId} without it. ${we.message || we}`);
						delete values[UAS.terms];
						if (!Object.keys(values).length) {
							results.push({ unit: unitId, id: String(statusId), action: 'skipped', message: 'Lease terms field has not been created yet' });
							continue;
						}
						record.submitFields({ type: UAS.record, id: statusId, values, options: { enableSourcing: false, ignoreMandatoryFields: true } });
					}
					results.push({ unit: unitId, id: String(statusId), action: 'updated', message: '' });
				} else {
					// Every unit should already have a row from AD_MR_Unit_AY_Status_Sync, so this path
					// means provisioning missed one. Create it, but log it loudly.
					const rec = record.create({ type: UAS.record });
					// Auto-numbering does not populate Name on a scripted create - only the UI form does.
					rec.setValue({ fieldId: 'name', value: `${a.unit_name} — ${ayName}` });
					rec.setValue({ fieldId: UAS.unit, value: Number(unitId) });
					rec.setValue({ fieldId: UAS.ay, value: Number(ay) });
					if (a.property_id) rec.setValue({ fieldId: UAS.property, value: Number(a.property_id) });
					if (!Object.prototype.hasOwnProperty.call(values, UAS.source)) rec.setValue({ fieldId: UAS.source, value: SOURCE_MANUAL });
					Object.keys(values).forEach((f) => rec.setValue({ fieldId: f, value: values[f] }));
					statusId = rec.save({ ignoreMandatoryFields: true });
					log.error('Pipeline provisioning gap',
						`Unit ${unitId} (${a.unit_name}) had no ${UAS.record} row for AY ${ay}; created ${statusId}. AD_MR_Unit_AY_Status_Sync missed it.`);
					results.push({ unit: unitId, id: String(statusId), action: 'created', message: 'Status record was missing and has been created' });
				}
				if (setsStage && fromStage !== manual) {
					writeStageLog(statusId, fromStage, manual, SOURCE_MANUAL, a.unit_name, ayName);
				}
			} catch (e) {
				log.error('Pipeline save failed', `Unit ${unitId}: ${e.name || ''} ${e.message || e}`);
				results.push({ unit: unitId, id: a.status_id ? String(a.status_id) : null, action: 'error', message: String(e.message || e) });
				stopped = true;
				break;
			}
		}

		const bad = results.filter((x) => x.action === 'error' || x.action === 'rejected');
		log.audit('Pipeline save', `AY ${ay}, employee ${(runtime.getCurrentUser() || {}).id}, lock ${lock ? [...lock].join('/') : 'none'}, ` +
			`sent ${rows.length}, written ${results.filter((x) => x.action === 'updated' || x.action === 'created').length}, ` +
			`rejected ${results.filter((x) => x.action === 'rejected').length}, errors ${results.filter((x) => x.action === 'error').length}, ` +
			`remaining usage ${script.getRemainingUsage()}`);
		jsonOut(context, {
			ok: !bad.length && !stopped,
			stopped,
			results,
			message: bad.length ? `${bad.length} row${bad.length === 1 ? '' : 's'} were not saved.` : ''
		});
	};

	const doNoteAdd = (context, payload) => {
		const script = runtime.getCurrentScript();
		const ay = String(payload.ay);
		const unitId = String(payload.unitId === null || payload.unitId === undefined ? '' : payload.unitId);
		const text = String(payload.text === null || payload.text === undefined ? '' : payload.text).trim().slice(0, NOTE_MAX);
		if (!/^\d+$/.test(unitId) || !text) { jsonOut(context, { ok: false, message: 'A note needs a unit and some text.' }); return; }

		const lock = resolveLock(script);
		if (lock && lock.size === 0) { jsonOut(context, { ok: false, message: 'No markets are assigned to your user.' }); return; }

		let a;
		try { a = authUnits(ay, [unitId])[unitId]; }
		catch (e) { jsonOut(context, { ok: false, message: `Could not read that unit: ${e.message || e}` }); return; }
		if (!a) { jsonOut(context, { ok: false, message: 'Not a leasable unit, or it is inactive.' }); return; }
		const city = keyify(a.city);
		if (lock && (!city || !lock.has(city))) {
			log.error('Pipeline note blocked by market lock',
				`Employee ${(runtime.getCurrentUser() || {}).id} tried to note unit ${unitId} (${a.city}); allowed: ${[...lock].join('/')}`);
			jsonOut(context, { ok: false, message: `${a.city || 'That property'} is outside your markets.` });
			return;
		}

		const ayName = ayNameOf(ay);
		try {
			let statusId = a.status_id;
			if (!statusId) {
				const srec = record.create({ type: UAS.record });
				srec.setValue({ fieldId: 'name', value: `${a.unit_name} — ${ayName}` });
				srec.setValue({ fieldId: UAS.unit, value: Number(unitId) });
				srec.setValue({ fieldId: UAS.ay, value: Number(ay) });
				if (a.property_id) srec.setValue({ fieldId: UAS.property, value: Number(a.property_id) });
				srec.setValue({ fieldId: UAS.source, value: SOURCE_MANUAL });
				statusId = srec.save({ ignoreMandatoryFields: true });
				log.error('Pipeline provisioning gap', `Unit ${unitId} had no status row for AY ${ay}; created ${statusId} while adding a note.`);
			}
			const me = runtime.getCurrentUser() || {};
			const mentions = (Array.isArray(payload.mentions) ? payload.mentions : [])
				.map((m) => String(m)).filter((m) => /^\d+$/.test(m)).slice(0, 25);
			const nrec = record.create({ type: NOTE.record });
			nrec.setValue({ fieldId: 'name', value: `${a.unit_name} — ${ayName} — ${todayStr().day}`.slice(0, 300) });
			nrec.setValue({ fieldId: NOTE.status, value: Number(statusId) });
			nrec.setValue({ fieldId: NOTE.date, value: toDateValue(todayStr().day) });
			if (me.id) nrec.setValue({ fieldId: NOTE.author, value: Number(me.id) });
			nrec.setValue({ fieldId: NOTE.text, value: text });
			if (mentions.length) nrec.setValue({ fieldId: NOTE.mentions, value: mentions.map((m) => Number(m)) });
			const noteId = nrec.save({ ignoreMandatoryFields: true });
			log.audit('Pipeline note', `Unit ${unitId}, status ${statusId}, note ${noteId}, mentions ${mentions.join('/') || 'none'}, employee ${me.id}`);
			jsonOut(context, { ok: true, noteId: String(noteId), statusId: String(statusId), author: String(me.name || 'You') });
		} catch (e) {
			log.error('Pipeline note failed', `Unit ${unitId}: ${e.name || ''} ${e.message || e}`);
			jsonOut(context, { ok: false, message: String(e.message || e) });
		}
	};

	// Turning captured terms into a real lease. The lease is written with NO status, which keeps it out
	// of every leasing statistic (engine.hasStatus) until someone sets In Process or Fully Executed, so
	// this click records the deal without touching pre-leasing.
	// Stage is NOT set here: AD_UE_Lease_Stage_Sync owns stages 4 and 5 and fires on the lease save.
	const doLeaseCreate = (context, payload) => {
		const script = runtime.getCurrentScript();
		const ay = String(payload.ay);
		const unitId = String(payload.unitId === null || payload.unitId === undefined ? '' : payload.unitId);
		if (!/^\d+$/.test(unitId)) { jsonOut(context, { ok: false, message: 'A lease needs a unit.' }); return; }

		const lock = resolveLock(script);
		if (lock && lock.size === 0) { jsonOut(context, { ok: false, message: 'No markets are assigned to your user.' }); return; }

		let a;
		try { a = authUnits(ay, [unitId])[unitId]; }
		catch (e) { jsonOut(context, { ok: false, message: `Could not read that unit: ${e.message || e}` }); return; }
		if (!a) { jsonOut(context, { ok: false, message: 'Not a leasable unit, or it is inactive.' }); return; }
		const city = keyify(a.city);
		if (lock && (!city || !lock.has(city))) {
			log.error('Lease create blocked by market lock',
				`Employee ${(runtime.getCurrentUser() || {}).id} tried to create a lease on unit ${unitId} (${a.city}); allowed: ${[...lock].join('/')}`);
			jsonOut(context, { ok: false, message: `${a.city || 'That property'} is outside your markets.` });
			return;
		}
		if (NON_STUDENT_PROPS.has(String(a.property_id)) || NON_STUDENT_PROPS.has(String(a.property_parent || ''))) {
			jsonOut(context, { ok: false, message: 'Not a student rental, so it is not on this board.' });
			return;
		}
		let t = null;
		try { t = JSON.parse(String(payload.terms || '{}')); } catch (e) { t = null; }
		if (!t || typeof t !== 'object') { jsonOut(context, { ok: false, message: 'The lease terms could not be read.' }); return; }

		const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
		const perBed = n(t.perBed);
		if (perBed === null || perBed <= 0) { jsonOut(context, { ok: false, message: 'Enter a rent per bed before creating the lease.' }); return; }
		// Term follows the dates and rounds up: 1 June to 23 May is eleven and a bit months of
		// occupancy but twelve months of service, which is how these are priced.
		const monthsFromDates = (() => {
			const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.start || ''));
			const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.end || ''));
			if (!a || !b) return null;
			let m = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
			if (Number(b[3]) > Number(a[3])) m += 1;
			return m > 0 ? m : null;
		})();
		const months = monthsFromDates || n(t.months) || 12;
		const leaseType = String(t.type || '');
		const isBedroom = leaseType === LEASE_TYPE_BEDROOM;
		const isWholeHouse = leaseType === LEASE_TYPE_WHOLE_HOUSE;

		// Scope decides what gets linked and what the rent is for. A Whole House or Unit lease
		// hangs off the unit and covers every bed in it; a Bedroom lease hangs off one bedroom
		// child record and covers exactly one bed, so a part-let house is several lease records.
		let beds;
		try { beds = bedroomsOf(ay, unitId); }
		catch (e) {
			log.error('Lease create bedroom lookup failed', `Unit ${unitId}: ${e.message || e}`);
			jsonOut(context, { ok: false, message: `Could not read the bedrooms on that unit: ${e.message || e}` });
			return;
		}
		const bedById = {};
		beds.forEach((b) => { bedById[String(b.id)] = b; });
		const taken = beds.filter((b) => b.lease_id);

		// A Whole House lease covers every unit at the property. The engine reads that from the
		// ABSENCE of a unit link (placeLeases: no linkedId -> scope P, all property leaves); linking
		// a unit silently narrows it to that one unit, which is how 29 existing whole-house leases
		// ended up scoped to a single unit of a multi-unit property.
		let siblings = null;
		if (isWholeHouse) {
			try { siblings = propertyUnits(ay, a.property_id); }
			catch (e) {
				log.error('Lease create property lookup failed', `Property ${a.property_id}: ${e.message || e}`);
				jsonOut(context, { ok: false, message: `Could not read the units at that property: ${e.message || e}` });
				return;
			}
			if (!siblings.length) { jsonOut(context, { ok: false, message: 'That property has no active units, so a whole-house lease has nothing to cover.' }); return; }
			const busy = siblings.filter((u) => u.lease_id || Number(u.bedroom_leases) > 0);
			if (busy.length) {
				jsonOut(context, {
					ok: false,
					message: `A whole-house lease covers all ${siblings.length} units at ${a.property_name || 'this property'}, and ${busy.length} of them already ${busy.length === 1 ? 'has a lease' : 'have leases'} for this year (${busy.map((u) => u.name).slice(0, 6).join(', ')}${busy.length > 6 ? '\u2026' : ''}). Lease the free units individually instead.`
				});
				return;
			}
		}

		let targets;
		if (isBedroom) {
			const want = (Array.isArray(t.bedroomIds) ? t.bedroomIds : []).map((x) => String(x));
			if (!want.length) { jsonOut(context, { ok: false, message: 'Pick at least one bedroom for a bedroom lease.' }); return; }
			const unknown = want.filter((id) => !bedById[id]);
			if (unknown.length) { jsonOut(context, { ok: false, message: `${unknown.length} of the chosen bedrooms are not on this unit. Reload the tab.` }); return; }
			const clash = want.filter((id) => bedById[id].lease_id);
			if (clash.length) {
				jsonOut(context, { ok: false, message: `${clash.map((id) => bedById[id].name).join(', ')} already ${clash.length === 1 ? 'has a lease' : 'have leases'} for this year.` });
				return;
			}
			targets = want.map((id) => ({
				link: Number(id), name: bedById[id].name,
				beds: Number(bedById[id].beds) || 1, people: 1
			}));
		} else if (isWholeHouse) {
			const propBeds = siblings.reduce((sum, u) => sum + (Number(u.beds) || 0), 0);
			if (!propBeds) { jsonOut(context, { ok: false, message: 'No beds are recorded against that property, so the rent cannot be worked out.' }); return; }
			targets = [{
				link: null, property: true,
				name: a.property_name || a.unit_name,
				beds: propBeds, people: n(t.tenants)
			}];
		} else {
			// A unit lease over a part-let unit would double-count those beds.
			if (a.lease_id) {
				jsonOut(context, { ok: false, message: `Unit already has lease ${a.lease_name || a.lease_id} for this year. Open that lease to change its terms.` });
				return;
			}
			if (taken.length) {
				jsonOut(context, { ok: false, message: `${taken.length} bedroom${taken.length === 1 ? '' : 's'} on this unit already ${taken.length === 1 ? 'has a lease' : 'have leases'} for this year (${taken.map((b) => b.name).join(', ')}). Lease the remaining bedrooms individually instead.` });
				return;
			}
			const unitBeds = beds.length
				? beds.reduce((sum, b) => sum + (Number(b.beds) || 1), 0)
				: (Number(a.beds) || 1);
			targets = [{ link: Number(unitId), name: a.unit_name, beds: unitBeds, people: n(t.tenants) }];
		}

		const ayName = ayNameOf(ay);
		const today = toDateValue(todayStr().day);
		const made = [];
		try {
			targets.forEach((tg) => {
			const monthly = perBed * tg.beds;
			const rec = record.create({ type: LEASE.record });
			rec.setValue({ fieldId: 'name', value: `${tg.name} ${ayName}`.slice(0, 300) });
			// Left blank on purpose for a whole-house lease: that is what tells the engine to
			// scope it to the whole property rather than to one unit.
			if (tg.link !== null) rec.setValue({ fieldId: LEASE.unit, value: tg.link });
			if (a.property_id) rec.setValue({ fieldId: LEASE.property, value: Number(a.property_id) });
			rec.setValue({ fieldId: LEASE.ay, value: Number(ay) });
			// Deliberately no Lease Status. engine.hasStatus keeps a statusless lease out of every
			// leasing statistic, so the terms can live on the real record from the moment they are
			// agreed without the beds counting as pre-leased. Whoever sends the lease sets the status
			// to In Process with the Sent Date; signing it makes it Fully Executed. Until then it
			// shows on the Exceptions tab as "Lease Status is blank".
			if (t.type) rec.setValue({ fieldId: LEASE.type, value: Number(t.type) });
			if (t.group) rec.setValue({ fieldId: LEASE.group, value: Number(t.group) });
			rec.setValue({ fieldId: LEASE.months, value: Math.round(months) });
			rec.setValue({ fieldId: LEASE.monthly, value: monthly });
			rec.setValue({ fieldId: LEASE.total, value: monthly * months });
			// One tenant per bed. The dialog no longer asks, because the scope already says it.
			rec.setValue({ fieldId: LEASE.tenantCount, value: Math.round(tg.beds) });
			const sd = toDateValue(t.start), ed = toDateValue(t.end);
			if (sd) rec.setValue({ fieldId: LEASE.start, value: sd });
			if (ed) rec.setValue({ fieldId: LEASE.end, value: ed });
			// Utility caps, concessions, group leader and payment-on-first-day are still on the lease
			// record; they are entered there when they apply, not captured on this board.
			rec.setValue({ fieldId: LEASE.water, value: !!t.water });
			rec.setValue({ fieldId: LEASE.gas, value: !!t.gas });
			if (t.provisions) rec.setValue({ fieldId: LEASE.provisions, value: String(t.provisions).slice(0, 4000) });
			// The notes field is this build's addition; a missing one costs the notes, not the lease.
			if (t.notes) {
				try { rec.setValue({ fieldId: LEASE.notes, value: String(t.notes).slice(0, 4000) }); }
				catch (e) { log.error('Lease notes not written', `${LEASE.notes} is not on the lease record: ${e.message || e}`); }
			}
			made.push({ id: String(rec.save({ ignoreMandatoryFields: true })), name: `${tg.name} ${ayName}`, beds: tg.beds, monthly: monthly });
			});

			// Point the status rows at the lease and drop the shadow copy, so the lease is the only
			// place these terms live. A whole-house lease covers every unit at the property, so every
			// one of their rows is updated or the board would show the siblings as still available.
			// On a part-let unit the row can only hold one lease, so it takes the first. The User
			// Event may already have set some of this; writing the same value again is harmless.
			const backRows = isWholeHouse
				? siblings.map((u) => ({ id: u.status_id, unit: u.name, stage: null }))
				: [{ id: a.status_id, unit: a.unit_name, stage: String(a.stage_id || '') }];
			const noStatusRow = backRows.filter((row) => !row.id);
			if (noStatusRow.length) {
				log.error('Lease create: units without a status row',
					`Lease ${made[0].id} covers ${backRows.length} unit(s) at property ${a.property_id}; ` +
					`${noStatusRow.length} have no ${UAS.record} row for AY ${ay} (${noStatusRow.map((x) => x.unit).join(', ')}) and were not staged. ` +
					'AD_MR_Unit_AY_Status_Sync missed them.');
			}
			// Agreeing terms puts every unit the lease covers at Ready For Lease - Waiting on Forms.
			// Source is Manual: stages 4 and 5 stay the lease User Event's to set once the lease is
			// actually sent or signed, and it overwrites this when that happens.
			let linked = 0;
			backRows.filter((row) => row.id).forEach((row) => {
				if (script.getRemainingUsage() < 60) return;
				const back = {};
				back[UAS.lease] = Number(made[0].id);
				back[UAS.terms] = '';
				back[UAS.manualStage] = STAGE_READY;
				back[UAS.stage] = STAGE_READY;
				back[UAS.source] = SOURCE_MANUAL;
				back[UAS.stageDate] = today;
				try {
					record.submitFields({ type: UAS.record, id: row.id, values: back, options: { enableSourcing: false, ignoreMandatoryFields: true } });
					linked += 1;
				} catch (e) {
					// The terms field may not exist yet; the link and the stage are what matter.
					try {
						delete back[UAS.terms];
						record.submitFields({ type: UAS.record, id: row.id, values: back, options: { enableSourcing: false, ignoreMandatoryFields: true } });
						linked += 1;
					} catch (e2) {
						log.error('Lease link not written back', `Status ${row.id} (${row.unit}), lease ${made[0].id}: ${e2.message || e2}`);
						return;
					}
				}
				if (row.stage !== STAGE_READY && script.getRemainingUsage() > 40) {
					writeStageLog(row.id, row.stage || '', STAGE_READY, SOURCE_MANUAL, row.unit, ayName);
				}
			});
			if (linked < backRows.filter((row) => row.id).length) {
				log.error('Lease write-back incomplete',
					`Lease ${made[0].id} covers ${backRows.length} unit(s) at property ${a.property_id}; only ${linked} status rows were updated.`);
			}
			const totalBeds = made.reduce((sum, m) => sum + m.beds, 0);
			const totalMonthly = made.reduce((sum, m) => sum + m.monthly, 0);
			const scopeWord = isBedroom ? 'bedroom' : isWholeHouse ? 'whole property' : 'unit';
			log.audit('Lease created from pipeline',
				`Unit ${unitId} (${a.unit_name}), AY ${ay}, scope ${scopeWord}` +
				(isWholeHouse ? ` across ${siblings.length} unit(s), ${linked} status row(s) linked` : '') + ', ' +
				`lease(s) ${made.map((m) => m.id).join('/')}, ${totalBeds} beds at ${perBed}/bed for ${months} mo, ` +
				`employee ${(runtime.getCurrentUser() || {}).id}, remaining usage ${script.getRemainingUsage()}`);
			jsonOut(context, {
				ok: true,
				leaseId: made[0].id,
				leaseName: made.length === 1 ? made[0].name : `${made.length} bedroom leases`,
				leases: made,
				statusId: a.status_id ? String(a.status_id) : null,
				leaseUrl: recordUrl('lease', made[0].id) || '',
				stage: STAGE_READY,
				staged: linked,
				monthly: totalMonthly,
				bedroomIds: isBedroom ? targets.map((tg) => String(tg.link)) : [],
				unitIds: isWholeHouse ? siblings.map((u) => String(u.id)) : [String(unitId)],
				scope: scopeWord,
				message: made.length > 1
					? `${made.length} bedroom leases created, none with a status, so they are not in the leasing statistics yet. Set each to In Process with its Sent Date when it goes out.`
					: (isWholeHouse
						? `Lease created across all ${siblings.length} unit${siblings.length === 1 ? '' : 's'} at ${a.property_name || 'the property'}, with no unit link so it scopes to the whole property, and no status so it is not in the leasing statistics yet. Set Lease Status to In Process with the Sent Date when it goes out.`
						: 'Lease created with no status, so it is not in the leasing statistics yet. Set Lease Status to In Process with the Sent Date when it goes out.')
			});
		} catch (e) {
			log.error('Lease create failed',
				`Unit ${unitId}: ${e.name || ''} ${e.message || e}. ${made.length} of ${targets.length} written: ${made.map((m) => m.id).join('/') || 'none'}`);
			jsonOut(context, {
				ok: false,
				leases: made,
				message: made.length
					? `${made.length} of ${targets.length} leases were created before this failed: ${e.message || e}. Check the unit before retrying.`
					: `The lease could not be created: ${e.message || e}`
			});
		}
	};

	const handlePost = (context) => {
		let payload = null;
		try { payload = JSON.parse(context.request.body || '{}'); } catch (e) { payload = null; }
		if (!payload || !/^\d+$/.test(String(payload.ay || ''))) {
			jsonOut(context, { ok: false, results: [], message: 'The request was malformed.' });
			return;
		}
		if (payload.action === 'note') { doNoteAdd(context, payload); return; }
		if (payload.action === 'lease') { doLeaseCreate(context, payload); return; }
		if (!Array.isArray(payload.rows) || !payload.rows.length) {
			jsonOut(context, { ok: false, results: [], message: 'Nothing to save.' });
			return;
		}
		doStageSave(context, payload);
	};

	const onRequest = (context) => {
		// A stage save is the only write this Suitelet makes, and it is the only POST it answers.
		if (context.request.method === 'POST') { handlePost(context); return; }

		// &raw=1 writes the report as a plain page (no NetSuite menus) - a fallback if the NetSuite form will not draw it.
		const raw = String(context.request.parameters.raw || '') === '1';
		// &wkay=1 asks for one academic year's weekly sections as JSON, for a Present-mode slide.
		const slidesOnly = String(context.request.parameters.wkay || '') === '1';
		let html = '';

		try {
			const script = runtime.getCurrentScript();
			const params = context.request.parameters;
			const baseUrl = url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId }) + (raw ? '&raw=1' : '');
			// Both locks apply and the narrower wins: a viewer can never widen a locked deployment.
			const deployLock = marketLock(script);
			const userLock = viewerLock(script);
			const lock = deployLock && userLock
				? new Set([...deployLock].filter((k) => userLock.has(k)))
				: (deployLock || userLock);
			// An empty lock means no market is allowed: show nothing at all, not even blank-City properties.
			const lockDenies = !!lock && lock.size === 0;
			const now = todayStr();

			const academicYears = engine.sortYears(runQuery(SQL.academicYears));
			const subsidiaries = runQuery(SQL.subsidiaries);
			// Accounts where the Property record is not hierarchical (e.g. a sandbox refreshed before parent/child
			// properties existed) have no "parent" column: load without it and run with the parent guard off.
			let allProperties;
			try {
				allProperties = runQuery(SQL.properties);
			} catch (e) {
				if (!/PARENT/i.test(String(e.message || e))) throw e;
				log.error('Property parent field unavailable', 'Property record is not hierarchical in this account; loading properties without parent (parent guard off).');
				allProperties = runQuery(SQL.properties.replace(/\bname, parent,/, 'name,'));
			}
			// Blank City -> parent property's City (engine rule), so filters, the lock and every list agree.
			const cityProps = engine.withParentCity ? engine.withParentCity(allProperties) : allProperties;
			// Market lock: only the allowed markets' properties are loaded, plus properties with no City at all
			// (no market to judge by), which stay visible on Exceptions so they get fixed.
			const properties = lock
				? (lockDenies ? [] : cityProps.filter((p) => lock.has(keyify(p.city)) || !keyify(p.city)))
				: cityProps;
			const propIds = new Set(properties.map((p) => String(p.id)));

			const defaultAy = leasingAy(academicYears, now.day);
			const ay = academicYears.some((a) => String(a.id) === String(params.ay || '')) ? String(params.ay) : defaultAy;
			const fund = String(params.fund || '');
			let market = String(params.market || '').toLowerCase();
			// Pro-forma is the default view: it is how the business reads pre-leasing (signed + in process).
			const basis = params.basis === 'exec' ? 'exec' : 'pf';
			// Default to the week that has finished. The current week is always partial, so opening on it
			// shows a half-filled week beside full prior ones and reads as a collapse in activity.
			const priorMonday = (() => {
				const t = Date.parse(`${now.day}T00:00:00Z`);
				const dow = (new Date(t).getUTCDay() + 6) % 7;
				return new Date(t - (dow + 7) * 86400000).toISOString().slice(0, 10);
			})();
			const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(String(params.week || '')) ? String(params.week) : priorMonday;

			const fundOptions = {};
			const marketOptions = {};
			const subById = {};
			subsidiaries.forEach((s) => { subById[String(s.id)] = s; });
			const topFund = (subId) => {
				let cur = subById[String(subId)];
				if (!cur || !cur.parent) return null;
				while (cur.parent && subById[String(cur.parent)] && subById[String(cur.parent)].parent) cur = subById[String(cur.parent)];
				return cur;
			};
			properties.forEach((p) => {
				const f = topFund(p.subsidiary);
				if (f) fundOptions[String(f.id)] = String(f.name).replace(/\s(\d)$/, (m, d) => ` ${['', 'I', 'II', 'III', 'IV', 'V'][Number(d)] || d}`);
				if (keyify(p.city)) marketOptions[keyify(p.city)] = labelify(p.city);
			});
			const marketKeys = Object.keys(marketOptions).sort();
			if (market && !marketOptions[market]) market = '';
			if (lock && marketKeys.length === 1) market = marketKeys[0];
			const noMarketsMsg = lockDenies
				? (userLock && !deployLock ? 'No markets are assigned to your user - ask an administrator to set your Lease KPI Markets' : 'No markets in common with this deployment')
				: 'No markets match this deployment';
			const lockLabel = lock ? (marketKeys.length ? marketKeys.map((k) => marketOptions[k]).join(', ') : noMarketsMsg) : '';
			// Say where the narrowing came from, so a restricted viewer knows the report is scoped to them, not broken.
			const lockSuffix = userLock ? ' \u00b7 your access' : '';
			const scopeShort = [fund ? (fundOptions[fund] || fund) : '', market ? (marketOptions[market] || market) : ''].filter(Boolean).join(' · ');

			const ctx = {
				ay, fund, market, basis, academicYears, defaultAy,
				lock: !!lock,
				scopeLabel: lock ? (marketKeys.length ? `${lockLabel} only${lockSuffix}` : lockLabel) : 'All markets',
				scopeShort,
				fundOptions: Object.keys(fundOptions).map((key) => ({ key, label: fundOptions[key] })).sort((a, b) => a.label.localeCompare(b.label)),
				marketOptions: marketKeys.map((key) => ({ key, label: marketOptions[key] })),
				hasReport: false,
				excludedCount: 0
			};

			let body;
			let clientData = { baseUrl };

			if (!ay) {
				body = `<div class="card empty"><strong>No academic years found</strong>Add an Academic Year record to run the report.</div>`;
			} else {
				let records = runQuery(SQL.records);
				let allLeases = runQuery(SQL.leases);
				let targets = runQuery(SQL.targets, [ay]);
				let tenantLinks = [];
				try {
					tenantLinks = runQuery(SQL.tenants, [ay]);
				} catch (e) {
					log.error('Tenant links unavailable (customer access?)', e);
				}
				let inactivations = [];
				try {
					inactivations = runQuery(SQL.inactivations);
				} catch (e) {
					log.error('Lease inactivation history unavailable (System Notes access?)', e);
				}
				if (lock) {
					const unitIds = new Set(records.filter((r) => !r.parent && propIds.has(String(r.property_id))).map((r) => String(r.id)));
					records = records.filter((r) => (r.parent ? unitIds.has(String(r.parent)) : unitIds.has(String(r.id))));
					const recIds = new Set(records.map((r) => String(r.id)));
					allLeases = allLeases.filter((l) => propIds.has(String(l.property_id)));
					const leaseIds = new Set(allLeases.map((l) => String(l.id)));
					targets = targets.filter((t) => recIds.has(String(t.unit_id)) || propIds.has(String(t.property_id)));
					tenantLinks = tenantLinks.filter((t) => leaseIds.has(String(t.lease_id)));
					inactivations = inactivations.filter((e) => propIds.has(String(e.property_id)));
				}

				const ayRow = academicYears.find((a) => String(a.id) === ay);
				const ayName = ayRow ? ayRow.name : ay;
				const priorRow = engine.priorYearOf(academicYears, ay);
				// Occupancy, revenue and pre-leasing see every lease active in the year, including
				// the second year of a two-year lease, each with that year's months and revenue.
				const spanned = leasesForYear(allLeases, ay, academicYears);
				const curLeases = spanned.filter((l) => engine.inBasis(l, basis));
				const priorLeases = priorRow
					? leasesForYear(allLeases, String(priorRow.id), academicYears).filter((l) => engine.inBasis(l, basis))
					: null;

				const model = engine.calculate({ subsidiaries, properties, records, leases: curLeases, priorLeases, targets });
				const pace = { basis, asOf: now.day, ayStart: ayRow ? ayRow.start_date : null, priorAyStart: priorRow ? priorRow.start_date : null };
				const view = engine.summarize(model, { fundKey: fund || null, marketKey: market || null, pace });
				// Weekly activity and the data-quality lists are about this year's own records, so
				// they exclude the carried second year: nothing was sent or signed then, and the
				// record belongs to the year it was written for.
				const ayLeases = spanned.filter((l) => !l.carry);
				const carried = spanned.filter((l) => l.carry);
				const priorAyLeases = priorRow ? allLeases.filter((l) => String(l.ay) === String(priorRow.id)) : [];
				const weekly = engine.weekly(model, {
					basis, today: now.day, week: weekParam, fundKey: fund || null, marketKey: market || null, totalBeds: view.portfolio.beds,
					ayStart: ayRow ? ayRow.start_date : null, priorAyStart: priorRow ? priorRow.start_date : null, ayLeases, priorAyLeases, inactivations, academicYears,
					groupBy: market ? 'fund' : 'market'
				});
				// A deck slide fetch needs only this AY's weekly sections. Stop here rather than going on
				// to the exceptions, tenant quality and pipeline work the full page does.
				if (slidesOnly) {
					const slides = renderWeekly(weekly, Object.assign({}, ctx, {
						ayName, basisLabel: engine.BASIS_LABEL[basis],
						priorName: priorRow ? priorRow.name : null, slidesOnly: true
					}));
					log.audit('Weekly deck slide', `AY ${ay}, fund ${fund || 'all'}, market ${market || 'all'}, remaining usage ${script.getRemainingUsage()}`);
					jsonOut(context, Object.assign({ ok: true, ay }, slides));
					return;
				}

				const recent = engine.recentLeases(allLeases, { properties, subsidiaries, academicYears, now: now.stamp, days: 3, fundKey: fund || null, marketKey: market || null });

				const inScope = (p) => (p ? (!fund || p.fundKey === fund) && (!market || p.marketKey === market) && !!p.marketKey : !fund && !market);
				const fixes = {
					lease: view.exceptions.map((e) => ({
						kind: 'lease', id: e.id, name: e.name, issue: `Excluded: ${e.reason}`, detail: '', fix: e.fix, related: e.related,
						property: e.property, linked: e.linked, mrev: e.mrev, excluded: true
					})).concat(engine.leaseQuality(ayLeases, { properties, subsidiaries, today: now.day, ayEnd: ayRow ? ayRow.end_date : null })
						.filter((d) => inScope(d.prop))
						.map((d) => ({ kind: 'lease', id: d.recordId, name: d.record, issue: d.issue, detail: d.detail, fix: d.fix, related: [],
							property: d.prop ? d.prop.name : '', linked: d.linked, mrev: d.mrev, excluded: false }))),
					tenant: engine.tenantQuality(ayLeases, tenantLinks, { properties, subsidiaries, fundKey: fund || null, marketKey: market || null }),
					records: view.dataQuality.filter((d) => d.recordId).map((d) => ({
						kind: d.kind, id: d.recordId, name: d.record, issue: d.issue, detail: d.handling, fix: d.fix, related: [], property: d.property, linked: '', mrev: null
					}))
				};

				const linkFor = (kind, id) => (RECORD_TYPES[kind] && id ? url.resolveRecord({ recordType: RECORD_TYPES[kind], recordId: id }) : null);
				[weekly.inProcess, weekly.executed, weekly.inactivated, recent].forEach((list) => list.forEach((e) => { e.link = linkFor('lease', e.id); }));
				fixes.tenant.forEach((r) => { r.link = linkFor(r.kind, r.id); });
				// Compact copy for the browser (rows are drawn client-side from this single copy; CSV export uses it too).
				const packFix = (r) => ({
					k: r.kind, i: r.id, n: r.name, s: r.issue, d: r.detail || '', f: r.fix, p: r.property || '', u: r.linked || '', v: r.sev || 0,
					m: r.mrev === null || r.mrev === undefined ? null : r.mrev, l: linkFor(r.kind, r.id) || '',
					r: (r.related || []).slice(0, 6).map((y) => [y.kind, y.name, linkFor(y.kind, y.id) || '']), rc: (r.related || []).length
				});
				const fixData = { lease: fixes.lease.map(packFix), tenant: fixes.tenant.map(packFix), records: fixes.records.map(packFix) };


				// ---- Pipeline rows: inventory leaves first, everything else joined on by unit ----
				// Never a fresh "FROM customrecord_serp_units_bedrooms" query for the grid: the denominator
				// has to be the KPI denominator, or Pipeline and Summary are measuring different inventory.
				// Leases with no Lease Status never reach the model (engine.hasStatus keeps them out
				// of the numbers), so the leaves cannot know about them. Resolve them here by the
				// same rules placeLeases uses, purely so the board can show that a lease exists.
				const draftByUnit = {};
				{
					const unitOfBedroom = {};
					const unitsOfProperty = {};
					records.forEach((u) => {
						if (u.parent) { unitOfBedroom[String(u.id)] = String(u.parent); return; }
						const pid = String(u.property_id || '');
						if (!pid) return;
						(unitsOfProperty[pid] || (unitsOfProperty[pid] = [])).push(String(u.id));
					});
					ayLeases.filter((l) => !l.status).forEach((l) => {
						const type = String(l.lease_type || '');
						const linked = l.unit_id === null || l.unit_id === undefined ? '' : String(l.unit_id);
						let units = [];
						if (type === LEASE_TYPE_BEDROOM) {
							if (unitOfBedroom[linked]) units = [unitOfBedroom[linked]];
						} else if (linked) {
							units = [unitOfBedroom[linked] || linked];
						} else if (type === LEASE_TYPE_WHOLE_HOUSE) {
							units = unitsOfProperty[String(l.property_id || '')] || [];
						}
						units.forEach((uid) => { if (!draftByUnit[uid]) draftByUnit[uid] = l; });
					});
				}

				const plBase = engine.pipelineUnits(model, { fundKey: fund || null, marketKey: market || null });
				const pipeline = {
					rows: [], units: 0, beds: 0, summaryBeds: view.portfolio.beds,
					ties: { beds: true }, missingStatus: 0, error: '', team: [], notesOn: true,
					priorName: priorRow ? priorRow.name : null, nextName: null
				};
				try {
					const byUnit = {};
					unitStatusRows(ay).forEach((s) => { byUnit[String(s.unit_id)] = s; });

					// Targets for the selected AY are already loaded for the KPIs; just index them by unit.
					const tgtByUnit = {};
					targets.forEach((t) => { if (t.unit_id) tgtByUnit[String(t.unit_id)] = t; });

					// The next academic year's targets, for the forward row of the history drawer.
					const curIdx = academicYears.findIndex((a) => String(a.id) === ay);
					const nextRow = curIdx > -1 && curIdx + 1 < academicYears.length ? academicYears[curIdx + 1] : null;
					const nextTgtByUnit = {};
					if (nextRow) {
						pipeline.nextName = nextRow.name;
						try {
							runQuery(SQL.targets, [String(nextRow.id)]).forEach((t) => { if (t.unit_id) nextTgtByUnit[String(t.unit_id)] = t; });
						} catch (e) { log.error('Next-AY targets unavailable', e); }
					}

					// Prior-year lease per unit, straight out of allLeases - SQL.leases is not AY-filtered,
					// so the whole rent history is already in hand and this costs no extra query.
					const priorLeaseByUnit = {};
					if (priorRow) {
						allLeases.filter((l) => String(l.ay) === String(priorRow.id) && l.unit_id)
							.forEach((l) => { const k = String(l.unit_id); if (!priorLeaseByUnit[k]) priorLeaseByUnit[k] = l; });
					}

					// Who is in the unit now. A renewal conversation is the first move on most units, and
					// an agent cannot have it without knowing who they are asking.
					const priorTenantsByUnit = {};
					if (priorRow) {
						try {
							const leaseToUnit = {};
							allLeases.forEach((l) => { if (l.unit_id) leaseToUnit[String(l.id)] = String(l.unit_id); });
							runQuery(SQL.tenants, [String(priorRow.id)]).forEach((t) => {
								const u = leaseToUnit[String(t.lease_id)];
								if (!u || String(t.tenant_inactive) === 'T' || !t.tenant_name) return;
								const list = priorTenantsByUnit[u] = priorTenantsByUnit[u] || [];
								if (list.indexOf(t.tenant_name) < 0) list.push(t.tenant_name);
							});
						} catch (e) { log.error('Prior-AY tenants unavailable', e); }
					}

					const notesByStatus = {};
					try {
						runQuery(SQL.unitNotes, [ay]).forEach((n) => {
							const k = String(n.status_id);
							(notesByStatus[k] = notesByStatus[k] || []).push({
								i: String(n.id), d: n.note_date || '', w: n.author || '', t: n.note_text || '',
								m: String(n.mentions === null || n.mentions === undefined ? '' : n.mentions)
									.split(',').map((x) => x.trim()).filter(Boolean)
							});
						});
					} catch (e) {
						// A missing or permission-locked note record must not take the rest of the tab down.
						log.error('Unit notes unavailable', e);
						pipeline.notesOn = false;
					}

					const loadTeam = (sql) => runQuery(sql)
						.map((r) => ({ i: String(r.id), n: String(r.name || '').trim() }))
						.filter((r) => r.n);
					try {
						pipeline.team = loadTeam(SQL.leasingTeam);
					} catch (e) {
						log.error('Mention picker: full query failed, trying the basic one', e);
						try {
							pipeline.team = loadTeam(SQL.leasingTeamBasic);
						} catch (e2) {
							// Without an employee list there is no picker, so mentions hide rather than letting
							// someone type a name that resolves to nobody.
							log.error('Mention picker unavailable (employee access?)', e2);
							pipeline.team = [];
						}
					}

					const numOr = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
					pipeline.rows = plBase.rows.map((r) => {
						const uid = r.unitId ? String(r.unitId) : '';
						const s = uid ? byUnit[uid] : null;
						if (uid && !s) pipeline.missingStatus += 1;
						const t = uid ? tgtByUnit[uid] : null;
						const x = uid ? nextTgtByUnit[uid] : null;
						const pl = uid ? priorLeaseByUnit[uid] : null;
						// The status record is the first source for the lease, because its link survives
						// a basis change. When it has none - which is every whole-house lease with no
						// unit link and most bedroom leases, since AD_UE_Lease_Stage_Sync does not
						// link those - fall back to the lease the inventory leaves already carry.
						const lf = r.leafLease || null;
						const fromLeaf = !(s && s.lease_id) && !!lf;
						const leafStage = fromLeaf
							? (lf.status === '1' ? '5' : lf.status === '2' ? '4' : '')
							: '';
						// Nothing counted this unit, but a lease exists that simply has no status.
						// Show it as Ready For Lease - Waiting on Forms, which is what it is, and
						// flag it so the row says why it is absent from the statistics.
						const draft = (!lf && !(s && s.lease_id) && uid) ? (draftByUnit[uid] || null) : null;
						return {
							u: uid || `p${r.propertyId}`,
							pi: String(r.propertyId),
							n: r.unitName, p: r.property, m: r.marketKey, ml: r.marketLabel, b: r.beds,
							ro: r.kind === 'P' ? 1 : 0,
							s: s ? String(s.id) : null,
							g: s && s.stage_id !== null && s.stage_id !== undefined ? stageOut(s.stage_id)
								: (leafStage || (draft ? STAGE_READY : '')),
							sr: s && s.stage_source_id ? String(s.stage_source_id) : (leafStage ? '2' : ''),
							ns: draft ? 1 : 0,
							sd: s && s.stage_date ? s.stage_date : null,
							fu: s && s.followup ? s.followup : '',
							lo: s && s.last_offer !== null && s.last_offer !== undefined ? s.last_offer : '',
							ex: s && s.expected ? s.expected : '',
							lt: s && s.terms ? String(s.terms) : '',
							// [id, name, beds, leaseId|null] per bedroom. A Bedroom lease has to link the
							// bedroom child record; the engine rejects one linked to the unit (BED_ON_UNIT).
							bd: (r.bedrooms || []).map((b) => [String(b.id), b.name, b.beds, b.leaseId || null]),
							li: s && s.lease_id ? String(s.lease_id) : (fromLeaf ? lf.id : (draft ? String(draft.id) : null)),
							ln: s && s.lease_name ? s.lease_name : (fromLeaf ? lf.name : (draft ? draft.name : '')),
							lk: s && s.lease_id ? (linkFor('lease', s.lease_id) || '')
								: (fromLeaf ? (linkFor('lease', lf.id) || '') : (draft ? (linkFor('lease', draft.id) || '') : '')),
							lc: r.leafLeaseCount || 0,
							lu: fromLeaf ? 1 : 0,
							// Exactly what Leasing Details prints: Whole House / Unit / Bedroom /
							// Mixed / Vacant, plus the occupied-bed split behind it.
							lty: r.leaseTypeLabel || '',
							sy: lf && lf.span > 1 ? [lf.spanYear, lf.span] : null,
							ob: [r.occWH || 0, r.occUnit || 0, r.occBed || 0, r.occBeds || 0],
							ls: r.leaseStart || null,
							le: r.leaseEnd || null,
							mr: s && s.lease_id ? numOr(s.monthly_rent) : (fromLeaf ? numOr(lf.mrev) : null),
							sent: s && s.sent_date ? s.sent_date : (fromLeaf ? lf.sent : null),
							sgn: s && s.signed_date ? s.signed_date : (fromLeaf ? lf.signed : null),
							tm: t ? numOr(t.target_monthly) : null,
							tb: t ? numOr(t.target_bed) : null,
							sf: t ? numOr(t.settle_monthly) : null,
							xm: x ? numOr(x.target_monthly) : null,
							xb: x ? numOr(x.target_bed) : null,
							pr: pl ? numOr(pl.monthly_rent) : null,
							pt: (priorTenantsByUnit[uid] || []).join(', '),
							no: s ? (notesByStatus[String(s.id)] || []) : []
						};
					});
					pipeline.units = pipeline.rows.length;
					pipeline.beds = pipeline.rows.reduce((t, r) => t + r.b, 0);
					// The same kind of assertion as the people / mrev / trev flags: if the board and the
					// KPIs are counting different inventory then every number on this tab is wrong, and
					// silence is the worst outcome. It shows on the tab and goes to the execution log.
					pipeline.ties.beds = pipeline.beds === view.portfolio.beds;
					if (!pipeline.ties.beds) {
						log.error('Pipeline bed tie failed',
							`Pipeline ${pipeline.beds} beds / ${pipeline.units} units vs Summary ${view.portfolio.beds} beds for AY ${ay}, fund ${fund || 'all'}, market ${market || 'all'}`);
					}
				} catch (e) {
					log.error('Pipeline unavailable', e);
					pipeline.error = /was not found/i.test(String(e.message || e))
						? 'A record this tab needs is not readable by this role. Check that Unit Leasing Status and Unit Leasing Note are both set to "No Permission Required for Internal Roles".'
						: String(e.message || e);
				}

				ctx.hasReport = true;
				ctx.excludedCount = fixes.lease.length + fixes.tenant.length;
				ctx.counted = view.portfolio.leases;
				ctx.excludedLeases = view.portfolio.excluded;
				ctx.priorName = priorRow ? priorRow.name : null;

				const since = new Date(`${now.day}T00:00:00Z`);
				since.setUTCDate(since.getUTCDate() - 3);
				const shiftDays = ayRow && priorRow && ayRow.start_date && priorRow.start_date
					? Math.round((Date.parse(`${ayRow.start_date}T00:00:00Z`) - Date.parse(`${priorRow.start_date}T00:00:00Z`)) / 86400000) : null;
				const lyAsOf = shiftDays === null ? null : new Date(Date.parse(`${now.day}T00:00:00Z`) - shiftDays * 86400000).toISOString().slice(0, 10);
				// Exclusions are the only thing on this tab that removes beds and revenue from the leasing numbers.
				// Rank them by what they cost and attach the leases, so the tab opens on "fix these and you get X back".
				const blocking = view.byReason
					.filter((r) => r.leases)
					.map((r) => Object.assign({}, r, {
						rows: view.exceptions
							.filter((e) => e.reasonCode === r.code)
							.map((e) => Object.assign({}, e, { link: linkFor('lease', e.id) }))
							.sort((a, b) => (b.trev || 0) - (a.trev || 0))
					}))
					.sort((a, b) => (b.trev || 0) - (a.trev || 0) || b.beds - a.beds || b.leases - a.leases);
				const blockingTotal = blocking.reduce((t, r) => ({
					leases: t.leases + r.leases, beds: t.beds + r.beds, people: t.people + r.people,
					mrev: t.mrev + r.mrev, trev: t.trev + r.trev
				}), { leases: 0, beds: 0, people: 0, mrev: 0, trev: 0 });

				const rctx = Object.assign({}, ctx, {
					ayName,
					basisLabel: engine.BASIS_LABEL[basis],
					blocking,
					blockingTotal,
					recent,
					recentSince: since.toISOString().slice(0, 10),
					vacancy: vacancyCounts(view.tree),
					portfolio: view.portfolio,
					lyAsOf
				});

				body = `
				<div class="tab-panel" id="tab-summary">${renderSummary(view, rctx)}</div>
				<div class="tab-panel" id="tab-details">${renderDetails(view, rctx)}</div>
				<div class="tab-panel" id="tab-weekly">${renderWeekly(weekly, rctx)}</div>
				<div class="tab-panel" id="tab-exceptions">${renderExceptions(fixes, rctx)}</div>
				<div class="tab-panel" id="tab-pipeline">${renderPipeline(pipeline, rctx)}</div>`;

				const rtNotes = {};
				REPORT_TYPES.forEach((rt) => { rtNotes[rt.key] = rt.note; });
				clientData = {
					baseUrl,
					ay,
					ayName,
					ayShort: ayShort(ayName),
					lyShort: priorRow ? ayShort(priorRow.name) : null,
					basis,
					hasPrior: view.hasPrior,
					tree: view.tree,
					total: view.totalNode,
					fixes: fixData,
					defaultDepth: market ? 2 : 1,
					reportTypes: rtNotes,
					pace: Object.assign({ week: weekly.week, cur: ayShort(ayName), ly: weekly.hasPrior && priorRow ? ayShort(priorRow.name) : null }, weekly.chart),
					wk: {
						ly: weekly.hasPrior && priorRow ? ayShort(priorRow.name) : null,
						totalBeds: weekly.totalBeds,
						weekLabel: `${fDate(weekly.week)} \u2013 ${fDate(weekly.weekEnd)}`,
						scope: ctx.scopeShort || (ctx.lock ? ctx.scopeLabel : 'All markets'),
						basis: engine.BASIS_LABEL[basis],
						// Academic years that have not started yet and have leases against them. The deck
						// rolls through these, so nobody changes the AY mid-presentation.
						forward: academicYears
							.filter((a) => a.start_date && a.start_date > now.day && allLeases.some((l) => String(l.ay) === String(a.id)))
							.map((a) => ({ id: String(a.id), name: a.name }))
					},
					pipeline: pipeline.error ? null : {
						rows: pipeline.rows, units: pipeline.units, beds: pipeline.beds,
						today: now.day, cap: PIPELINE_ROW_CAP, team: pipeline.team, notesOn: pipeline.notesOn,
						me: String((runtime.getCurrentUser() || {}).id || ''),
						ayName: ayShort(ayName), priorName: pipeline.priorName ? ayShort(pipeline.priorName) : null,
						nextName: pipeline.nextName ? ayShort(pipeline.nextName) : null,
						ayStart: ayRow ? ayRow.start_date : null
					}
				};

				if (carried.length) {
					log.audit('Two-year leases carried in',
						`AY ${ay} includes ${carried.length} lease(s) running in from an earlier year: ` +
						`${carried.map((l) => l.id).join('/')}. Months and revenue apportioned to this year; ` +
						'weekly activity and data-quality lists exclude them.');
				}
				log.audit('Lease KPI Reporting', `AY ${ay}, basis ${basis}, week ${weekly.week}, fund ${fund || 'all'}, market ${market || 'all'}, lock ${lock ? ([...lock].join('/') || 'DENY') : 'none'} (deployment ${deployLock ? [...deployLock].join('/') : 'none'}, viewer ${userLock ? ([...userLock].join('/') || 'DENY') : 'none'}, employee ${(runtime.getCurrentUser() || {}).id}), properties ${properties.length}, ` +
					`records ${records.length}, leases ${curLeases.length}/${allLeases.length}, excluded ${view.exceptions.length}, tenant links ${tenantLinks.length}, ` +
					`to fix ${fixes.lease.length}/${fixes.tenant.length}/${fixes.records.length}, remaining usage ${script.getRemainingUsage()}`);
			}

			const payload = JSON.stringify(clientData).replace(/</g, '\\u003c');
			html = `${STYLES}<div id="lkr" class="hide-desc">${renderCriteria(ctx)}${body}</div><script>window.LKR_DATA = ${payload};</script>${CLIENT_SCRIPT}`;

		} catch (e) {
			log.error('Lease KPI Reporting Error', e);
			log.error('Lease KPI Reporting Error', `${e.name || ''}: ${e.message || e}${e.stack ? ` | ${String(e.stack).slice(0, 800)}` : ''}`);
			html = `${STYLES}<div id="lkr"><div class="card empty"><strong>The report could not be loaded</strong>${esc(e.name || '')} ${esc(e.message || e)}</div></div>`;
		}

		log.audit('Lease KPI Reporting page', `${html.length} characters${raw ? ' (raw)' : ''}`);
		const plain = () => context.response.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lease KPI Reporting</title></head><body style="margin:0;background:#eef1f5">${html}</body></html>`);
		if (raw) { plain(); return; }
		try {
			const form = serverWidget.createForm({ title: 'Lease KPI Reporting' });
			const field = form.addField({ id: 'custpage_lkr_html', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
			field.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
			field.defaultValue = html;
			context.response.writePage(form);
		} catch (e) {
			// NetSuite refused the form (e.g. page too large): say why, then fall back to the plain page.
			log.error('Lease KPI Reporting form failed', `${e.name || ''}: ${e.message || e} (page ${html.length} characters)`);
			plain();
		}
	};

	return { onRequest };
});
