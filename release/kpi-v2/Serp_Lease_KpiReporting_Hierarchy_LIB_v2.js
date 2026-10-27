/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {

	const LEASE_TYPE = { WHOLE_HOUSE: '1', UNIT: '2', BEDROOM: '3' };
	const LEASE_TYPE_LABEL = { 1: 'Whole House', 2: 'Unit', 3: 'Bedroom' };
	const UNASSIGNED_FUND = { key: 'unassigned', label: 'Unassigned' };

	const REASONS = [
		{ code: 'WH_MULTI', label: 'Multiple whole-house leases on property',
			meaning: 'A whole-house lease with no unit linked (covers the whole property) plus another whole-house lease on the same property. Usually a duplicate, or per-house leases that need linking to their own house.' },
		{ code: 'WH_PLUS', label: 'Whole-house lease + unit/bedroom leases on same property',
			meaning: 'A whole-house lease with no unit linked plus unit or bedroom leases on the same property. Both claim the same beds.' },
		{ code: 'PROP_HAS_WH', label: 'Property also has a whole-house lease',
			meaning: 'Unit or bedroom lease on a property that also has a property-wide whole-house lease (the other side of the rule above).' },
		{ code: 'MULTI_UNIT', label: 'Multiple leases on same unit/house',
			meaning: 'Two or more unit or whole-house leases point at the same unit/house. Usually leases linked to the wrong house, or a duplicate.' },
		{ code: 'UNIT_PLUS_BED', label: 'Unit/house lease + bedroom lease(s) in same unit',
			meaning: "A unit or whole-house lease and bedroom leases both claim the same unit's beds." },
		{ code: 'UNIT_HAS', label: 'Unit also has a unit or whole-house lease',
			meaning: 'Bedroom lease in a unit that is also covered by a unit or whole-house lease.' },
		{ code: 'MULTI_BED', label: 'Multiple bedroom leases on same bedroom',
			meaning: 'Two or more bedroom leases point at one bedroom.' },
		{ code: 'UNIT_ON_BED', label: 'Unit lease linked to a bedroom record',
			meaning: 'Lease Type is Unit but Units/Bedroom points to a bedroom record.' },
		{ code: 'BED_ON_UNIT', label: 'Bedroom lease linked to a unit record',
			meaning: 'Lease Type is Bedroom but Units/Bedroom points to a unit, so the bedroom is unknown.' },
		{ code: 'NOT_LINKED', label: 'Not linked to a unit/bedroom record',
			meaning: 'Unit or bedroom lease with Units/Bedroom blank, or linked to an inactive record.' },
		{ code: 'ZERO_BEDS', label: 'Linked record has 0 beds in NetSuite',
			meaning: 'The property, unit or bedroom has 0 beds in NetSuite (office, land, etc.).' },
		{ code: 'NO_PROP', label: 'Property not found in NetSuite',
			meaning: 'Lease Property is blank or the property record is inactive.' },
		{ code: 'UNKNOWN_TYPE', label: 'Unknown lease type',
			meaning: 'Lease Type is blank or not Whole House / Unit / Bedroom.' },
		{ code: 'BAD_DATES', label: 'End date is before the start date',
			meaning: 'The lease ends before it begins, so its term cannot be read. Fix the dates on the lease record.' }
	];
	const REASON_BY_CODE = REASONS.reduce((acc, r) => { acc[r.code] = r; return acc; }, {});

	// Rentals that are not student housing. Two kinds, handled differently, and neither enters the student figures.
	//
	//  STR_PROPS   - short-term rentals. Real beds, so they get the usual bed metrics, but the booking cycle has
	//                nothing to do with the academic year and rent/bed is several times the student norm, so they
	//                are reported on their own and kept out of pre-lease.
	//  OTHER_PROPS - commercial, land and office. No student beds at all. They are reported on rent alone: no beds,
	//                no occupancy %, no rent/bed, and they never touch the occupancy denominator.
	//
	// Ordinary non-student residential (25 Fayette, 9 Cedar) is NOT here: those are normal per-bed twelve-month
	// leases and they stay in the main figures.
	//
	// TEMPORARY: hardcoded property internal ids. NetSuite has no field saying what kind of rental a property is -
	// the class record's property type only separates Commercial / Land / Office from Residential, and 89 Spring is
	// typed Residential like everything else. When a rental-type field exists, read it here and delete these lists.
	//   STR:   39 89 Spring St (Charleston)
	//   Other: 621 1 E 4th, 622 102 E 4th, 623 3 E 4th, 624 329 S New, 625 331 S New, 626 333-335 S New (commercial)
	//          258 233 5th St, 374 15 Seminary Ave, 402 47 Oak St (land) | 529 168 Eaton Street (office)
	const STR_PROPS = new Set(['39']);
	const OTHER_PROPS = new Set(['258', '374', '402', '529', '621', '622', '623', '624', '625', '626']);
	const segmentOf = (id, parentId) => {
		const key = String(id);
		const pk = parentId === null || parentId === undefined ? null : String(parentId);
		if (STR_PROPS.has(key) || (pk && STR_PROPS.has(pk))) return 'str';
		if (OTHER_PROPS.has(key) || (pk && OTHER_PROPS.has(pk))) return 'other';
		return null;
	};

	const LEASE_STATUS = { EXECUTED: '1', IN_PROCESS: '2' };
	const BASIS = { EXEC: 'exec', PRO_FORMA: 'pf' };
	const BASIS_LABEL = { exec: 'Fully Executed', pf: 'Pro-forma' };
	const DAY = 86400000;

	const toKey = (value) => (value === null || value === undefined || value === '' ? null : String(value));
	const num = (value) => {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	};
	const round = (value, digits) => {
		const f = Math.pow(10, digits);
		return Math.round(value * f) / f;
	};
	const marketKey = (city) => String(city || '').trim().toLowerCase();
	const marketLabel = (city) => marketKey(city).replace(/\b\w/g, (c) => c.toUpperCase());
	const leafName = (name) => String(name || '').split(' : ').pop().trim();
	const marketKey_ = marketKey;
	const parseDay = (s) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
		return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
	};
	const parseStamp = (s) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''));
		return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
	};
	const fmtDay = (t) => new Date(t).toISOString().slice(0, 10);
	const fmtUs = (t) => { const d = new Date(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`; };
	const mondayOf = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
	const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

	const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
	const fundLabel = (name) => String(name || '').replace(/\s(\d+)$/, (m, d) => (ROMAN[Number(d)] ? ` ${ROMAN[Number(d)]}` : m));

	const SUM_KEYS = ['beds', 'occ', 'fin', 'occWH', 'occUnit', 'occBed', 'people', 'mrev', 'trev', 'monthsW', 'excluded',
		'pOcc', 'pFin', 'pPeople', 'pMrev', 'pTrev', 'ssBeds', 'ssCur', 'ssPrior', 'tgt', 'tgtBeds', 'tgtOcc', 'mrevT', 'settle', 'prevRx', 'prevRb'];
	const newMetrics = () => {
		const m = { leaseIds: new Set(), pLeaseIds: new Set(), start: null, end: null, types: new Set() };
		SUM_KEYS.forEach((k) => { m[k] = 0; });
		return m;
	};

	const addMetrics = (target, source) => {
		SUM_KEYS.forEach((k) => {
			target[k] += source[k];
		});
		source.leaseIds.forEach((id) => target.leaseIds.add(id));
		source.pLeaseIds.forEach((id) => target.pLeaseIds.add(id));
		source.types.forEach((t) => target.types.add(t));
		if (source.start && (!target.start || source.start < target.start)) target.start = source.start;
		if (source.end && (!target.end || source.end > target.end)) target.end = source.end;
		return target;
	};

	const buildFundResolver = (subsidiaries) => {
		const byId = {};
		subsidiaries.forEach((s) => {
			byId[String(s.id)] = { id: String(s.id), name: s.name, parent: toKey(s.parent) };
		});

		return (subsidiaryId) => {
			let current = byId[toKey(subsidiaryId)];
			if (!current || !current.parent) return UNASSIGNED_FUND;
			while (current.parent && byId[current.parent] && byId[current.parent].parent) {
				current = byId[current.parent];
			}
			return { key: current.id, label: fundLabel(current.name) };
		};
	};

	const buildInventory = (properties, records, resolveFund, dataQuality) => {
		const parentIds = new Set(properties.map((p) => toKey(p.parent)).filter(Boolean));
		const props = {};
		properties.forEach((p) => {
			const fund = resolveFund(p.subsidiary);
			props[String(p.id)] = {
				id: String(p.id),
				name: p.name,
				marketKey: marketKey(p.city),
				marketLabel: marketLabel(p.city),
				fundKey: fund.key,
				fundLabel: fund.label,
				typedBedrooms: num(p.bedrooms),
				isParent: parentIds.has(String(p.id)),
				segment: segmentOf(p.id, p.parent),
				units: [],
				leaves: [],
				leaf: null
			};
		});

		const raw = {};
		records.forEach((r) => {
			raw[String(r.id)] = {
				id: String(r.id),
				name: leafName(r.name),
				parentId: toKey(r.parent),
				propertyId: toKey(r.property_id),
				beds: r.beds === null || r.beds === undefined || r.beds === '' ? null : num(r.beds)
			};
		});

		const units = {};
		const bedrooms = {};

		Object.values(raw).forEach((r) => {
			if (r.parentId) return;
			const prop = props[r.propertyId];
			if (!prop) {
				dataQuality.push({ issue: 'Unit without active property', prop: null, record: r.name, recordId: r.id, kind: 'unit', handling: 'Not in report' });
				return;
			}
			const unit = { id: r.id, name: r.name, propertyId: prop.id, typedBeds: num(r.beds), bedrooms: [], leaves: [], leaf: null };
			units[unit.id] = unit;
			prop.units.push(unit);
		});

		Object.values(raw).forEach((r) => {
			if (!r.parentId) return;
			const unit = units[r.parentId];
			if (!unit) {
				dataQuality.push({ issue: 'Bedroom without active unit', prop: props[r.propertyId] || null, record: r.name, recordId: r.id, kind: 'unit', handling: 'Not in report' });
				return;
			}
			const bedroom = {
				id: r.id,
				name: r.name,
				unitId: unit.id,
				propertyId: unit.propertyId,
				leaf: { kind: 'B', id: r.id, beds: r.beds === null ? 1 : r.beds, lease: null, people: 0, mrev: 0, trev: 0 }
			};
			bedrooms[bedroom.id] = bedroom;
			unit.bedrooms.push(bedroom);
		});

		Object.values(props).forEach((prop) => {
			prop.units.sort(byName);
			prop.units.forEach((unit) => {
				unit.bedrooms.sort(byName);
				if (unit.bedrooms.length) {
					unit.leaves = unit.bedrooms.map((b) => b.leaf);
					const bedTotal = unit.leaves.reduce((s, l) => s + l.beds, 0);
					if (unit.typedBeds && unit.typedBeds !== bedTotal) {
						dataQuality.push({ issue: "Unit 'Number of Beds' differs from its bedroom records", prop, record: unit.name, recordId: unit.id, kind: 'unit',
							handling: `Bedroom records used (${bedTotal}); unit field says ${unit.typedBeds}` });
					}
				} else {
					unit.leaf = { kind: 'U', id: unit.id, beds: unit.typedBeds, lease: null, people: 0, mrev: 0, trev: 0 };
					unit.leaves = [unit.leaf];
					dataQuality.push({ issue: 'Unit has no bedroom records', prop, record: unit.name, recordId: unit.id, kind: 'unit',
						handling: `Unit 'Number of Beds' used (${unit.typedBeds})` });
				}
				prop.leaves.push(...unit.leaves);
			});

			if (!prop.units.length && !parentIds.has(prop.id)) {
				prop.leaf = { kind: 'P', id: prop.id, beds: prop.typedBedrooms, lease: null, people: 0, mrev: 0, trev: 0 };
				prop.leaves = [prop.leaf];
				dataQuality.push({ issue: 'Property has no unit records', prop, record: prop.name, recordId: prop.id, kind: 'property',
					handling: `Property 'Number of Bedrooms' used (${prop.typedBedrooms})` });
			}
			if (!prop.marketKey) {
				dataQuality.push({ issue: 'Property without market (city blank)', prop, record: prop.name, recordId: prop.id, kind: 'property', handling: 'Not in report' });
			}
			if (prop.fundKey === UNASSIGNED_FUND.key) {
				dataQuality.push({ issue: 'Property without fund (subsidiary)', prop, record: prop.name, recordId: prop.id, kind: 'property', handling: 'Shown under Unassigned' });
			}
		});

		return { props, units, bedrooms };
	};

	const leaseMonths = (lease) => {
		const months = num(lease.months);
		if (months > 0) return months;
		const monthly = num(lease.monthly_rent);
		const total = num(lease.total_rent);
		return monthly > 0 && total > 0 ? total / monthly : 12;
	};

	const placeLeases = (leases, inventory) => {
		const { props, units, bedrooms } = inventory;
		const results = [];

		leases.forEach((l) => {
			const prop = props[toKey(l.property_id)] || null;
			const type = toKey(l.lease_type);
			const linkedId = toKey(l.unit_id);
			const res = {
				id: String(l.id),
				name: l.name,
				type,
				typeLabel: LEASE_TYPE_LABEL[type] || 'Unknown',
				prop,
				linkedId,
				linkedName: l.unit_name ? leafName(l.unit_name) : '',
				people: num(l.tenants),
				months: leaseMonths(l),
				mrev: num(l.monthly_rent),
				trev: num(l.total_rent),
				// Set when the Suitelet has split a multi-year lease into its separate years.
				span: num(l.span), spanYear: num(l.spanYear), carry: l.carry ? 1 : 0,
				start: l.start_date || null,
				end: l.end_date || null,
				status: toKey(l.status),
				signed: l.signed_date || null,
				sent: l.sent_date || null,
				created: l.created || null,
				scope: null,
				unit: null,
				bedroom: null,
				leaves: [],
				reason: null
			};
			results.push(res);

			if (!prop) { res.reason = 'NO_PROP'; return; }
			if (!LEASE_TYPE_LABEL[type]) { res.reason = 'UNKNOWN_TYPE'; return; }

			const linkedUnit = linkedId ? units[linkedId] : null;
			const linkedBedroom = linkedId ? bedrooms[linkedId] : null;

			if (type === LEASE_TYPE.WHOLE_HOUSE) {
				if (!linkedId) {
					res.scope = 'P';
					res.leaves = prop.leaves;
				} else if (linkedUnit || linkedBedroom) {
					res.scope = 'U';
					res.unit = linkedUnit || units[linkedBedroom.unitId];
					res.leaves = res.unit.leaves;
				} else {
					res.reason = 'NOT_LINKED';
					return;
				}
			} else if (type === LEASE_TYPE.UNIT) {
				if (linkedBedroom) { res.reason = 'UNIT_ON_BED'; return; }
				if (!linkedUnit) { res.reason = 'NOT_LINKED'; return; }
				res.scope = 'U';
				res.unit = linkedUnit;
				res.leaves = linkedUnit.leaves;
			} else {
				if (linkedUnit) { res.reason = 'BED_ON_UNIT'; res.unit = linkedUnit; return; }
				if (!linkedBedroom) { res.reason = 'NOT_LINKED'; return; }
				res.scope = 'B';
				res.bedroom = linkedBedroom;
				res.unit = units[linkedBedroom.unitId];
				res.leaves = [linkedBedroom.leaf];
			}

			res.scopeBeds = res.leaves.reduce((s, leaf) => s + leaf.beds, 0);
			if (res.scopeBeds <= 0) res.reason = 'ZERO_BEDS';
			// A term that ends before it begins cannot be read, and would otherwise pass the overlap test as if it
			// were a clean sequential tenancy.
			else if (res.start && res.end && res.end < res.start) res.reason = 'BAD_DATES';
		});

		// Two leases only clash when they claim the same thing AT THE SAME TIME. A bed let for three months and then
		// for nine is two normal tenancies, not a duplicate, so the date test decides and both are counted.
		const overlaps = (a, b) => {
			if (!a.start || !a.end || !b.start || !b.end) return true;   // dates unknown: assume a clash
			return a.start < b.end && b.start < a.end;                   // touching ends are a turnover, not a clash
		};

		const lists = {};
		const bump = (key, r) => { (lists[key] = lists[key] || []).push(r); };
		// Does anything else at this key run at the same time as r?
		const hits = (key, r) => (lists[key] || []).some((o) => o !== r && overlaps(o, r));
		const placed = results.filter((r) => !r.reason);

		results.forEach((r) => {
			if (!r.prop || !LEASE_TYPE_LABEL[r.type]) return;
			const p = r.prop.id;
			if (r.type === LEASE_TYPE.WHOLE_HOUSE) {
				bump(`whAny|${p}`, r);
				if (!r.linkedId) bump(`whP|${p}`, r);
			} else {
				bump(`unitBed|${p}`, r);
			}
		});

		placed.forEach((r) => {
			if (r.type === LEASE_TYPE.BEDROOM) {
				bump(`bedInUnit|${r.unit.id}`, r);
				bump(`bed|${r.bedroom.id}`, r);
			} else if (r.scope === 'U') {
				bump(`unitScope|${r.unit.id}`, r);
			}
		});

		placed.forEach((r) => {
			const p = r.prop.id;
			if (r.type === LEASE_TYPE.WHOLE_HOUSE && r.scope === 'P') {
				if (hits(`whAny|${p}`, r)) r.reason = 'WH_MULTI';
				else if (hits(`unitBed|${p}`, r)) r.reason = 'WH_PLUS';
			} else if (r.type === LEASE_TYPE.WHOLE_HOUSE || r.type === LEASE_TYPE.UNIT) {
				if (hits(`whP|${p}`, r)) r.reason = 'PROP_HAS_WH';
				else if (hits(`unitScope|${r.unit.id}`, r)) r.reason = 'MULTI_UNIT';
				else if (hits(`bedInUnit|${r.unit.id}`, r)) r.reason = 'UNIT_PLUS_BED';
			} else {
				if (hits(`whP|${p}`, r)) r.reason = 'PROP_HAS_WH';
				else if (hits(`unitScope|${r.unit.id}`, r)) r.reason = 'UNIT_HAS';
				else if (hits(`bed|${r.bedroom.id}`, r)) r.reason = 'MULTI_BED';
			}
		});

		// Earliest term first, so a bed's primary lease is the one that starts the year.
		const toPlace = placed.filter((r) => !r.reason).slice().sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
		toPlace.forEach((r) => {
			let cumulativeBeds = 0;
			let allocated = 0;
			r.leaves.forEach((leaf) => {
				cumulativeBeds += leaf.beds;
				const upTo = Math.round((r.people * cumulativeBeds) / r.scopeBeds);
				const share = { lease: r, people: upTo - allocated, mrev: (r.mrev * leaf.beds) / r.scopeBeds, trev: (r.trev * leaf.beds) / r.scopeBeds, months: r.months };
				allocated = upTo;
				leaf.alloc = leaf.alloc || [];
				leaf.alloc.push(share);
				if (leaf.alloc.length === 1) {
					leaf.lease = r;
					leaf.people = share.people;
					leaf.mrev = share.mrev;
					leaf.trev = share.trev;
					return;
				}
				// A second, non-overlapping tenancy on the same bed. The bed is still one bed, so headcount is the most
				// at any one time; the contract value is the year's total; the monthly rent is the months-weighted
				// average, because the two rents never run at the same time and adding them would invent a run-rate.
				const mo = leaf.alloc.reduce((t, a) => t + a.months, 0);
				leaf.people = Math.max(leaf.people, share.people);
				leaf.trev += share.trev;
				leaf.mrev = mo > 0 ? leaf.alloc.reduce((t, a) => t + a.mrev * a.months, 0) / mo : leaf.mrev + share.mrev;
			});
		});

		return results;
	};

	const leafMetrics = (leaf, priorLeaf) => {
		const m = newMetrics();
		m.beds = leaf.beds;
		const has = (v) => v !== null && v !== undefined;
		if (has(leaf.tgt)) { m.tgt = leaf.tgt; m.tgtBeds = leaf.beds; }
		if (has(leaf.settle)) m.settle = leaf.settle;
		if (has(leaf.prevRb)) { m.prevRx = leaf.prevRb * leaf.beds; m.prevRb = leaf.beds; }
		if (priorLeaf && priorLeaf.lease) {
			const pl = priorLeaf.lease;
			m.pOcc = leaf.beds;
			m.pFin = (leaf.beds * Math.min(pl.months, 12)) / 12;
			m.pPeople = priorLeaf.people;
			m.pMrev = priorLeaf.mrev;
			m.pTrev = priorLeaf.trev;
			m.pLeaseIds.add(pl.id);
		}
		if (leaf.ss && leaf.lease && priorLeaf) {
			m.ssBeds = leaf.beds;
			m.ssCur = leaf.mrev;
			m.ssPrior = priorLeaf.mrev;
		}
		const lease = leaf.lease;
		if (!lease) return m;
		if (has(leaf.tgt)) { m.tgtOcc = leaf.tgt; m.mrevT = leaf.mrev; }

		// Sequential tenancies on one bed: the months add up (three plus nine is a full year), the bed does not.
		const alloc = leaf.alloc && leaf.alloc.length ? leaf.alloc : [{ lease, months: lease.months }];
		const totMonths = alloc.reduce((t, a) => t + a.months, 0);

		m.occ = leaf.beds;
		m.fin = (leaf.beds * Math.min(totMonths, 12)) / 12;
		if (lease.type === LEASE_TYPE.WHOLE_HOUSE) m.occWH = leaf.beds;
		else if (lease.type === LEASE_TYPE.UNIT) m.occUnit = leaf.beds;
		else m.occBed = leaf.beds;
		m.people = leaf.people;
		m.mrev = leaf.mrev;
		m.trev = leaf.trev;
		m.monthsW = totMonths * leaf.beds;
		alloc.forEach((a) => {
			m.leaseIds.add(a.lease.id);
			m.types.add(a.lease.type);
			if (a.lease.start && (!m.start || a.lease.start < m.start)) m.start = a.lease.start;
			if (a.lease.end && (!m.end || a.lease.end > m.end)) m.end = a.lease.end;
		});
		return m;
	};

	const typeSummary = (m) => {
		if (!m.occ) return 'Vacant';
		if (m.types.size > 1) return 'Mixed';
		return LEASE_TYPE_LABEL[[...m.types][0]];
	};

	const compact = (node) => {
		Object.keys(node).forEach((k) => {
			if (k === 'n' || k === 'lv' || k === 'b') return;
			if (node[k] === 0 || node[k] === null || node[k] === undefined || node[k] === 'Vacant') delete node[k];
		});
		return node;
	};

	const toNode = (name, level, m, children) => compact({
		n: name,
		lv: level,
		b: round(m.beds, 2),
		o: round(m.occ, 2),
		f: round(m.fin, 2),
		wh: round(m.occWH, 2),
		un: round(m.occUnit, 2),
		bd: round(m.occBed, 2),
		p: m.people,
		l: m.leaseIds.size,
		x: m.excluded,
		mr: round(m.mrev, 2),
		tr: round(m.trev, 2),
		mo: m.occ ? round(m.monthsW / m.occ, 1) : null,
		s: m.start,
		e: m.end,
		ty: typeSummary(m),
		po: round(m.pOcc, 2),
		pm: round(m.pMrev, 2),
		sb: round(m.ssBeds, 2),
		sc: round(m.ssCur, 2),
		sp: round(m.ssPrior, 2),
		tg: round(m.tgt, 0),
		tb: round(m.tgtBeds, 2),
		to: round(m.tgtOcc, 0),
		mt: round(m.mrevT, 0),
		st: round(m.settle, 0),
		rx: round(m.prevRx, 0),
		rb: round(m.prevRb, 2),
		c: children && children.length ? children : undefined
	});

	const leafKey = (leaf) => `${leaf.kind}|${leaf.id}`;

	// What to do in NetSuite to clear each exclusion / data issue.
	const REASON_FIX = {
		WH_MULTI: 'Inactivate the duplicate whole-house lease, or link each lease to its own house in Units/Bedroom.',
		WH_PLUS: 'Link this whole-house lease to its house in Units/Bedroom, or inactivate the overlapping unit/bedroom leases.',
		PROP_HAS_WH: 'Link the property-wide whole-house lease to its house, or inactivate this lease if it is a duplicate.',
		MULTI_UNIT: 'Relink this lease to the correct unit/house, or inactivate the duplicate.',
		UNIT_PLUS_BED: 'Keep either the unit lease or the bedroom leases; inactivate or relink the other.',
		UNIT_HAS: 'Relink this bedroom lease, or inactivate it; the unit is already covered by a unit/whole-house lease.',
		MULTI_BED: 'Relink to the correct bedroom, or inactivate the duplicate.',
		UNIT_ON_BED: 'Set Units/Bedroom to the unit record, or change Lease Type to Bedroom.',
		BED_ON_UNIT: 'Set Units/Bedroom to the specific bedroom, or change Lease Type to Unit.',
		NOT_LINKED: 'Set Units/Bedroom on the lease (or reactivate the linked unit/bedroom).',
		ZERO_BEDS: 'Set Number of Beds on the linked unit/bedroom (or Number of Bedrooms on the property).',
		NO_PROP: 'Set Property on the lease (or reactivate the property).',
		UNKNOWN_TYPE: 'Set Lease Type to Whole House, Unit or Bedroom.'
	};
	const DQ_FIX = {
		'Unit without active property': 'Set Parent Property on the record (or reactivate the property).',
		'Bedroom without active unit': 'Set the parent unit on the bedroom (or reactivate the unit).',
		"Unit 'Number of Beds' differs from its bedroom records": 'Update Number of Beds on the unit to match its bedroom records.',
		'Unit has no bedroom records': 'Add bedroom records if this unit is ever leased by the bedroom.',
		'Property has no unit records': 'Add unit records, or confirm the property is only leased whole.',
		'Property without market (city blank)': 'Set City on the property.',
		'Property without fund (subsidiary)': 'Set Subsidiary on the property.',
		'Property City blank (City borrowed)': 'Set City on the property (re-selecting its class fills it).',
		'Academic Year Details row has no active unit': 'Set Unit on the Academic Year Details record, or inactivate it.',
		'Unit has more than one Academic Year Details row': 'Inactivate the extra Academic Year Details row for this unit.'
	};

	const excludedIndex = (results) => {
		const byProp = {};
		const byRecord = {};
		const unattributed = {};
		results.forEach((r) => {
			if (!r.reason || !r.prop) return;
			byProp[r.prop.id] = (byProp[r.prop.id] || 0) + 1;
			const recordId = r.bedroom ? r.bedroom.id : (r.unit ? r.unit.id : null);
			if (recordId) byRecord[recordId] = (byRecord[recordId] || 0) + 1;
			else unattributed[r.prop.id] = (unattributed[r.prop.id] || 0) + 1;
		});
		return { byProp, byRecord, unattributed };
	};

	// Same-store: a unit/house (or the whole property when it has no units or carries a property-wide whole-house lease
	// in either year) qualifies only when every bed is covered by a counted lease in BOTH years and no excluded lease
	// touches it in either year. Lease-type changes are fine when fully filled both years.
	const markSameStore = (inventory, priorInventory, results, priorResults) => {
		const exCur = excludedIndex(results);
		const exPrior = excludedIndex(priorResults);
		const propWH = (list) => {
			const s = {};
			list.forEach((r) => { if (!r.reason && r.scope === 'P') s[r.prop.id] = true; });
			return s;
		};
		const whCur = propWH(results);
		const whPrior = propWH(priorResults);
		const tally = { grains: 0, beds: 0, dropped: { excluded: 0, vacantCur: 0, vacantPrior: 0 }, droppedBeds: { excluded: 0, vacantCur: 0, vacantPrior: 0 } };

		Object.values(inventory.props).forEach((prop) => {
			const pProp = priorInventory.props[prop.id];
			if (!pProp) return;
			const propGrain = !prop.units.length || whCur[prop.id] || whPrior[prop.id];
			const grains = propGrain
				? [{ leaves: prop.leaves, pleaves: pProp.leaves, recIds: prop.units.reduce((a, u) => a.concat([u.id], u.bedrooms.map((b) => b.id)), []), whole: true }]
				: prop.units.map((u) => {
					const pu = pProp.units.find((x) => x.id === u.id);
					return { leaves: u.leaves, pleaves: pu ? pu.leaves : [], recIds: [u.id].concat(u.bedrooms.map((b) => b.id)), whole: false };
				});
			grains.forEach((g) => {
				const beds = g.leaves.reduce((s, l) => s + l.beds, 0);
				if (beds <= 0) return;
				let why = null;
				const touched = (ex) => ex.unattributed[prop.id] || (g.whole && ex.byProp[prop.id]) || g.recIds.some((id) => ex.byRecord[id]);
				if (touched(exCur) || touched(exPrior)) why = 'excluded';
				else if (g.leaves.some((l) => l.beds > 0 && !l.lease)) why = 'vacantCur';
				else if (!g.pleaves.length || g.pleaves.some((l) => l.beds > 0 && !l.lease)) why = 'vacantPrior';
				g.leaves.forEach((l) => { l.ss = !why; l.ssWhy = why; });
				if (why) { tally.dropped[why]++; tally.droppedBeds[why] += beds; } else { tally.grains++; tally.beds += beds; }
			});
		});
		return tally;
	};

	// Academic Year Details (unit level) -> leaves, split by beds.
	const applyTargets = (inventory, targets, dataQuality) => {
		const byUnit = {};
		const units = inventory.units;
		[...targets].sort((a, b) => num(a.id) - num(b.id)).forEach((t) => {
			const u = units[toKey(t.unit_id)];
			if (!u) {
				dataQuality.push({ issue: 'Academic Year Details row has no active unit', prop: inventory.props[toKey(t.property_id)] || null,
					record: `Details #${t.id}`, recordId: String(t.id), kind: 'details', handling: 'Target not used' });
				return;
			}
			if (byUnit[u.id]) {
				dataQuality.push({ issue: 'Unit has more than one Academic Year Details row', prop: inventory.props[u.propertyId] || null,
					record: `${u.name} (Details #${byUnit[u.id].id})`, recordId: String(byUnit[u.id].id), kind: 'details', handling: `Latest row used (#${t.id})` });
			}
			byUnit[u.id] = t;
		});
		Object.values(units).forEach((u) => {
			const t = byUnit[u.id];
			if (!t) return;
			const beds = u.leaves.reduce((s, l) => s + l.beds, 0);
			if (beds <= 0) return;
			const isSet = (v) => v !== null && v !== undefined && v !== '';
			const monthly = isSet(t.target_monthly) ? num(t.target_monthly) : (isSet(t.target_bed) ? num(t.target_bed) * beds : null);
			const settle = isSet(t.settle_monthly) ? num(t.settle_monthly) : (isSet(t.settle_bed) ? num(t.settle_bed) * beds : null);
			u.leaves.forEach((l) => {
				const share = l.beds / beds;
				if (monthly !== null) l.tgt = monthly * share;
				if (settle !== null) l.settle = settle * share;
				if (isSet(t.prev_rent_bed)) l.prevRb = num(t.prev_rent_bed);
			});
		});
	};

	// Market = property City. A property with a blank City uses the nearest parent property that has one; a parent
	// with a blank City uses its child properties' City when they all agree. Idempotent: rows that already have a
	// City (including ones filled here) pass through unchanged.
	const withParentCity = (properties) => {
		const hasCity = (p) => !!String((p && p.city) || '').trim();
		const byId = {};
		properties.forEach((p) => { byId[String(p.id)] = p; });
		const fromParent = properties.map((p) => {
			if (hasCity(p)) return p;
			let cur = p;
			for (let depth = 0; depth < 5 && cur && cur.parent; depth++) {
				cur = byId[String(cur.parent)];
				if (hasCity(cur)) return Object.assign({}, p, { city: cur.city, cityFrom: 'parent' });
			}
			return p;
		});
		const kidCities = {};
		fromParent.forEach((p) => {
			if (!p.parent || !hasCity(p)) return;
			(kidCities[String(p.parent)] = kidCities[String(p.parent)] || new Set()).add(marketKey(p.city));
		});
		return fromParent.map((p) => {
			if (hasCity(p)) return p;
			const set = kidCities[String(p.id)];
			if (!set || set.size !== 1) return p;
			const city = fromParent.find((k) => k.parent && String(k.parent) === String(p.id) && hasCity(k)).city;
			return Object.assign({}, p, { city, cityFrom: 'children' });
		});
	};

	const calculate = ({ subsidiaries, properties: rawProperties, records, leases, priorLeases, targets }) => {
		const dataQuality = [];
		const resolveFund = buildFundResolver(subsidiaries);
		const properties = withParentCity(rawProperties);
		const inventory = buildInventory(properties, records, resolveFund, dataQuality);
		properties.forEach((p) => {
			const prop = p.cityFrom ? inventory.props[String(p.id)] : null;
			if (prop) {
				dataQuality.push({ issue: 'Property City blank (City borrowed)', prop, record: p.name, recordId: String(p.id), kind: 'property',
					handling: `${p.cityFrom === 'children' ? "Child properties'" : "Parent property's"} City used (${prop.marketLabel})` });
			}
		});
		const leaseResults = placeLeases(leases, inventory);

		let prior = null;
		let sameStore = null;
		if (priorLeases) {
			const priorInventory = buildInventory(properties, records, resolveFund, []);
			const priorResults = placeLeases(priorLeases, priorInventory);
			const leafByKey = {};
			Object.values(priorInventory.props).forEach((p) => p.leaves.forEach((l) => { leafByKey[leafKey(l)] = l; }));
			prior = { leaseResults: priorResults, leafByKey };
			sameStore = markSameStore(inventory, priorInventory, leaseResults, priorResults);
		}
		if (targets && targets.length) applyTargets(inventory, targets, dataQuality);
		const priorOf = (leaf) => (prior ? prior.leafByKey[leafKey(leaf)] || null : null);
		const SS_CODE = { vacantCur: 'v', vacantPrior: 'p', excluded: 'x' };
		const tagSs = (node, leaf) => { if (prior && leaf && SS_CODE[leaf.ssWhy]) node.sw = SS_CODE[leaf.ssWhy]; return node; };

		const excludedByProp = {};
		const excludedByRecord = {};
		leaseResults.forEach((r) => {
			if (!r.reason || !r.prop) return;
			excludedByProp[r.prop.id] = (excludedByProp[r.prop.id] || 0) + 1;
			const recordId = r.bedroom ? r.bedroom.id : (r.unit ? r.unit.id : null);
			if (recordId) excludedByRecord[recordId] = (excludedByRecord[recordId] || 0) + 1;
		});

		const propertyRows = Object.values(inventory.props).map((prop) => {
			const propMetrics = newMetrics();
			const unitNodes = prop.units.map((unit) => {
				const unitMetrics = newMetrics();
				let bedNodes = [];
				if (unit.bedrooms.length) {
					bedNodes = unit.bedrooms.map((b) => {
						const bm = leafMetrics(b.leaf, priorOf(b.leaf));
						bm.excluded = excludedByRecord[b.id] || 0;
						addMetrics(unitMetrics, bm);
						return tagSs(toNode(b.name, 4, bm), b.leaf);
					});
				} else {
					addMetrics(unitMetrics, leafMetrics(unit.leaf, priorOf(unit.leaf)));
				}
				const unitExcluded = (excludedByRecord[unit.id] || 0);
				unitMetrics.excluded += unitExcluded;
				// Leasing Details and the Pipeline board now read one set of numbers. Without this
				// the board had to re-derive the covering lease and got a different answer for
				// whole-house and bedroom leases.
				unit.metrics = unitMetrics;
				addMetrics(propMetrics, unitMetrics);
				return tagSs(toNode(unit.name, 3, unitMetrics, bedNodes), unit.bedrooms.length ? null : unit.leaf);
			});

			if (prop.leaf) addMetrics(propMetrics, leafMetrics(prop.leaf, priorOf(prop.leaf)));
			propMetrics.excluded = excludedByProp[prop.id] || 0;

			const ssByType = {};
			prop.leaves.forEach((leaf) => {
				if (!leaf.ss || !leaf.lease) return;
				const t = leaf.lease.type;
				const acc = ssByType[t] || (ssByType[t] = { beds: 0, cur: 0, prior: 0 });
				const pl = priorOf(leaf);
				acc.beds += leaf.beds;
				acc.cur += leaf.mrev;
				acc.prior += pl ? pl.mrev : 0;
			});

			return { prop, metrics: propMetrics, ssByType, node: tagSs(toNode(prop.name, 2, propMetrics, unitNodes), prop.leaf) };
		});

		return { propertyRows, leaseResults, dataQuality, prior: prior ? { leaseResults: prior.leaseResults, leafByKey: prior.leafByKey } : null, sameStore };
	};

	const ratio = (a, b) => (b > 0 ? a / b : null);
	const growth = (cur, prev) => (prev > 0 ? cur / prev - 1 : null);

	// pace = prior-AY counted leases dated on or before the same point in the leasing cycle ({ occ, trev, leases }), or null.
	const kpiRow = (name, m, activeLeases, excluded, priorLeases, hasPrior, pace) => {
		const occPct = ratio(m.occ, m.beds);
		const pOccPct = hasPrior ? ratio(m.pOcc, m.beds) : null;
		const wkOccPct = pace ? ratio(pace.occ, m.beds) : null;
		return {
			lyWkOcc: pace ? pace.occ : null,
			lyWkOccPct: wkOccPct,
			lyWkDelta: pace && occPct !== null && wkOccPct !== null ? occPct - wkOccPct : null,
			lyWkLeases: pace ? pace.leases : null,
			lyWkTrev: pace ? round(pace.trev, 2) : null,
			trevPace: pace ? growth(m.trev, pace.trev) : null,
			trevYoY: hasPrior ? growth(m.trev, m.pTrev) : null,
			name,
			beds: m.beds,
			occ: m.occ,
			vacant: m.beds - m.occ,
			occPct,
			vacPct: ratio(m.beds - m.occ, m.beds),
			finBeds: round(m.fin, 2),
			finPct: ratio(m.fin, m.beds),
			occWH: m.occWH,
			occUnit: m.occUnit,
			occBed: m.occBed,
			people: m.people,
			leases: activeLeases,
			excluded,
			mrev: round(m.mrev, 2),
			trev: round(m.trev, 2),
			rentBed: ratio(m.mrev, m.occ),
			rentPerson: ratio(m.mrev, m.people),
			hasPrior: !!hasPrior,
			pOcc: hasPrior ? m.pOcc : null,
			pVacant: hasPrior ? m.beds - m.pOcc : null,
			pOccPct,
			occDelta: hasPrior && occPct !== null && pOccPct !== null ? occPct - pOccPct : null,
			pFinPct: hasPrior ? ratio(m.pFin, m.beds) : null,
			pPeople: hasPrior ? m.pPeople : null,
			pLeases: hasPrior ? priorLeases : null,
			pMrev: hasPrior ? round(m.pMrev, 2) : null,
			pTrev: hasPrior ? round(m.pTrev, 2) : null,
			mrevYoY: hasPrior ? growth(m.mrev, m.pMrev) : null,
			pRentBed: hasPrior ? ratio(m.pMrev, m.pOcc) : null,
			rentBedYoY: hasPrior && m.occ > 0 && m.pOcc > 0 ? growth(m.mrev / m.occ, m.pMrev / m.pOcc) : null,
			ssBeds: hasPrior ? m.ssBeds : null,
			ssCur: hasPrior ? round(m.ssCur, 2) : null,
			ssPrior: hasPrior ? round(m.ssPrior, 2) : null,
			ssYoY: hasPrior ? growth(m.ssCur, m.ssPrior) : null,
			tgt: round(m.tgt, 2),
			tgtBeds: m.tgtBeds,
			tgtBed: ratio(m.tgt, m.tgtBeds),
			tgtOcc: round(m.tgtOcc, 2),
			tgtVacant: round(m.tgt - m.tgtOcc, 2),
			actVsTgt: m.tgtOcc > 0 ? m.mrevT / m.tgtOcc - 1 : null,
			settle: round(m.settle, 2),
			prevRentBed: ratio(m.prevRx, m.prevRb)
		};
	};

	// opts.pace = { basis, asOf, ayStart, priorAyStart } adds "same date last year" (LY leases dated on or before asOf,
	// shifted by the AY start difference) to every row.
	const summarize = (model, { fundKey, marketKey: market, pace: paceOpts } = {}) => {
		// Non-student rentals never enter the student numbers; they get their own block below.
		const inFilter = (prop) => !!prop && !!prop.marketKey &&
			(!fundKey || prop.fundKey === fundKey) && (!market || prop.marketKey === market);
		const inScope = (prop) => inFilter(prop) && !prop.segment;
		const unfiltered = !fundKey && !market;
		const hasPrior = !!model.prior;

		// A parent property record is a container for its child properties. When it carries no beds and no
		// leases of its own it is an empty row in the tree, so leave it out. Totals are unaffected: it is all zeros.
		const emptyParent = (r) => r.prop.isParent && !r.metrics.beds && !r.metrics.leaseIds.size && !r.metrics.excluded;
		const rows = model.propertyRows.filter((r) => inScope(r.prop) && !emptyParent(r));
		const leases = model.leaseResults.filter((r) => (r.prop ? inScope(r.prop) : unfiltered));
		const counted = leases.filter((r) => !r.reason);
		const excluded = leases.filter((r) => r.reason);
		const priorCounted = hasPrior ? model.prior.leaseResults.filter((r) => !r.reason && inScope(r.prop)) : [];

		const paceCut = (() => {
			if (!hasPrior || !paceOpts) return null;
			const a = parseDay(paceOpts.ayStart);
			const b = parseDay(paceOpts.priorAyStart);
			const t = parseDay(paceOpts.asOf);
			return a === null || b === null || t === null ? null : { shift: a - b, t, basis: paceOpts.basis || BASIS.EXEC };
		})();
		const priorPace = paceCut ? priorCounted.filter((l) => {
			const d = leaseDate(l, paceCut.basis);
			return d !== null && d + paceCut.shift <= paceCut.t;
		}) : null;
		const paceFor = (pred) => {
			if (!priorPace) return null;
			const list = priorPace.filter(pred);
			return { occ: list.reduce((s, l) => s + l.scopeBeds, 0), trev: list.reduce((s, l) => s + l.trev, 0), leases: list.length };
		};

		const funds = {};
		const total = newMetrics();
		const cells = {};
		rows.forEach((r) => {
			const fund = funds[r.prop.fundKey] || (funds[r.prop.fundKey] = { name: r.prop.fundLabel, metrics: newMetrics(), markets: {}, leases: 0 });
			const mk = fund.markets[r.prop.marketKey] || (fund.markets[r.prop.marketKey] = { name: r.prop.marketLabel, metrics: newMetrics(), props: [], leases: 0 });
			mk.props.push(r);
			addMetrics(mk.metrics, r.metrics);
			addMetrics(fund.metrics, r.metrics);
			addMetrics(total, r.metrics);
			const cell = cells[`${r.prop.fundKey}|${r.prop.marketKey}`] || (cells[`${r.prop.fundKey}|${r.prop.marketKey}`] = newMetrics());
			addMetrics(cell, r.metrics);
		});

		const tree = Object.values(funds).sort(byName).map((fund) => {
			const marketNodes = Object.values(fund.markets).sort(byName).map((mk) => {
				const propNodes = mk.props.map((r) => r.node).sort((a, b) => String(a.n).localeCompare(String(b.n), undefined, { numeric: true }));
				return toNode(mk.name, 1, mk.metrics, propNodes);
			});
			return toNode(fund.name, 0, fund.metrics, marketNodes);
		});

		const leasesFor = (predicate) => counted.filter(predicate).length;
		const excludedFor = (predicate) => excluded.filter(predicate).length;
		const priorFor = (predicate) => priorCounted.filter(predicate).length;
		const row = (name, m, pred) => kpiRow(name, m, leasesFor(pred), excludedFor((l) => l.prop && pred(l)), priorFor(pred), hasPrior, paceFor(pred));

		const portfolio = kpiRow('Total', total, counted.length, excluded.length, priorCounted.length, hasPrior, paceFor(() => true));

		const fundEntries = Object.entries(funds).sort((a, b) => byName(a[1], b[1]));
		const byFund = fundEntries.map(([key, fund]) => row(fund.name, fund.metrics, (l) => l.prop.fundKey === key));

		const marketTotals = {};
		rows.forEach((r) => {
			const mk = marketTotals[r.prop.marketKey] || (marketTotals[r.prop.marketKey] = { name: r.prop.marketLabel, metrics: newMetrics(), funds: {} });
			addMetrics(mk.metrics, r.metrics);
			mk.funds[r.prop.fundKey] = r.prop.fundLabel;
		});
		const marketEntries = Object.entries(marketTotals).sort((a, b) => byName(a[1], b[1]));
		const byMarket = marketEntries.map(([key, mk]) => row(mk.name, mk.metrics, (l) => l.prop.marketKey === key));

		const byFundTree = fundEntries.map(([key, fund]) => ({
			key,
			row: row(fund.name, fund.metrics, (l) => l.prop.fundKey === key),
			children: Object.entries(fund.markets).sort((a, b) => byName(a[1], b[1])).map(([mkey, mk]) =>
				row(mk.name, mk.metrics, (l) => l.prop.fundKey === key && l.prop.marketKey === mkey))
		}));
		const byMarketTree = marketEntries.map(([mkey, mk]) => ({
			key: mkey,
			row: row(mk.name, mk.metrics, (l) => l.prop.marketKey === mkey),
			children: Object.entries(mk.funds).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([fkey, flabel]) =>
				row(flabel, cells[`${fkey}|${mkey}`], (l) => l.prop.fundKey === fkey && l.prop.marketKey === mkey))
		}));

		const ssByType = {};
		rows.forEach((r) => Object.keys(r.ssByType || {}).forEach((t) => {
			const acc = ssByType[t] || (ssByType[t] = { beds: 0, cur: 0, prior: 0 });
			acc.beds += r.ssByType[t].beds;
			acc.cur += r.ssByType[t].cur;
			acc.prior += r.ssByType[t].prior;
		}));

		const byLeaseType = [LEASE_TYPE.WHOLE_HOUSE, LEASE_TYPE.UNIT, LEASE_TYPE.BEDROOM].map((type) => {
			const list = counted.filter((l) => l.type === type);
			const occ = list.reduce((s, l) => s + l.scopeBeds, 0);
			const fin = list.reduce((s, l) => s + (l.scopeBeds * Math.min(l.months, 12)) / 12, 0);
			const people = list.reduce((s, l) => s + l.people, 0);
			const mrev = list.reduce((s, l) => s + l.mrev, 0);
			const trev = list.reduce((s, l) => s + l.trev, 0);
			const plist = priorCounted.filter((l) => l.type === type);
			const pOcc = plist.reduce((s, l) => s + l.scopeBeds, 0);
			const pMrev = plist.reduce((s, l) => s + l.mrev, 0);
			const pTrev = plist.reduce((s, l) => s + l.trev, 0);
			const tp = paceFor((l) => l.type === type);
			const ss = ssByType[type] || { beds: 0, cur: 0, prior: 0 };
			const occPct = ratio(occ, total.beds);
			const pOccPct = hasPrior ? ratio(pOcc, total.beds) : null;
			return {
				name: LEASE_TYPE_LABEL[type],
				occ,
				occShare: ratio(occ, total.occ),
				occPct,
				finBeds: round(fin, 2),
				finPct: ratio(fin, total.beds),
				leases: list.length,
				people,
				mrev: round(mrev, 2),
				trev: round(trev, 2),
				rentBed: ratio(mrev, occ),
				rentPerson: ratio(mrev, people),
				excluded: excluded.filter((l) => l.type === type).length,
				hasPrior,
				pOcc: hasPrior ? pOcc : null,
				pOccPct,
				occDelta: hasPrior && occPct !== null && pOccPct !== null ? occPct - pOccPct : null,
				pLeases: hasPrior ? plist.length : null,
				pMrev: hasPrior ? round(pMrev, 2) : null,
				mrevYoY: hasPrior ? growth(mrev, pMrev) : null,
				pTrev: hasPrior ? round(pTrev, 2) : null,
				trevYoY: hasPrior ? growth(trev, pTrev) : null,
				lyWkOcc: tp ? tp.occ : null,
				lyWkOccPct: tp ? ratio(tp.occ, total.beds) : null,
				lyWkDelta: tp && occPct !== null ? occPct - ratio(tp.occ, total.beds) : null,
				lyWkTrev: tp ? round(tp.trev, 2) : null,
				trevPace: tp ? growth(trev, tp.trev) : null,
				pRentBed: hasPrior ? ratio(pMrev, pOcc) : null,
				ssBeds: hasPrior ? ss.beds : null,
				ssCur: hasPrior ? round(ss.cur, 2) : null,
				ssPrior: hasPrior ? round(ss.prior, 2) : null,
				ssYoY: hasPrior ? growth(ss.cur, ss.prior) : null
			};
		});

		const leasePeople = counted.reduce((s, l) => s + l.people, 0);
		const leaseMrev = counted.reduce((s, l) => s + l.mrev, 0);
		const leaseTrev = counted.reduce((s, l) => s + l.trev, 0);
		// Where a bed carries sequential tenancies, headcount and monthly rent deliberately do not add up: the bed
		// holds one person at a time, and the two rents never run together. Measure exactly how much that accounts
		// for, so the tie stays a real check on nothing going missing by accident.
		const seenLeaf = new Set();
		const stacked = { people: 0, mrev: 0, beds: 0, leaves: 0 };
		counted.forEach((l) => (l.leaves || []).forEach((leaf) => {
			if (seenLeaf.has(leaf) || !leaf.alloc || leaf.alloc.length < 2) return;
			seenLeaf.add(leaf);
			const mo = leaf.alloc.reduce((t, a) => t + a.months, 0);
			const avg = mo > 0 ? leaf.alloc.reduce((t, a) => t + a.mrev * a.months, 0) / mo : 0;
			stacked.people += leaf.alloc.reduce((t, a) => t + a.people, 0) - Math.max(...leaf.alloc.map((a) => a.people));
			stacked.mrev += leaf.alloc.reduce((t, a) => t + a.mrev, 0) - avg;
			stacked.beds += leaf.beds;
			stacked.leaves += 1;
		}));
		const ties = {
			people: leasePeople - stacked.people === total.people,
			mrev: Math.abs(leaseMrev - stacked.mrev - total.mrev) < 0.05,
			trev: Math.abs(leaseTrev - total.trev) < 0.05
		};

		const byReason = REASONS.map((reason) => {
			const list = excluded.filter((l) => l.reason === reason.code);
			return {
				code: reason.code,
				label: reason.label,
				meaning: reason.meaning,
				fix: REASON_FIX[reason.code] || '',
				leases: list.length,
				people: list.reduce((s, l) => s + l.people, 0),
				beds: list.reduce((s, l) => s + (l.scopeBeds || 0), 0),
				mrev: round(list.reduce((s, l) => s + l.mrev, 0), 2),
				trev: round(list.reduce((s, l) => s + (l.trev || 0), 0), 2)
			};
		});

		const byProp = {};
		const byUnit = {};
		const byBed = {};
		model.leaseResults.forEach((r) => {
			if (!r.prop) return;
			(byProp[r.prop.id] = byProp[r.prop.id] || []).push(r);
			if (r.unit) (byUnit[r.unit.id] = byUnit[r.unit.id] || []).push(r);
			if (r.bedroom) (byBed[r.bedroom.id] = byBed[r.bedroom.id] || []).push(r);
		});
		const relatedOf = (l) => {
			const P = l.prop ? byProp[l.prop.id] || [] : [];
			const U = l.unit ? byUnit[l.unit.id] || [] : [];
			const B = l.bedroom ? byBed[l.bedroom.id] || [] : [];
			const pools = {
				WH_MULTI: P.filter((r) => r.type === LEASE_TYPE.WHOLE_HOUSE),
				WH_PLUS: P.filter((r) => r.type !== LEASE_TYPE.WHOLE_HOUSE),
				PROP_HAS_WH: P.filter((r) => r.type === LEASE_TYPE.WHOLE_HOUSE && !r.linkedId),
				MULTI_UNIT: U.filter((r) => r.scope === 'U'),
				UNIT_PLUS_BED: U.filter((r) => r.type === LEASE_TYPE.BEDROOM),
				UNIT_HAS: U.filter((r) => r.scope === 'U'),
				MULTI_BED: B
			};
			return (pools[l.reason] || []).filter((r) => r.id !== l.id).slice(0, 6).map((r) => ({ kind: 'lease', id: r.id, name: r.name }));
		};

		const exceptions = excluded.map((l) => ({
			id: l.id,
			name: l.name,
			fund: l.prop ? l.prop.fundLabel : '',
			market: l.prop ? l.prop.marketLabel : '',
			property: l.prop ? l.prop.name : '',
			linked: l.linkedName,
			type: l.typeLabel,
			people: l.people,
			months: round(l.months, 1),
			mrev: l.mrev,
			// What this exclusion is costing: the beds the lease would have claimed and its full contract value.
			beds: l.scopeBeds || 0,
			trev: l.trev || 0,
			reason: REASON_BY_CODE[l.reason].label,
			reasonCode: l.reason,
			fix: REASON_FIX[l.reason] || '',
			related: relatedOf(l)
		})).sort((a, b) => a.reason.localeCompare(b.reason) || String(a.property).localeCompare(String(b.property), undefined, { numeric: true }));

		const dataQuality = model.dataQuality
			.filter((d) => (d.prop ? (inScope(d.prop) || !d.prop.marketKey) : unfiltered))
			.map((d) => ({
				issue: d.issue,
				fund: d.prop ? d.prop.fundLabel : '',
				market: d.prop ? d.prop.marketLabel : '',
				property: d.prop ? d.prop.name : '',
				record: d.record,
				recordId: d.recordId || null,
				kind: d.kind || null,
				handling: d.handling,
				fix: DQ_FIX[d.issue] || ''
			}));

		// Short-term rentals. Real beds, so the usual metrics apply - just never mixed into student pre-leasing.
		const strRows = model.propertyRows.filter((r) => inFilter(r.prop) && r.prop.segment === 'str' && !emptyParent(r));
		const strLeases = model.leaseResults.filter((r) => r.prop && inFilter(r.prop) && r.prop.segment === 'str');
		const strCounted = strLeases.filter((r) => !r.reason);
		const strExcluded = strLeases.filter((r) => r.reason);
		const strTotal = newMetrics();
		strRows.forEach((r) => addMetrics(strTotal, r.metrics));
		const countFor = (list, id) => list.filter((l) => l.prop.id === id).length;
		const shortTerm = {
			properties: strRows.length,
			leases: strCounted.length,
			excluded: strExcluded.length,
			total: kpiRow('Short-term rentals', strTotal, strCounted.length, strExcluded.length, 0, hasPrior, null),
			rows: strRows.map((r) => Object.assign(
				kpiRow(r.prop.name, r.metrics, countFor(strCounted, r.prop.id), countFor(strExcluded, r.prop.id), 0, hasPrior, null),
				{ id: r.prop.id, market: r.prop.marketLabel, fund: r.prop.fundLabel }
			)).sort((a, b) => String(a.market).localeCompare(String(b.market)) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
		};

		// Commercial, land and office. Rent only. No beds, so nothing here reaches the occupancy denominator and no
		// per-bed figure is offered. Total Rent on these records is an ANNUAL figure, not the contract value (a
		// three-year commercial lease carries twelve months in it), so the annual column is monthly x 12 and the
		// stored total is deliberately ignored.
		const otherProps = model.propertyRows.filter((r) => inFilter(r.prop) && r.prop.segment === 'other');
		const otherLeases = model.leaseResults.filter((r) => r.prop && inFilter(r.prop) && r.prop.segment === 'other');
		const otherRows = otherProps.map((r) => {
			const mine = otherLeases.filter((l) => l.prop.id === r.prop.id);
			const monthly = mine.reduce((t, l) => t + l.mrev, 0);
			return {
				id: r.prop.id,
				name: r.prop.name,
				market: r.prop.marketLabel,
				fund: r.prop.fundLabel,
				leases: mine.length,
				status: mine.length ? 'Leased' : 'Vacant',
				monthly: round(monthly, 2),
				annual: round(monthly * 12, 2),
				start: mine.reduce((d, l) => (l.start && (!d || l.start < d) ? l.start : d), null),
				end: mine.reduce((d, l) => (l.end && (!d || l.end > d) ? l.end : d), null)
			};
		}).sort((a, b) => String(a.market).localeCompare(String(b.market)) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
		const otherMonthly = otherRows.reduce((t, r) => t + r.monthly, 0);
		const other = {
			properties: otherRows.length,
			leased: otherRows.filter((r) => r.leases).length,
			vacant: otherRows.filter((r) => !r.leases).length,
			leases: otherLeases.length,
			monthly: round(otherMonthly, 2),
			annual: round(otherMonthly * 12, 2),
			rows: otherRows
		};

		return {
			tree,
			totalNode: toNode('Total', -1, total),
			portfolio,
			shortTerm,
			other,
			byLeaseType,
			byFund,
			byMarket,
			byFundTree,
			byMarketTree,
			byReason,
			ties,
			stacked,
			exceptions,
			dataQuality,
			sameStore: model.sameStore,
			hasPrior,
			paceAsOf: paceCut ? paceOpts.asOf : null,
			propertyCount: rows.length,
			inScopeLeases: leases.length
		};
	};

	// ---------- academic years, basis, dates ----------

	// A lease with no status is not a lease yet. The pipeline's "Create lease record" writes one
	// deliberately statusless so terms can be captured without the beds landing in pre-leasing, and
	// the same rule retires the older blank-status records that used to count on the pro-forma basis.
	// Setting the status - In Process when it goes out, Fully Executed when it comes back signed - is
	// what puts a lease into the numbers. Exceptions still lists every blank one so they can be found.
	const hasStatus = (lease) => {
		const st = toKey(lease.status);
		return st === LEASE_STATUS.EXECUTED || st === LEASE_STATUS.IN_PROCESS;
	};
	const inBasis = (lease, basis) => hasStatus(lease) && (basis === BASIS.PRO_FORMA || toKey(lease.status) === LEASE_STATUS.EXECUTED);

	const sortYears = (years) => [...years].sort((a, b) => String(a.start_date || a.name).localeCompare(String(b.start_date || b.name)));

	const priorYearOf = (years, ayId) => {
		const list = sortYears(years);
		const i = list.findIndex((y) => String(y.id) === String(ayId));
		return i > 0 ? list[i - 1] : null;
	};

	const leaseDate = (lease, basis) => parseDay(basis === BASIS.PRO_FORMA ? (lease.sent || lease.signed) : lease.signed);

	const scopeFilter = (fundKey, market) => (prop) => !!prop && !!prop.marketKey &&
		(!fundKey || prop.fundKey === fundKey) && (!market || prop.marketKey === market);

	// ---------- weekly report ----------

	const weekly = (model, opts) => {
		const basis = opts.basis || BASIS.EXEC;
		const inScope = scopeFilter(opts.fundKey, opts.marketKey);
		const today = parseDay(opts.today);
		const curMonday = mondayOf(today);
		let week = parseDay(opts.week);
		week = week === null ? curMonday : Math.min(mondayOf(week), curMonday);
		const weekEnd = week + 6 * DAY;
		const prevEnd = weekEnd - 7 * DAY;
		const totalBeds = num(opts.totalBeds);
		const ayStart = parseDay(opts.ayStart);
		const priorStart = parseDay(opts.priorAyStart);
		const offset = ayStart !== null && priorStart !== null ? ayStart - priorStart : null;
		const hasLy = !!model.prior && offset !== null;
		// One LY alignment for the whole weekly tab: the AY-start gap rounded to whole weeks, so a
		// Monday-to-Sunday week lines up with a Monday-to-Sunday week.
		const lyShift = hasLy ? Math.round(offset / (7 * DAY)) * 7 * DAY : null;

		const counted = model.leaseResults.filter((r) => !r.reason && inScope(r.prop));
		const dated = [];
		const undated = [];
		counted.forEach((r) => {
			const d = leaseDate(r, basis);
			if (d === null) undated.push(r); else dated.push({ d, r });
		});
		dated.sort((a, b) => a.d - b.d);
		const finOf = (r) => (r.scopeBeds * Math.min(r.months, 12)) / 12;

		// Prior-AY counted leases, dates shifted onto this AY's calendar (same point in the leasing cycle).
		const priorDated = [];
		if (hasLy) {
			model.prior.leaseResults.forEach((r) => {
				if (r.reason || !inScope(r.prop)) return;
				const d = leaseDate(r, basis);
				if (d !== null) priorDated.push({ d: d + offset, r });
			});
			priorDated.sort((a, b) => a.d - b.d);
		}

		const firstMonday = dated.length ? mondayOf(dated[0].d) : week;
		const startMonday = Math.max(Math.min(firstMonday, week), week - 155 * 7 * DAY);
		const history = [];
		let i = 0;
		let j = 0;
		const cum = { leases: 0, beds: 0, fin: 0, mrev: 0, trev: 0 };
		const pcum = { leases: 0, beds: 0, mrev: 0, trev: 0 };
		while (i < dated.length && dated[i].d < startMonday) {
			const r = dated[i].r;
			cum.leases++; cum.beds += r.scopeBeds; cum.fin += finOf(r); cum.mrev += r.mrev; cum.trev += r.trev; i++;
		}
		while (j < priorDated.length && priorDated[j].d < startMonday) {
			const r = priorDated[j].r;
			pcum.leases++; pcum.beds += r.scopeBeds; pcum.mrev += r.mrev; pcum.trev += r.trev; j++;
		}
		for (let w = startMonday; w <= week; w += 7 * DAY) {
			const end = w + 6 * DAY;
			const add = { leases: 0, beds: 0, mrev: 0, trev: 0 };
			const ladd = { leases: 0, beds: 0, mrev: 0, trev: 0 };
			while (i < dated.length && dated[i].d <= end) {
				const r = dated[i].r;
				add.leases++; add.beds += r.scopeBeds; add.mrev += r.mrev; add.trev += r.trev;
				cum.leases++; cum.beds += r.scopeBeds; cum.fin += finOf(r); cum.mrev += r.mrev; cum.trev += r.trev; i++;
			}
			while (j < priorDated.length && priorDated[j].d <= end) {
				const r = priorDated[j].r;
				ladd.leases++; ladd.beds += r.scopeBeds; ladd.mrev += r.mrev; ladd.trev += r.trev;
				pcum.leases++; pcum.beds += r.scopeBeds; pcum.mrev += r.mrev; pcum.trev += r.trev; j++;
			}
			history.push({
				week: fmtDay(w), weekEnd: fmtDay(end),
				newLeases: add.leases, newBeds: add.beds, newMrev: round(add.mrev, 2), newTrev: round(add.trev, 2),
				leases: cum.leases, occ: cum.beds, occPct: ratio(cum.beds, totalBeds), fin: round(cum.fin, 2), finPct: ratio(cum.fin, totalBeds),
				mrev: round(cum.mrev, 2), trev: round(cum.trev, 2),
				lyOcc: hasLy ? pcum.beds : null,
				lyOccPct: hasLy ? ratio(pcum.beds, totalBeds) : null,
				lyMrev: hasLy ? round(pcum.mrev, 2) : null,
				lyTrev: hasLy ? round(pcum.trev, 2) : null,
				lyLeases: hasLy ? pcum.leases : null,
				lyNewLeases: hasLy ? ladd.leases : null,
				lyNewBeds: hasLy ? ladd.beds : null,
				lyNewTrev: hasLy ? round(ladd.trev, 2) : null
			});
		}
		history.forEach((h, k) => {
			const p = history[k - 1];
			h.dOcc = p ? h.occ - p.occ : null;
			h.dOccPct = p && h.occPct !== null && p.occPct !== null ? h.occPct - p.occPct : null;
			h.dMrev = p ? round(h.mrev - p.mrev, 2) : null;
			h.dTrev = p ? round(h.trev - p.trev, 2) : null;
			h.vsLyPct = h.lyOccPct !== null && h.occPct !== null ? h.occPct - h.lyOccPct : null;
		});
		const sel = history[history.length - 1];
		const prev = history.length > 1 ? history[history.length - 2] : null;

		// LY line beyond the selected week (to 4 weeks past this AY's start) for the pace chart.
		const ahead = [];
		if (hasLy && ayStart !== null) {
			const stop = Math.min(Math.max(mondayOf(ayStart) + 4 * 7 * DAY, week + 4 * 7 * DAY), week + 70 * 7 * DAY);
			let beds = pcum.beds;
			let jj = j;
			for (let w = week + 7 * DAY; w <= stop; w += 7 * DAY) {
				const end = w + 6 * DAY;
				while (jj < priorDated.length && priorDated[jj].d <= end) { beds += priorDated[jj].r.scopeBeds; jj++; }
				ahead.push([fmtDay(w), ratio(beds, totalBeds)]);
			}
		}

		const inWeek = (d) => d !== null && d >= week && d <= weekEnd;
		const asOf = Math.min(today, weekEnd);
		const propById = {};
		model.propertyRows.forEach((r) => { propById[r.prop.id] = r.prop; });
		const propOf = (l) => propById[toKey(l.property_id)] || null;
		// hasStatus here too: a statusless lease is out of every weekly section, not just the KPIs.
		// leaseQuality and tenantQuality still receive the unfiltered set, so blanks stay findable.
		const ayLeases = (opts.ayLeases || []).filter((l) => hasStatus(l) && inScope(propOf(l)));
		const priorAyLeases = (opts.priorAyLeases || []).filter((l) => hasStatus(l) && inScope(propOf(l)));
		// How well the prior AY carries Lease Sent Dates. Below half, anything dated by "sent" is a floor.
		const lyPriorSigned = hasLy ? priorAyLeases.filter((l) => l.signed_date).length : 0;
		const lyPriorSent = hasLy ? priorAyLeases.filter((l) => l.sent_date).length : 0;
		const lySentThin = hasLy && lyPriorSent < 0.5 * lyPriorSigned;
		const sentCoverage = { sent: lyPriorSent, signed: lyPriorSigned, thin: lySentThin };
		let priorResultById = {};

		const resultById = {};
		model.leaseResults.forEach((r) => { resultById[r.id] = r; });
		// Last year for one lease = the same unit / bedroom records in the prior AY, if they were leased then.
		const priorLeaves = (model.prior && model.prior.leafByKey) || null;
		const lyOf = (r) => {
			if (!priorLeaves || !r || r.reason || !r.leaves) return null;
			let beds = 0;
			let mrev = 0;
			let hit = 0;
			r.leaves.forEach((leaf) => {
				const pl = priorLeaves[leafKey(leaf)];
				if (pl && pl.lease) { beds += pl.beds; mrev += pl.mrev; hit++; }
			});
			return hit ? { beds, mrev: round(mrev, 2), rentBed: beds > 0 ? round(mrev / beds, 2) : null, partial: hit < r.leaves.length } : null;
		};
		const leaseRow = (l) => {
			const p = propOf(l);
			const r = resultById[String(l.id)];
			const beds = r && !r.reason ? r.scopeBeds : null;
			const mrev = num(l.monthly_rent);
			const ly = lyOf(r);
			const rentBed = beds > 0 ? round(mrev / beds, 2) : null;
			return {
				id: String(l.id), name: l.name, fund: p ? p.fundLabel : '', market: p ? p.marketLabel : '', property: p ? p.name : '',
				linked: l.unit_name ? leafName(l.unit_name) : '', type: LEASE_TYPE_LABEL[toKey(l.lease_type)] || 'Unknown',
				beds, people: num(l.tenants), mrev, trev: r && !r.reason ? r.trev : null, rentBed,
				lyBeds: ly ? ly.beds : null, lyMrev: ly ? ly.mrev : null, lyRentBed: ly ? ly.rentBed : null,
				lyPartial: ly ? !!ly.partial : false,
				rentBedPct: ly && ly.rentBed > 0 && rentBed !== null ? rentBed / ly.rentBed - 1 : null,
				sent: l.sent_date || null, signed: l.signed_date || null,
				note: r && r.reason ? `Excluded: ${REASON_BY_CODE[r.reason].label}` : ''
			};
		};
		// Totals for a lease list, with the same-unit prior-AY figures beside them.
		const rollup = (list) => {
			const t = { leases: list.length, beds: 0, mrev: 0, trev: 0, lyLeases: 0, lyBeds: 0, lyMrev: 0 };
			list.forEach((r) => {
				t.beds += num(r.beds); t.mrev += num(r.mrev); t.trev += num(r.trev);
				if (r.lyRentBed !== null && r.lyRentBed !== undefined) { t.lyLeases++; t.lyBeds += num(r.lyBeds); t.lyMrev += num(r.lyMrev); }
			});
			t.mrev = round(t.mrev, 2); t.trev = round(t.trev, 2); t.lyMrev = round(t.lyMrev, 2);
			t.rentBed = t.beds > 0 ? round(t.mrev / t.beds, 2) : null;
			t.lyRentBed = t.lyBeds > 0 ? round(t.lyMrev / t.lyBeds, 2) : null;
			t.rentBedPct = t.lyRentBed > 0 && t.rentBed !== null ? t.rentBed / t.lyRentBed - 1 : null;
			t.bedsPct = t.lyBeds > 0 ? t.beds / t.lyBeds - 1 : null;
			return t;
		};

		// A lease is in process at a cutoff when it was sent on/before it and not signed by then.
		const openAt = (l, end, shift) => {
			const sent = parseDay(l.sent_date);
			const signed = parseDay(l.signed_date);
			if (sent === null || sent + shift > end) return false;
			return signed === null ? toKey(l.status) === LEASE_STATUS.IN_PROCESS : signed + shift > end;
		};
		const inProcess = [];
		ayLeases.forEach((l) => {
			const noSentDate = parseDay(l.sent_date) === null && toKey(l.status) === LEASE_STATUS.IN_PROCESS && week === curMonday;
			if (!openAt(l, weekEnd, 0) && !noSentDate) return;
			const row = leaseRow(l);
			const sent = parseDay(l.sent_date);
			row.days = sent === null ? null : Math.round((asOf - sent) / DAY);
			if (noSentDate) row.note = 'No Lease Sent Date';
			inProcess.push(row);
		});
		inProcess.sort((a, b) => (b.days === null ? -1 : b.days) - (a.days === null ? -1 : a.days));
		const pipeline = {
			now: inProcess.filter((r) => r.days !== null).length,
			noSent: inProcess.filter((r) => r.days === null).length,
			over21: inProcess.filter((r) => r.days !== null && r.days > 21).length,
			prev: ayLeases.filter((l) => openAt(l, prevEnd, 0)).length,
			// LY only when the prior AY actually recorded Lease Sent Dates (imported leases often have none).
			ly: hasLy ? priorAyLeases.filter((l) => openAt(l, weekEnd, lyShift)).length : null,
			lyThin: lySentThin
		};

		const byProp = (a, b) => String(a.property).localeCompare(String(b.property), undefined, { numeric: true });
		const executed = ayLeases
			.filter((l) => toKey(l.status) === LEASE_STATUS.EXECUTED && inWeek(parseDay(l.signed_date)))
			.map(leaseRow)
			.sort((a, b) => String(a.signed).localeCompare(String(b.signed)) || byProp(a, b));
		const sentThisWeek = ayLeases
			.filter((l) => inWeek(parseDay(l.sent_date)))
			.map(leaseRow)
			.sort((a, b) => String(a.sent).localeCompare(String(b.sent)) || byProp(a, b));

		// Same week of the prior AY, shifted by whole weeks, for the two section headers.
		if (hasLy) model.prior.leaseResults.forEach((r) => { priorResultById[r.id] = r; });
		const priorWeek = (dateOf) => {
			if (!hasLy) return null;
			const rows = priorAyLeases.filter((l) => {
				const d = parseDay(dateOf(l));
				return d !== null && d + lyShift >= week && d + lyShift <= weekEnd;
			}).map((l) => {
				const r = priorResultById[String(l.id)];
				const beds = r && !r.reason ? r.scopeBeds : null;
				return { beds, mrev: num(l.monthly_rent), trev: r && !r.reason ? r.trev : null };
			});
			const t = { leases: rows.length, beds: 0, mrev: 0, trev: 0 };
			rows.forEach((r) => { t.beds += num(r.beds); t.mrev += num(r.mrev); t.trev += num(r.trev); });
			t.mrev = round(t.mrev, 2); t.trev = round(t.trev, 2);
			t.rentBed = t.beds > 0 ? round(t.mrev / t.beds, 2) : null;
			return t;
		};
		// Prior-AY leases still in process at the same point of last year's week.
		const priorOpen = () => {
			if (!hasLy) return null;
			const t = { leases: 0, beds: 0, mrev: 0, trev: 0 };
			priorAyLeases.forEach((l) => {
				if (!openAt(l, weekEnd, lyShift)) return;
				const r = priorResultById[String(l.id)];
				t.leases++;
				t.beds += r && !r.reason ? r.scopeBeds : 0;
				t.mrev += num(l.monthly_rent);
				t.trev += r && !r.reason ? r.trev : 0;
			});
			t.mrev = round(t.mrev, 2); t.trev = round(t.trev, 2);
			t.rentBed = t.beds > 0 ? round(t.mrev / t.beds, 2) : null;
			return t;
		};
		const sectionYoY = (list, dateOf, needsSent, lyRows) => {
			const ty = rollup(list);
			const ly = lyRows ? lyRows() : priorWeek(dateOf);
			return {
				ty, ly,
				dLeases: ly ? ty.leases - ly.leases : null,
				dBeds: ly ? ty.beds - ly.beds : null,
				leasesPct: ly && ly.leases > 0 ? ty.leases / ly.leases - 1 : null,
				bedsPct: ly && ly.beds > 0 ? ty.beds / ly.beds - 1 : null,
				rentBedPct: ly && ly.rentBed > 0 && ty.rentBed !== null ? ty.rentBed / ly.rentBed - 1 : null,
				dRentBed: ly && ly.rentBed !== null && ty.rentBed !== null ? round(ty.rentBed - ly.rentBed, 2) : null,
				trevPct: ly && ly.trev > 0 ? ty.trev / ly.trev - 1 : null
			};
		};

		// Breakdown for the selected week: by market, or by fund when a single market is selected.
		const groupKey = opts.groupBy === 'fund' ? (p) => p.fundLabel : (p) => p.marketLabel;
		const groups = {};
		const grp = (p) => {
			const k = groupKey(p);
			return groups[k] || (groups[k] = { name: k, beds: 0, occ: 0, prevOcc: 0, lyOcc: 0, newBeds: 0, newLeases: 0, lyNewBeds: 0, trev: 0, lyTrev: 0, inProcess: 0 });
		};
		model.propertyRows.forEach((r) => { if (inScope(r.prop)) grp(r.prop).beds += r.metrics.beds; });
		dated.forEach(({ d, r }) => {
			if (d > weekEnd) return;
			const g = grp(r.prop);
			g.occ += r.scopeBeds; g.trev += r.trev;
			if (d <= prevEnd) g.prevOcc += r.scopeBeds;
			if (d >= week) { g.newBeds += r.scopeBeds; g.newLeases++; }
		});
		priorDated.forEach(({ d, r }) => {
			if (d > weekEnd) return;
			const g = grp(r.prop);
			g.lyOcc += r.scopeBeds; g.lyTrev += r.trev;
			if (d >= week) g.lyNewBeds += r.scopeBeds;
		});
		ayLeases.forEach((l) => { if (openAt(l, weekEnd, 0)) grp(propOf(l)).inProcess++; });
		const byGroup = Object.values(groups).filter((g) => g.beds > 0 || g.occ > 0).map((g) => Object.assign(g, {
			trev: round(g.trev, 2), lyTrev: hasLy ? round(g.lyTrev, 2) : null,
			occPct: ratio(g.occ, g.beds), prevOccPct: ratio(g.prevOcc, g.beds),
			lyOccPct: hasLy ? ratio(g.lyOcc, g.beds) : null, lyOcc: hasLy ? g.lyOcc : null, lyNewBeds: hasLy ? g.lyNewBeds : null,
			dOccPct: g.beds > 0 ? (g.occ - g.prevOcc) / g.beds : null,
			vsLyPct: hasLy && g.beds > 0 ? (g.occ - g.lyOcc) / g.beds : null,
			trevPace: hasLy ? growth(g.trev, g.lyTrev) : null
		})).sort((a, b) => String(a.name).localeCompare(String(b.name)));

		const ayName = {};
		(opts.academicYears || []).forEach((y) => { ayName[String(y.id)] = y.name; });
		const inactivated = (opts.inactivations || [])
			.filter((e) => inWeek(parseDay(e.changed)))
			.filter((e) => opts.fundKey || opts.marketKey ? inScope(propOf(e)) : true)
			.map((e) => {
				const row = leaseRow(e);
				row.ay = ayName[toKey(e.ay)] || '';
				row.changed = e.changed;
				row.changedBy = e.changed_by || '';
				row.stillInactive = e.inactive_now !== 'F';
				row.note = '';
				return row;
			})
			.sort((a, b) => String(b.changed).localeCompare(String(a.changed)));

		const firstSeen = [];
		(opts.ayLeases || []).filter(hasStatus).forEach((l) => {
			[l.signed_date, l.sent_date].forEach((s) => { const d = parseDay(s); if (d !== null) firstSeen.push(d); });
		});
		const earliest = firstSeen.length ? Math.max(mondayOf(Math.min.apply(null, firstSeen)), curMonday - 155 * 7 * DAY) : curMonday - 25 * 7 * DAY;
		const weekOptions = [];
		for (let w = curMonday; w >= earliest; w -= 7 * DAY) weekOptions.push({ value: fmtDay(w), label: `${fmtUs(w)} – ${fmtUs(w + 6 * DAY)}` });

		// ---- To-date comparisons: this week, this month and this academic year, each against the same
		// elapsed days of the prior AY. The LY shift is the AY-start gap rounded to whole weeks, so a
		// Monday-to-Sunday week lines up with a Monday-to-Sunday week last year.
		const cmpAsOf = Math.min(today, weekEnd);
		const monthStart = parseDay(fmtDay(cmpAsOf).slice(0, 8) + '01');
		const priorRaw = [];
		if (hasLy) {
			model.prior.leaseResults.forEach((r) => {
				if (r.reason || !inScope(r.prop)) return;
				const d = leaseDate(r, basis);
				if (d !== null) priorRaw.push({ d, r });
			});
		}
		const span = (rows, from, to) => {
			const o = { beds: 0, leases: 0, trev: 0, mrev: 0 };
			rows.forEach((x) => { if ((from === null || x.d >= from) && x.d <= to) { o.beds += x.r.scopeBeds; o.leases++; o.trev += x.r.trev; o.mrev += x.r.mrev; } });
			o.trev = round(o.trev, 2); o.mrev = round(o.mrev, 2);
			o.occPct = ratio(o.beds, totalBeds);
			return o;
		};
		const pair = (label, from, to, cumulative) => {
			const ty = span(dated, from, to);
			const ly = hasLy ? span(priorRaw, from === null ? null : from - lyShift, to - lyShift) : null;
			return {
				label, from: from === null ? null : fmtDay(from), to: fmtDay(to),
				lyFrom: hasLy && from !== null ? fmtDay(from - lyShift) : null, lyTo: hasLy ? fmtDay(to - lyShift) : null,
				cumulative: !!cumulative, ty, ly,
				d: ly ? { beds: ty.beds - ly.beds, leases: ty.leases - ly.leases, trev: round(ty.trev - ly.trev, 2), occPts: ty.occPct !== null && ly.occPct !== null ? ty.occPct - ly.occPct : null } : null,
				pct: ly ? {
					beds: ly.beds > 0 ? ty.beds / ly.beds - 1 : null,
					leases: ly.leases > 0 ? ty.leases / ly.leases - 1 : null,
					trev: ly.trev > 0 ? ty.trev / ly.trev - 1 : null
				} : null
			};
		};
		const cmp = {
			hasLy, lyShiftDays: hasLy ? Math.round(lyShift / DAY) : null, asOf: fmtDay(cmpAsOf),
			undatedBeds: undated.reduce((a, r) => a + r.scopeBeds, 0), undatedLeases: undated.length, countedBeds: cum.beds,
			partial: week === curMonday && cmpAsOf < weekEnd,
			week: pair('This week to date', week, cmpAsOf, false),
			month: pair('This month to date', monthStart, cmpAsOf, false),
			year: pair('This academic year to date', null, cmpAsOf, true)
		};
		// The same three windows one week earlier, so every tile can show movement since last week as
		// well as against last year. Added as new keys: nothing already on the tab reads them.
		const pwMonthStart = parseDay(fmtDay(prevEnd).slice(0, 8) + '01');
		cmp.pw = {
			week: pair('Prior week', week - 7 * DAY, prevEnd, false),
			month: pair('Month to prior week end', pwMonthStart, prevEnd, false),
			year: pair('Academic year to prior week end', null, prevEnd, true)
		};

		return {
			basis, week: fmtDay(week), weekEnd: fmtDay(weekEnd), isCurrent: week === curMonday, weekOptions,
			totalBeds, history, sel, prev, hasPrior: hasLy, groupBy: opts.groupBy === 'fund' ? 'fund' : 'market', byGroup, pipeline,
			lyWeek: hasLy ? fmtDay(week - offset) : null, lyWeekEnd: hasLy ? fmtDay(weekEnd - offset) : null, cmp,
			chart: { pts: history.slice(-60).map((h) => [h.week, h.occPct, h.lyOccPct]), ahead, ayStart: opts.ayStart || null },
			undated: { leases: undated.length, beds: undated.reduce((s, r) => s + r.scopeBeds, 0), mrev: round(undated.reduce((s, r) => s + r.mrev, 0), 2) },
			inProcess, executed, inactivated, sentThisWeek,
			sentYoY: Object.assign(sectionYoY(sentThisWeek, (l) => l.sent_date), { sentBased: true, coverage: sentCoverage, volumeThin: lySentThin }),
			execYoY: sectionYoY(executed, (l) => l.signed_date),
			inProcessYoY: Object.assign(sectionYoY(inProcess, null, false, priorOpen), { sentBased: true, coverage: sentCoverage, volumeThin: lySentThin })
		};
	};

	// Counted leases per AY and basis for the velocity chart (client aggregates by filter):
	// row = [ayIndex, daysFromAyStart, beds, monthlyRent, fundKey, marketKey, leaseType]

	// ---- Pipeline: one row per leasable unit, built from the SAME leaves the KPIs are built from ----
	// The denominator is not negotiable. These rows come out of model.propertyRows, so the parent-property guard,
	// the bedroom-vs-unit leaf rule, the blank-City drop and the non-student segment split all apply here exactly
	// as they do on Summary. A unit's beds is the sum of its leaves, never the unit's own typed Number of Beds:
	// where a unit has bedroom records those are the leaves and the typed field is only a cross-check.
	const pipelineUnits = (model, { fundKey, marketKey: market } = {}) => {
		const inScope = (prop) => !!prop && !!prop.marketKey && !prop.segment
			&& (!fundKey || prop.fundKey === fundKey) && (!market || prop.marketKey === market);
		const emptyParent = (r) => r.prop.isParent && !r.metrics.beds && !r.metrics.leaseIds.size && !r.metrics.excluded;
		const rows = [];
		model.propertyRows.filter((r) => inScope(r.prop) && !emptyParent(r)).forEach((r) => {
			const prop = r.prop;
			const base = {
				propertyId: prop.id, property: prop.name,
				marketKey: prop.marketKey, marketLabel: prop.marketLabel,
				fundKey: prop.fundKey, fundLabel: prop.fundLabel
			};
			prop.units.forEach((unit) => {
				// The lease covering this unit, read off the leaves rather than off the status
				// record. The status record only learns about a lease when AD_UE_Lease_Stage_Sync
				// links it, and it misses whole-house leases that carry no unit link and most
				// bedroom leases - 226 covered units on AY 27-28 alone. placeLeases already
				// resolves every type correctly, so the leaves always know, and unit.metrics is the
				// very same rollup Leasing Details prints in its Occupied by Lease Type columns.
				const um = unit.metrics || null;
				const onLeaves = [];
				unit.leaves.forEach((l) => { if (l.lease && onLeaves.indexOf(l.lease) < 0) onLeaves.push(l.lease); });
				const governing = onLeaves.filter((x) => toKey(x.status) === LEASE_STATUS.EXECUTED)[0]
					|| onLeaves.filter((x) => toKey(x.status) === LEASE_STATUS.IN_PROCESS)[0]
					|| onLeaves[0]
					|| null;
				rows.push(Object.assign({
					kind: 'U', unitId: unit.id, unitName: unit.name,
					beds: unit.leaves.reduce((s, l) => s + num(l.beds), 0),
					bedrooms: unit.bedrooms.map((b) => ({
						id: b.id, name: b.name, beds: num(b.leaf.beds),
						leaseId: b.leaf.lease ? String(b.leaf.lease.id) : null
					})),
					leafLeaseCount: um ? um.leaseIds.size : onLeaves.length,
					// typeSummary is what Leasing Details shows: Whole House, Unit, Bedroom, Mixed
					// or Vacant. Mixed means more than one type covers beds in this unit.
					leaseTypeLabel: um ? typeSummary(um) : null,
					occWH: um ? num(um.occWH) : 0,
					occUnit: um ? num(um.occUnit) : 0,
					occBed: um ? num(um.occBed) : 0,
					occBeds: um ? num(um.occ) : 0,
					leaseStart: um ? (um.start || null) : null,
					leaseEnd: um ? (um.end || null) : null,
					leafLease: governing ? {
						id: String(governing.id), name: governing.name || '',
						type: governing.type || '', status: toKey(governing.status),
						sent: governing.sent || null, signed: governing.signed || null,
						mrev: num(governing.mrev),
						span: num(governing.span), spanYear: num(governing.spanYear)
					} : null
				}, base));
			});
			// A property with no unit records still carries beds on Summary but has nothing to hang a status row
			// on. Show it so the bed total ties, and leave it read-only rather than inventing a unit for it.
			if (prop.leaf) {
				rows.push(Object.assign({ kind: 'P', unitId: null, unitName: prop.name, beds: num(prop.leaf.beds), bedrooms: [], leafLeaseCount: 0, leafLease: null }, base));
			}
		});
		rows.sort((a, b) => String(a.marketLabel).localeCompare(String(b.marketLabel))
			|| byName({ name: a.property }, { name: b.property })
			|| byName({ name: a.unitName }, { name: b.unitName }));
		return { rows, units: rows.length, beds: rows.reduce((s, r) => s + r.beds, 0) };
	};

	const velocity = ({ subsidiaries, properties, records, allLeases, academicYears, ayId, maxPrior = 3 }) => {
		const years = sortYears(academicYears);
		const idx = years.findIndex((y) => String(y.id) === String(ayId));
		if (idx < 0) return null;
		const shown = years.slice(Math.max(0, idx - maxPrior), idx + 1).reverse();
		const resolveFund = buildFundResolver(subsidiaries);
		const out = { ays: [], exec: [], pf: [], beds: {} };
		const inv = buildInventory(properties, records, resolveFund, []);
		const leaves = [];
		Object.values(inv.props).forEach((p) => p.leaves.forEach((l) => leaves.push(l)));
		const reset = () => leaves.forEach((l) => { l.lease = null; l.people = 0; l.mrev = 0; l.trev = 0; });
		Object.values(inv.props).forEach((p) => {
			if (!p.marketKey) return;
			const k = `${p.fundKey}|${p.marketKey}`;
			out.beds[k] = (out.beds[k] || 0) + p.leaves.reduce((s, l) => s + l.beds, 0);
		});
		shown.forEach((y, yi) => {
			const start = parseDay(y.start_date);
			out.ays.push({ id: String(y.id), name: y.name, start: y.start_date || null, selected: String(y.id) === String(ayId) });
			if (start === null) return;
			const leases = allLeases.filter((l) => String(l.ay) === String(y.id));
			[BASIS.EXEC, BASIS.PRO_FORMA].forEach((basis) => {
				reset();
				const results = placeLeases(leases.filter((l) => inBasis(l, basis)), inv);
				results.forEach((r) => {
					if (r.reason || !r.prop.marketKey) return;
					const d = leaseDate(r, basis);
					if (d === null) return;
					out[basis].push([yi, Math.round((d - start) / DAY), r.scopeBeds, round(r.mrev, 2), r.prop.fundKey, r.prop.marketKey, Number(r.type)]);
				});
			});
		});
		return out;
	};

	// Lease records created in the last N days (all academic years), scoped by fund/market.
	const recentLeases = (allLeases, { properties, subsidiaries, academicYears, now, days = 3, fundKey, marketKey }) => {
		const resolveFund = buildFundResolver(subsidiaries);
		const props = {};
		properties.forEach((p) => {
			const fund = resolveFund(p.subsidiary);
			props[String(p.id)] = { id: String(p.id), name: p.name, marketKey: marketKey_(p.city), marketLabel: marketLabel(p.city), fundKey: fund.key, fundLabel: fund.label };
		});
		const inScope = scopeFilter(fundKey, marketKey);
		const ayName = {};
		(academicYears || []).forEach((y) => { ayName[String(y.id)] = y.name; });
		const nowT = parseStamp(now);
		const cutoff = nowT - days * DAY;
		const statusLabel = { 1: 'Fully Executed', 2: 'In Process' };
		return allLeases
			.filter((l) => { const c = parseStamp(l.created); return c !== null && c >= cutoff; })
			.filter((l) => (fundKey || marketKey ? inScope(props[toKey(l.property_id)]) : true))
			.map((l) => {
				const p = props[toKey(l.property_id)] || null;
				return {
					id: String(l.id), name: l.name, ay: ayName[toKey(l.ay)] || '', status: statusLabel[toKey(l.status)] || '–',
					fund: p ? p.fundLabel : '', market: p ? p.marketLabel : '', property: p ? p.name : '',
					linked: l.unit_name ? leafName(l.unit_name) : '', type: LEASE_TYPE_LABEL[toKey(l.lease_type)] || 'Unknown',
					people: num(l.tenants), mrev: num(l.monthly_rent), sent: l.sent_date || null, signed: l.signed_date || null, created: l.created
				};
			})
			.sort((a, b) => String(b.created).localeCompare(String(a.created)));
	};

	// Lease-level data quality for the selected AY (dates and status the weekly report depends on).
	const leaseQuality = (ayLeases, { properties, subsidiaries, today, ayEnd }) => {
		const resolveFund = buildFundResolver(subsidiaries);
		const props = {};
		properties.forEach((p) => {
			const fund = resolveFund(p.subsidiary);
			props[String(p.id)] = { id: String(p.id), name: p.name, marketKey: marketKey_(p.city), marketLabel: marketLabel(p.city), fundKey: fund.key, fundLabel: fund.label };
		});
		const t = parseDay(today);
		const end = parseDay(ayEnd);
		const out = [];
		ayLeases.forEach((l) => {
			const prop = props[toKey(l.property_id)] || null;
			const status = toKey(l.status);
			const signed = parseDay(l.signed_date);
			const push = (issue, handling, fix, detail) => out.push({
				issue, prop, record: l.name, recordId: String(l.id), kind: 'lease', handling, fix, detail: detail || '',
				linked: l.unit_name ? leafName(l.unit_name) : '', mrev: num(l.monthly_rent)
			});
			if (status === LEASE_STATUS.EXECUTED && signed === null) push('Fully Executed lease has no Lease Signed Date', 'Counted in totals; left out of the weekly history', 'Enter the Lease Signed Date.');
			if (status === LEASE_STATUS.IN_PROCESS && !l.sent_date) push('In Process lease has no Lease Sent Date', 'Left out of the pro-forma weekly history and days-in-process', 'Enter the Lease Sent Date.');
			// The term drives which academic years a lease is counted in, and it is read off the
			// dates. A Lease Duration saying two years while the dates say one means one of them
			// is wrong, and the lease is being counted in one year when it may belong in two.
			const fieldMonths = num(l.months);
			const dateMonths = (() => {
				const a = parseDay(l.start_date), b = parseDay(l.end_date);
				return a === null || b === null ? null : Math.round((b - a) / (DAY * 30.44));
			})();
			if (dateMonths !== null && fieldMonths >= 15 && dateMonths < 15) {
				push('Lease Duration says two years but the dates cover one',
					'Counted in a single academic year, following the dates',
					'Correct the Lease End Date, or the Lease Duration by Months.',
					`Duration ${fieldMonths} mo, dates ${dateMonths} mo`);
			}
			if (!status) push('Lease Status is blank', 'Left out of the leasing statistics entirely until a status is set', 'Set Lease Status to In Process once the lease goes out, or Fully Executed once it is signed.');
			if (signed !== null && t !== null && signed > t) push('Lease Signed Date is in the future', 'Weekly history uses it as entered', 'Correct the Lease Signed Date.', `Signed ${l.signed_date}`);
			else if (signed !== null && end !== null && signed > end) push('Lease Signed Date is after the academic year ends', 'Weekly history uses it as entered', 'Correct the Lease Signed Date or the Academic Year.', `Signed ${l.signed_date}`);
		});
		return out;
	};

	// Tenant (customer) records linked to the selected AY's active leases through the lease Tenants field.
	const tenantQuality = (ayLeases, links, { properties, subsidiaries, fundKey, marketKey }) => {
		const resolveFund = buildFundResolver(subsidiaries);
		const props = {};
		properties.forEach((p) => {
			const fund = resolveFund(p.subsidiary);
			props[String(p.id)] = { id: String(p.id), name: p.name, marketKey: marketKey_(p.city), marketLabel: marketLabel(p.city), fundKey: fund.key, fundLabel: fund.label };
		});
		const inScope = (p) => (fundKey || marketKey ? scopeFilter(fundKey, marketKey)(p) : true);
		const leaseById = {};
		ayLeases.forEach((l) => { leaseById[String(l.id)] = l; });
		const byLease = {};
		const byTenant = {};
		links.forEach((t) => {
			const l = leaseById[String(t.lease_id)];
			if (!l) return;
			(byLease[String(l.id)] = byLease[String(l.id)] || []).push(t);
			const k = String(t.tenant_id);
			(byTenant[k] = byTenant[k] || { t, leases: [] }).leases.push(l);
		});
		const tenantName = (t) => `${t.tenant_name || 'Tenant'}${t.tenant_number ? ` (#${t.tenant_number})` : ''}`;
		const leaseRef = (l) => ({ kind: 'lease', id: String(l.id), name: l.name });
		const where = (l) => {
			const p = props[toKey(l.property_id)] || null;
			return { property: p ? p.name : '', fund: p ? p.fundLabel : '', market: p ? p.marketLabel : '', linked: l.unit_name ? leafName(l.unit_name) : '', p };
		};
		const out = [];
		ayLeases.forEach((l) => {
			const w = where(l);
			if (!inScope(w.p)) return;
			const ts = byLease[String(l.id)] || [];
			const n = num(l.tenants);
			const base = { kind: 'lease', id: String(l.id), name: l.name, property: w.property, fund: w.fund, market: w.market, linked: w.linked, mrev: num(l.monthly_rent) };
			if (!ts.length) {
				out.push(Object.assign({}, base, { issue: 'Lease has no tenant records linked', detail: `Number of Tenants ${n}`, sev: 1,
					fix: n ? `Add the ${n} tenant record${n === 1 ? '' : 's'} to the lease's Tenants field.` : 'Add the tenants to the Tenants field and set Number of Tenants.', related: [] }));
			} else if (ts.length !== n) {
				out.push(Object.assign({}, base, { issue: 'Number of Tenants does not match linked tenants', detail: `Number of Tenants ${n} · linked ${ts.length}`, sev: 1,
					fix: `Set Number of Tenants to ${ts.length}, or link the missing / remove the extra tenant records.`,
					related: ts.slice(0, 12).map((t) => ({ kind: 'tenant', id: String(t.tenant_id), name: tenantName(t) })) }));
			}
		});
		Object.keys(byTenant).forEach((k) => {
			const { t, leases } = byTenant[k];
			const scoped = leases.filter((l) => inScope(where(l).p));
			if (!scoped.length) return;
			const w = where(scoped[0]);
			const base = { kind: 'tenant', id: k, name: tenantName(t), property: w.property, fund: w.fund, market: w.market, linked: w.linked, mrev: null };
			if (leases.length > 1) {
				// Double-booked tenant: the beds and the headcount are both counted twice until one lease is removed.
				const wheres = leases.map((l) => { const lw = where(l); return `${lw.property || '?'}${lw.linked ? ` — ${lw.linked}` : ''}`; });
				const mkts = [...new Set(leases.map((l) => where(l).market).filter(Boolean))];
				const dupRent = leases.reduce((sum, l) => sum + num(l.monthly_rent), 0) - num(leases[0].monthly_rent);
				out.push(Object.assign({}, base, { issue: 'Tenant is on more than one active lease in this AY', sev: 2,
					detail: `${leases.length} leases · ${wheres.join(' | ')}${mkts.length > 1 ? ` · ${mkts.join(' + ')}` : ''}`,
					places: wheres, markets: mkts, mrev: round(dupRent, 2), dupLeases: leases.length,
					fix: 'Keep the tenant on the correct lease and remove them from the others (or inactivate the duplicate lease).', related: leases.map(leaseRef) }));
			}
			if (t.tenant_inactive === 'T') {
				out.push(Object.assign({}, base, { issue: 'Tenant record is inactive but on an active lease', detail: '', sev: 1,
					fix: 'Reactivate the tenant record, or remove the tenant from the lease.', related: leases.map(leaseRef) }));
			}
			if (!t.tenant_email) {
				out.push(Object.assign({}, base, { issue: 'Tenant has no email address', detail: '', sev: 0, fix: 'Add an email address on the tenant record.', related: leases.map(leaseRef) }));
			}
		});
		return out;
	};

	return {
		calculate, summarize, pipelineUnits, weekly, velocity, recentLeases, leaseQuality, tenantQuality, inBasis, priorYearOf, sortYears, withParentCity, REASON_FIX,
		REASONS, LEASE_TYPE, LEASE_TYPE_LABEL, LEASE_STATUS, BASIS, BASIS_LABEL
	};
});
