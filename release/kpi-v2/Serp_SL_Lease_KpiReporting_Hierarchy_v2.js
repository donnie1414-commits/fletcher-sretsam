/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/query', 'N/search', 'N/ui/serverWidget', 'N/runtime', 'N/url', 'N/log', './Serp_Lease_KpiReporting_Hierarchy_LIB_v2'],
	(query, search, serverWidget, runtime, url, log, engine) => {

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
			ORDER BY m.mapone, m.maptwo`
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
	   stay visible while scrolling down and the Total row stays at the bottom. Short tables are unaffected. Collapsed borders
	   do not travel with a sticky header, so the cell edges are drawn with inset shadows instead. */
	#lkr .wrap{overflow:auto;max-height:calc(100vh - 150px)}
	#lkr .wrap thead{position:sticky;top:0;z-index:2}
	#lkr .wrap thead th{box-shadow:inset 0 -1px 0 var(--line)}
	#lkr table.tree thead th.grp-start{box-shadow:inset 1px 0 0 var(--line),inset 0 -1px 0 var(--line)}
	#lkr table.tree thead tr.gh th[rowspan="3"]{box-shadow:inset 0 -1px 0 var(--line)}
	#lkr .wrap tfoot{position:sticky;bottom:0;z-index:2}
	#lkr .wrap tfoot td{box-shadow:inset 0 2px 0 var(--line);border-top:0}
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
		<tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c[2] ? 'l' : ''}">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody>
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

		// ---- To-date vs last year: week, month and academic year side by side.
		const c = w.cmp || null;
		const fMoneySigned = (v) => (isNum(v) ? `${sign(v)}${fMoneyK(Math.abs(v))}` : '–');
		const cRow = (label, p, key, money) => {
			const f = money ? fMoney : fInt;
			const dv = p.d ? p.d[key] : null;
			const pv = p.pct ? p.pct[key] : null;
			return `<tr><td class="l">${label}</td><td>${f(p.ty[key])}</td><td>${p.ly ? f(p.ly[key]) : '<span class="muted">n/a</span>'}</td>` +
				`<td>${p.ly ? `${dlt(dv, money ? fMoneySigned : fSigned)}${isNum(pv) ? `<span class="sub ${dcls(pv)}">${fGrowth(pv)}</span>` : ''}` : '<span class="muted">–</span>'}</td></tr>`;
		};
		const cmpCard = (p, tail) => `
			<div class="card">
				<div class="head"><div><h3>${esc(p.label)}</h3>
					<p class="sec-note">${p.from ? `${fDate(p.from)} – ` : 'Through '}${fDate(p.to)}${p.ly ? ` &middot; ${esc(ly)} ${p.lyFrom ? `${fDate(p.lyFrom)} – ` : 'through '}${fDate(p.lyTo)}` : ''}</p></div></div>
				<div class="wrap"><table class="dense cmp-tbl">
					<thead><tr><th class="l">Metric</th><th>This Year</th><th>${ly ? esc(ly) : 'Last Year'}</th><th>Change</th></tr></thead>
					<tbody>${cRow('Beds Leased', p, 'beds')}${cRow(`Leases ${signedWord}`, p, 'leases')}${cRow('Revenue Leased', p, 'trev', true)}${tail || ''}</tbody>
				</table></div>
			</div>`;
		const yearTail = !c ? '' : `
			<tr><td class="l">Pre-lease %</td><td>${fPct(c.year.ty.occPct)}</td><td>${c.year.ly ? fPct(c.year.ly.occPct) : '<span class="muted">n/a</span>'}</td><td>${c.year.d ? dlt(c.year.d.occPts, fPts) : '<span class="muted">–</span>'}</td></tr>` +
			(c.undatedBeds ? `<tr class="recon"><td class="l">Not yet dated<span class="sub">${fInt(c.undatedLeases)} lease${c.undatedLeases === 1 ? '' : 's'} with no ${w.basis === 'pf' ? 'sent or signed' : 'signed'} date: counted on Summary, in no week</span></td><td>${fInt(c.undatedBeds)}</td><td><span class="muted">–</span></td><td><span class="muted">–</span></td></tr>` : '');
		const cmpPanels = c ? `<div class="wk-cmp">${cmpCard(c.week)}${cmpCard(c.month)}${cmpCard(c.year, yearTail)}</div>
			<p class="sec-note wk-cmp-note">Figures run to ${fDate(c.asOf)}${c.partial ? ' (week still in progress)' : ''}. ${c.hasLy ? `Last year is the same number of elapsed days, ${fInt(c.lyShiftDays)} days back &mdash; whole weeks, so weekdays line up. ` : ''}${esc(basisNote)}.</p>` : '';

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
				<button type="button" class="btn sm exit-btn" id="lkr-present-exit">Exit</button>
			</div>
		</div>
		${cmpPanels}
		<div class="kpis six wk-tiles">
			${tile('Occupancy', fPct(sel.occPct), ly ? paceTone(sel.vsLyPct) : tone(sel.occPct), [pw(fPct(prev.occPct), dlt(sel.dOccPct, fPts)), lw(fPct(sel.lyOccPct), dlt(sel.vsLyPct, fPts))], `of ${fInt(w.totalBeds)} beds at week end`)}
			${tile('Occupied Beds', fInt(sel.occ), '', [pw(fInt(prev.occ), dlt(sel.dOcc, fSigned)), lw(fInt(sel.lyOcc), dlt(diff(sel.occ, sel.lyOcc), fSigned))])}
			${tile('Beds Leased This Week', fInt(sel.newBeds), '', [pw(fInt(prev.newBeds), dlt(diff(sel.newBeds, prev.newBeds), fSigned)), lw(fInt(sel.lyNewBeds), dlt(diff(sel.newBeds, sel.lyNewBeds), fSigned))])}
			${tile(`Leases ${signedWord} This Week`, fInt(sel.newLeases), '', [pw(fInt(prev.newLeases), dlt(diff(sel.newLeases, prev.newLeases), fSigned)), lw(fInt(sel.lyNewLeases), dlt(diff(sel.newLeases, sel.lyNewLeases), fSigned))])}
			${tile('Total Revenue Leased', fMoney(sel.trev), '', [pw(fMoneyK(prev.trev), dlt(sel.dTrev, (v) => (isNum(v) ? `${sign(v)}${fMoneyK(Math.abs(v))}` : '–'))), lw(fMoneyK(sel.lyTrev), dlt(isNum(sel.lyTrev) && sel.lyTrev > 0 ? sel.trev / sel.lyTrev - 1 : null, fGrowth))], 'Rent actual, full term')}
			${tile('Leases In Process', fInt(pl.now), pl.over21 ? 'warn' : '', [pw(fInt(pl.prev), dlt(diff(pl.now, pl.prev), fSigned)), lw(isNum(pl.ly) ? fInt(pl.ly) : 'n/a', isNum(pl.ly) ? dlt(diff(pl.now, pl.ly), fSigned) : '')], `${fInt(pl.over21)} over 21 days${pl.noSent ? ` &middot; ${fInt(pl.noSent)} without a sent date` : ''}`)}
		</div>
		${undated}

		<div class="card">
			<div class="head"><div><h3>By ${groupLabel}<em>week ending ${fDate(w.weekEnd)}</em></h3>
				<p class="sec-note">Occupancy at week end; WoW = change vs the prior week end; ${ly ? `LY = the same week of ${esc(ly)}; ` : ''}Beds Leased = leases dated this week.</p></div></div>
			<div class="wrap"><table class="dense wk-grp">
				<thead><tr><th class="l">${groupLabel}</th><th>Total Beds</th><th>Occ. %</th><th>WoW</th>${ly ? `<th>${esc(ly)}</th><th>vs LY</th>` : ''}<th>Beds Leased</th>${ly ? `<th>LY Beds Leased</th>` : ''}<th>In Process</th><th>Total Revenue</th>${ly ? '<th>Rev. vs LY</th>' : ''}</tr></thead>
				<tbody>${g.map((r) => gRow(r)).join('')}</tbody>
				${g.length > 1 ? `<tfoot>${gRow(totalRow, true)}</tfoot>` : ''}
			</table></div>
		</div>

		<div class="card">
			<div class="head"><div><h3>Leasing Pace<em>cumulative occupancy by week</em></h3>
				<p class="sec-note">Occupancy at each week end${ly ? `; ${esc(ly)} shifted onto this year’s calendar (same week of the leasing cycle)` : ''}. ${esc(basisNote)}.</p></div></div>
			<div class="chart" id="lkr-vel"></div>
		</div>

		<div class="wk-detail">
		${fold('Week-over-Week History', `${fInt(rows.length)} weeks`, `Cumulative figures at each week end, restated from today’s active leases.${ly ? ` ${esc(ly)} columns = the same week of the prior AY.` : ''}`, `
			${rows.length > 8 ? `<div class="toolbar"><span class="seg" id="lkr-hist-n"><button type="button" data-n="8" class="on">Last 8</button>${rows.length > 26 ? '<button type="button" data-n="26">26</button>' : ''}<button type="button" data-n="0">All</button></span></div>` : ''}
			<div class="wrap"><table class="dense" id="lkr-hist">
				<thead><tr><th class="l">Week</th><th>Leases</th><th>Beds Leased</th><th>Occupied Beds</th><th>Occ. %</th><th>WoW</th><th>Total Revenue</th>${ly ? `<th>LY Beds Leased</th><th>LY Occ. %</th><th>vs LY</th>` : ''}</tr></thead>
				<tbody>${rows.map(histRow).join('')}</tbody>
			</table></div>`)}
		${fold('Leases In Process', `${fInt(pl.now)} at week end${pl.noSent ? ` + ${fInt(pl.noSent)} with no sent date` : ''}`, `Lease Sent Date on or before ${fDate(w.weekEnd)} and not signed by then. Days = ${w.isCurrent ? 'today' : 'week end'} less Lease Sent Date.`, yoyStrip(w.inProcessYoY, 'In process') + leaseTable(w.inProcess, inProcessCols, 'No leases in process'))}
		${fold('Leases Sent This Week', `${fInt((w.sentThisWeek || []).length)} leases`, `Lease Sent Date ${fDate(w.week)} – ${fDate(w.weekEnd)}. Rent / Bed is this lease's monthly rent over its beds; ${ly ? `${esc(ly)} Rent / Bed is the same unit or bedroom a year earlier (* = only part of the lease matched).` : 'there is no prior academic year to compare against.'}`, yoyStrip(w.sentYoY, 'Sent') + leaseTable(w.sentThisWeek || [], sentCols, 'No leases sent this week'))}
		${fold('Fully Executed This Week', `${fInt(w.executed.length)} leases`, `Lease Status = Fully Executed, signed ${fDate(w.week)} – ${fDate(w.weekEnd)}.`, yoyStrip(w.execYoY, 'Executed') + leaseTable(w.executed, execCols, 'No leases fully executed this week'))}
		${fold('Lease Records Made Inactive This Week', fInt(w.inactivated.length), `From system notes (Inactive set to Yes) ${fDate(w.week)} – ${fDate(w.weekEnd)}, all academic years.`, leaseTable(w.inactivated, inactCols, 'No lease records were made inactive this week'))}
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

	const CLIENT_SCRIPT = String.raw`
	<script>
	(function () {
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

		var TABS = ['summary', 'details', 'weekly', 'exceptions'];
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
		var histSeg = $('lkr-hist-n');
		if (histSeg) histSeg.addEventListener('click', function (e) {
			var b = e.target.closest('button[data-n]');
			if (!b) return;
			var n = Number(b.getAttribute('data-n'));
			var rows = root.querySelectorAll('#lkr-hist tbody tr');
			for (var i = 0; i < rows.length; i++) rows[i].hidden = n > 0 && Number(rows[i].getAttribute('data-i')) >= n;
			var bs = histSeg.querySelectorAll('button');
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
		function present(on) {
			root.classList.toggle('present', on);
			try {
				if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(function () { /* not allowed */ });
				if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ignore */ });
			} catch (err) { /* fullscreen unavailable */ }
			drawVelocity();
		}
		if ($('lkr-present')) $('lkr-present').onclick = function () { present(true); };
		if ($('lkr-present-exit')) $('lkr-present-exit').onclick = function () { present(false); };
		document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && root.classList.contains('present')) present(false); });
		document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('present')) present(false); });

		function drawVelocity() {
			var box = $('lkr-vel');
			var C = D.pace;
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
		// NetSuite assigns the account owner and other provisioned users NEGATIVE internal ids (Yvette Wall is -5).
		// Those are real employee records with a real Lease KPI Markets field, so only a missing or non-numeric id
		// is invalid here. A bad id still fails closed; a negative one goes on to the lookup like any other.
		if (!Number.isFinite(userId) || userId === 0) {
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

	const onRequest = (context) => {
		// &raw=1 writes the report as a plain page (no NetSuite menus) - a fallback if the NetSuite form will not draw it.
		const raw = String(context.request.parameters.raw || '') === '1';
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
			const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(String(params.week || '')) ? String(params.week) : '';

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
				const curLeases = allLeases.filter((l) => String(l.ay) === ay && engine.inBasis(l, basis));
				const priorLeases = priorRow ? allLeases.filter((l) => String(l.ay) === String(priorRow.id) && engine.inBasis(l, basis)) : null;

				const model = engine.calculate({ subsidiaries, properties, records, leases: curLeases, priorLeases, targets });
				const pace = { basis, asOf: now.day, ayStart: ayRow ? ayRow.start_date : null, priorAyStart: priorRow ? priorRow.start_date : null };
				const view = engine.summarize(model, { fundKey: fund || null, marketKey: market || null, pace });
				const ayLeases = allLeases.filter((l) => String(l.ay) === ay);
				const priorAyLeases = priorRow ? allLeases.filter((l) => String(l.ay) === String(priorRow.id)) : [];
				const weekly = engine.weekly(model, {
					basis, today: now.day, week: weekParam, fundKey: fund || null, marketKey: market || null, totalBeds: view.portfolio.beds,
					ayStart: ayRow ? ayRow.start_date : null, priorAyStart: priorRow ? priorRow.start_date : null, ayLeases, priorAyLeases, inactivations, academicYears,
					groupBy: market ? 'fund' : 'market'
				});
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
				<div class="tab-panel" id="tab-exceptions">${renderExceptions(fixes, rctx)}</div>`;

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
					pace: Object.assign({ week: weekly.week, cur: ayShort(ayName), ly: weekly.hasPrior && priorRow ? ayShort(priorRow.name) : null }, weekly.chart)
				};

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
