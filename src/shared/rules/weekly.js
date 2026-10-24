/**
 * §6.2 Weekly — the v2 weekly leasing report on the new engine. Pure; `today` is a parameter.
 *
 * weeklyReport({ ay, basis, today, weekOf, cur, prior, keep, groupBy, inactivations, ayLabels })
 *   cur / prior : engine results for AY and AY-1 (prior may be null)
 *   keep(p)     : property predicate (scope ∩ selection)
 *
 * Dating follows the basis (v2 rule, assumption A-14): pro-forma counts a lease on its Lease Sent Date
 * (falling back to the signed date); Fully Executed counts it on its Lease Signed Date. Last year is laid
 * onto this year's calendar by the AY-start gap; week-to-week comparisons round that gap to whole weeks so
 * a Monday–Sunday week lines up with a Monday–Sunday week. Carried two-year years are never new events.
 */
import { LEASE_TYPES, SEGMENTS } from '../constants.js';
import { dayNum, fromDayNum, weekStart, ayStartDate, daysBetween } from './dates.js';
import { leaseDateFor, propertyOf, linkedName, fundLabel } from './summary.js';

const ratio = (a, b) => (b > 0 ? a / b : null);
const growth = (cur, prev) => (prev > 0 ? cur / prev - 1 : null);
const r2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));
const mainSeg = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;
const typeLabel = (k) => (LEASE_TYPES[k] || {}).label || 'Unknown';
const D = (iso) => dayNum(iso);
const F = (n) => (n == null ? null : fromDayNum(n));
const mondayOf = (n) => D(weekStart(F(n)));

export function weeklyReport({ ay, basis = 'proforma', today, weekOf = null, cur, prior = null, keep = () => true, groupBy = 'market', inactivations = [], ayLabels = {} }) {
  const inv = cur.inventory;
  const inScope = (p) => !!p && mainSeg(p) && keep(p);
  const todayN = D(today);
  const curMonday = mondayOf(todayN);
  let week = weekOf ? D(weekOf) : null;
  week = week == null ? curMonday : Math.min(mondayOf(week), curMonday);
  const weekEnd = week + 6, prevEnd = weekEnd - 7;
  const totalBeds = inv.leaves.reduce((s, l) => s + (inScope(inv.propertiesById.get(l.propertyId)) ? l.beds : 0), 0);
  const offset = daysBetween(ayStartDate(ay - 1), ayStartDate(ay));
  const hasLy = !!prior;
  const lyShift = hasLy ? Math.round(offset / 7) * 7 : null;

  // counted leases (placed, incl. carried years for cumulative occupancy) with their basis date
  const counted = [...cur.placement.leaseResults.values()].filter((r) => r.status === 'placed' && inScope(propertyOf(cur, r)));
  const dated = [], undated = [];
  for (const r of counted) { const d = leaseDateFor(r.lease, basis); if (d) dated.push({ d: D(d), r }); else undated.push(r); }
  dated.sort((a, b) => a.d - b.d);
  const finOf = (r) => (r.coveredBeds * Math.min(r.year.months, 12)) / 12;
  const priorDated = [];
  if (hasLy) for (const r of prior.placement.leaseResults.values()) { if (r.status !== 'placed' || !inScope(propertyOf(cur, r))) continue; const d = leaseDateFor(r.lease, basis); if (d) priorDated.push({ d: D(d) + offset, r }); }
  priorDated.sort((a, b) => a.d - b.d);

  // ---- week-over-week history (cumulative at each week end, restated from today's active leases) ----
  const firstMonday = dated.length ? mondayOf(dated[0].d) : week;
  const startMonday = Math.max(Math.min(firstMonday, week), week - 155 * 7);
  const history = [];
  let i = 0, j = 0;
  const cum = { leases: 0, beds: 0, fin: 0, mrev: 0, trev: 0 }, pcum = { leases: 0, beds: 0, mrev: 0, trev: 0 };
  const take = (acc, r) => { acc.leases++; acc.beds += r.coveredBeds; if ('fin' in acc) acc.fin += finOf(r); acc.mrev += r.lease.monthlyRent; acc.trev += r.year.revenue; };
  while (i < dated.length && dated[i].d < startMonday) take(cum, dated[i++].r);
  while (j < priorDated.length && priorDated[j].d < startMonday) take(pcum, priorDated[j++].r);
  for (let w = startMonday; w <= week; w += 7) {
    const end = w + 6;
    const add = { leases: 0, beds: 0, mrev: 0, trev: 0 }, ladd = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    while (i < dated.length && dated[i].d <= end) { take(add, dated[i].r); take(cum, dated[i++].r); }
    while (j < priorDated.length && priorDated[j].d <= end) { take(ladd, priorDated[j].r); take(pcum, priorDated[j++].r); }
    history.push({ week: F(w), weekEnd: F(end), newLeases: add.leases, newBeds: add.beds, newMrev: r2(add.mrev), newTrev: r2(add.trev),
      leases: cum.leases, occ: cum.beds, occPct: ratio(cum.beds, totalBeds), fin: r2(cum.fin), finPct: ratio(cum.fin, totalBeds), mrev: r2(cum.mrev), trev: r2(cum.trev),
      lyOcc: hasLy ? pcum.beds : null, lyOccPct: hasLy ? ratio(pcum.beds, totalBeds) : null, lyMrev: hasLy ? r2(pcum.mrev) : null, lyTrev: hasLy ? r2(pcum.trev) : null, lyLeases: hasLy ? pcum.leases : null, lyNewLeases: hasLy ? ladd.leases : null, lyNewBeds: hasLy ? ladd.beds : null, lyNewTrev: hasLy ? r2(ladd.trev) : null });
  }
  history.forEach((h, k) => { const p = history[k - 1]; h.dOcc = p ? h.occ - p.occ : null; h.dOccPct = p && h.occPct != null && p.occPct != null ? h.occPct - p.occPct : null; h.dMrev = p ? r2(h.mrev - p.mrev) : null; h.dTrev = p ? r2(h.trev - p.trev) : null; h.vsLyPct = h.lyOccPct != null && h.occPct != null ? h.occPct - h.lyOccPct : null; });
  const sel = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : null;

  // LY line beyond the selected week (to 4 weeks past this AY's start) for the pace chart
  const ahead = [];
  if (hasLy) {
    const ayStart = D(ayStartDate(ay));
    const stop = Math.min(Math.max(mondayOf(ayStart) + 28, week + 28), week + 70 * 7);
    let beds = pcum.beds, jj = j;
    for (let w = week + 7; w <= stop; w += 7) { const end = w + 6; while (jj < priorDated.length && priorDated[jj].d <= end) beds += priorDated[jj++].r.coveredBeds; ahead.push([F(w), ratio(beds, totalBeds)]); }
  }

  // ---- per-lease sections ----
  const inWeek = (n) => n != null && n >= week && n <= weekEnd;
  const asOf = Math.min(todayN, weekEnd);
  const ayLeases = [...cur.placement.leaseResults.values()].filter((r) => (r.lease.statusKey === 'EXECUTED' || r.lease.statusKey === 'IN_PROCESS') && !r.year.carried && inScope(propertyOf(cur, r)));
  const priorAyLeases = hasLy ? [...prior.placement.leaseResults.values()].filter((r) => (r.lease.statusKey === 'EXECUTED' || r.lease.statusKey === 'IN_PROCESS') && !r.year.carried && inScope(propertyOf(cur, r))) : [];
  const lyPriorSigned = priorAyLeases.filter((r) => r.lease.signedDate).length, lyPriorSent = priorAyLeases.filter((r) => r.lease.sentDate).length;
  const lySentThin = hasLy && lyPriorSent < 0.5 * lyPriorSigned;
  const sentCoverage = { sent: lyPriorSent, signed: lyPriorSigned, thin: lySentThin };
  const lyOf = (r) => {
    if (!hasLy || r.status !== 'placed') return null;
    let beds = 0, mrev = 0, hit = 0;
    for (const leaf of r.scope.leaves) { const pl = prior.placement.leafResults.get(leaf.key); if (pl && pl.occupied) { beds += leaf.beds; mrev += pl.monthly; hit++; } }
    return hit ? { beds, mrev: r2(mrev), rentBed: beds > 0 ? r2(mrev / beds) : null, partial: hit < r.scope.leaves.length } : null;
  };
  const leaseRow = (r) => {
    const p = propertyOf(cur, r), beds = r.status === 'placed' ? r.coveredBeds : null, mrev = r.lease.monthlyRent, ly = lyOf(r), rentBed = beds > 0 ? r2(mrev / beds) : null;
    return { id: r.lease.id, name: r.lease.name, fund: p ? fundLabel(p.fund) : '', market: p ? p.marketLabel : '', marketId: p ? p.marketId : null, property: p ? p.name : '', propertyId: p ? p.id : null, linked: linkedName(cur, r), type: typeLabel(r.lease.typeKey), status: r.lease.statusKey,
      beds, people: r.lease.tenantCount, mrev, trev: r.status === 'placed' ? r2(r.year.revenue) : null, rentBed, lyBeds: ly ? ly.beds : null, lyMrev: ly ? ly.mrev : null, lyRentBed: ly ? ly.rentBed : null, lyPartial: ly ? !!ly.partial : false,
      rentBedPct: ly && ly.rentBed > 0 && rentBed != null ? rentBed / ly.rentBed - 1 : null, sent: r.lease.sentDate, signed: r.lease.signedDate, note: r.status === 'excluded' ? `Excluded: ${r.code}` : (r.status === 'skipped' ? 'Not on this basis' : '') };
  };
  const rollup = (list) => {
    const t = { leases: list.length, beds: 0, mrev: 0, trev: 0, lyLeases: 0, lyBeds: 0, lyMrev: 0 };
    for (const r of list) { t.beds += r.beds || 0; t.mrev += r.mrev || 0; t.trev += r.trev || 0; if (r.lyRentBed != null) { t.lyLeases++; t.lyBeds += r.lyBeds || 0; t.lyMrev += r.lyMrev || 0; } }
    t.mrev = r2(t.mrev); t.trev = r2(t.trev); t.lyMrev = r2(t.lyMrev); t.rentBed = t.beds > 0 ? r2(t.mrev / t.beds) : null; t.lyRentBed = t.lyBeds > 0 ? r2(t.lyMrev / t.lyBeds) : null;
    t.rentBedPct = t.lyRentBed > 0 && t.rentBed != null ? t.rentBed / t.lyRentBed - 1 : null; t.bedsPct = t.lyBeds > 0 ? t.beds / t.lyBeds - 1 : null;
    return t;
  };
  const openAt = (r, end, shift) => { const sent = D(r.lease.sentDate), signed = D(r.lease.signedDate); if (sent == null || sent + shift > end) return false; return signed == null ? r.lease.statusKey === 'IN_PROCESS' : signed + shift > end; };
  const inProcess = [];
  for (const r of ayLeases) {
    const noSent = r.lease.sentDate == null && r.lease.statusKey === 'IN_PROCESS' && week === curMonday;
    if (!openAt(r, weekEnd, 0) && !noSent) continue;
    const row = leaseRow(r); const sent = D(r.lease.sentDate); row.days = sent == null ? null : asOf - sent; if (noSent) row.note = 'No Lease Sent Date'; inProcess.push(row);
  }
  inProcess.sort((a, b) => (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days));
  const pipeline = { now: inProcess.filter((r) => r.days != null).length, noSent: inProcess.filter((r) => r.days == null).length, over21: inProcess.filter((r) => r.days != null && r.days > 21).length,
    prev: ayLeases.filter((r) => openAt(r, prevEnd, 0)).length, ly: hasLy ? priorAyLeases.filter((r) => openAt(r, weekEnd, lyShift)).length : null, lyThin: lySentThin };
  const byProp = (a, b) => String(a.property).localeCompare(String(b.property), undefined, { numeric: true });
  const executed = ayLeases.filter((r) => r.lease.statusKey === 'EXECUTED' && inWeek(D(r.lease.signedDate))).map(leaseRow).sort((a, b) => String(a.signed).localeCompare(String(b.signed)) || byProp(a, b));
  const sentThisWeek = ayLeases.filter((r) => inWeek(D(r.lease.sentDate))).map(leaseRow).sort((a, b) => String(a.sent).localeCompare(String(b.sent)) || byProp(a, b));
  const priorWeek = (dateOf) => {
    if (!hasLy) return null;
    const t = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    for (const r of priorAyLeases) { const d = D(dateOf(r.lease)); if (d == null || d + lyShift < week || d + lyShift > weekEnd) continue; t.leases++; t.beds += r.status === 'placed' ? r.coveredBeds : 0; t.mrev += r.lease.monthlyRent; t.trev += r.status === 'placed' ? r.year.revenue : 0; }
    t.mrev = r2(t.mrev); t.trev = r2(t.trev); t.rentBed = t.beds > 0 ? r2(t.mrev / t.beds) : null; return t;
  };
  const priorOpen = () => {
    if (!hasLy) return null;
    const t = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    for (const r of priorAyLeases) { if (!openAt(r, weekEnd, lyShift)) continue; t.leases++; t.beds += r.status === 'placed' ? r.coveredBeds : 0; t.mrev += r.lease.monthlyRent; t.trev += r.status === 'placed' ? r.year.revenue : 0; }
    t.mrev = r2(t.mrev); t.trev = r2(t.trev); t.rentBed = t.beds > 0 ? r2(t.mrev / t.beds) : null; return t;
  };
  const sectionYoY = (list, dateOf, lyRows) => {
    const ty = rollup(list), ly = lyRows ? lyRows() : priorWeek(dateOf);
    return { ty, ly, dLeases: ly ? ty.leases - ly.leases : null, dBeds: ly ? ty.beds - ly.beds : null, leasesPct: ly && ly.leases > 0 ? ty.leases / ly.leases - 1 : null, bedsPct: ly && ly.beds > 0 ? ty.beds / ly.beds - 1 : null,
      rentBedPct: ly && ly.rentBed > 0 && ty.rentBed != null ? ty.rentBed / ly.rentBed - 1 : null, dRentBed: ly && ly.rentBed != null && ty.rentBed != null ? r2(ty.rentBed - ly.rentBed) : null, trevPct: ly && ly.trev > 0 ? ty.trev / ly.trev - 1 : null };
  };

  // ---- breakdown for the selected week: by market, or by fund ----
  const groupKey = groupBy === 'fund' ? (p) => fundLabel(p.fund) : (p) => p.marketLabel;
  const groupId = groupBy === 'fund' ? (p) => p.fund : (p) => p.marketId;
  const groups = new Map();
  const grp = (p) => { const k = groupKey(p); if (!groups.has(k)) groups.set(k, { name: k, id: groupId(p), beds: 0, occ: 0, prevOcc: 0, lyOcc: 0, newBeds: 0, newLeases: 0, lyNewBeds: 0, trev: 0, lyTrev: 0, inProcess: 0 }); return groups.get(k); };
  for (const p of inv.propertiesById.values()) if (inScope(p)) grp(p).beds += p.beds;
  for (const { d, r } of dated) { if (d > weekEnd) continue; const g = grp(propertyOf(cur, r)); g.occ += r.coveredBeds; g.trev += r.year.revenue; if (d <= prevEnd) g.prevOcc += r.coveredBeds; if (d >= week) { g.newBeds += r.coveredBeds; g.newLeases++; } }
  for (const { d, r } of priorDated) { if (d > weekEnd) continue; const g = grp(propertyOf(cur, r)); g.lyOcc += r.coveredBeds; g.lyTrev += r.year.revenue; if (d >= week) g.lyNewBeds += r.coveredBeds; }
  for (const r of ayLeases) if (openAt(r, weekEnd, 0)) grp(propertyOf(cur, r)).inProcess++;
  const byGroup = [...groups.values()].filter((g) => g.beds > 0 || g.occ > 0).map((g) => ({ ...g, trev: r2(g.trev), lyTrev: hasLy ? r2(g.lyTrev) : null, occPct: ratio(g.occ, g.beds), prevOccPct: ratio(g.prevOcc, g.beds), lyOccPct: hasLy ? ratio(g.lyOcc, g.beds) : null, lyOcc: hasLy ? g.lyOcc : null, lyNewBeds: hasLy ? g.lyNewBeds : null,
    dOccPct: g.beds > 0 ? (g.occ - g.prevOcc) / g.beds : null, vsLyPct: hasLy && g.beds > 0 ? (g.occ - g.lyOcc) / g.beds : null, trevPace: hasLy ? growth(g.trev, g.lyTrev) : null })).sort((a, b) => a.name.localeCompare(b.name));

  // ---- lease records made inactive this week (system notes), all academic years ----
  const inactivated = (inactivations || []).filter((e) => inWeek(D(String(e.changed || '').slice(0, 10)))).map((e) => {
    const p = inv.propertiesById.get(String(e.property_id)); if (!p || !keep(p)) return null;
    const linked = e.unit_name || ''; const beds = e.beds != null ? Number(e.beds) : null;
    return { id: String(e.id), name: e.name, ay: ayLabels[String(e.ay)] || '', market: p.marketLabel, property: p.name, propertyId: p.id, linked, beds, mrev: Number(e.monthly_rent) || 0, changed: e.changed, changedBy: e.changed_by || '', stillInactive: e.inactive_now !== 'F' };
  }).filter(Boolean).sort((a, b) => String(b.changed).localeCompare(String(a.changed)));

  // ---- week picker ----
  const firstSeen = [];
  for (const r of ayLeases) for (const s of [r.lease.signedDate, r.lease.sentDate]) { const d = D(s); if (d != null) firstSeen.push(d); }
  const earliest = firstSeen.length ? Math.max(mondayOf(Math.min(...firstSeen)), curMonday - 155 * 7) : curMonday - 25 * 7;
  const weekOptions = []; for (let w = curMonday; w >= earliest; w -= 7) weekOptions.push({ value: F(w), label: `${F(w)} – ${F(w + 6)}` });

  // ---- to-date comparisons: week, month, academic year, each vs the same elapsed days last year and vs a week earlier ----
  const cmpAsOf = Math.min(todayN, weekEnd);
  const monthStartN = D(F(cmpAsOf).slice(0, 8) + '01');
  const priorRaw = hasLy ? priorDated.map((x) => ({ d: x.d - offset, r: x.r })) : [];
  const span = (rows, from, to) => { const o = { beds: 0, leases: 0, trev: 0, mrev: 0 }; for (const x of rows) if ((from == null || x.d >= from) && x.d <= to) { o.beds += x.r.coveredBeds; o.leases++; o.trev += x.r.year.revenue; o.mrev += x.r.lease.monthlyRent; } o.trev = r2(o.trev); o.mrev = r2(o.mrev); o.occPct = ratio(o.beds, totalBeds); return o; };
  const pair = (label, from, to, cumulative) => {
    const ty = span(dated, from, to), ly = hasLy ? span(priorRaw, from == null ? null : from - lyShift, to - lyShift) : null;
    return { label, from: from == null ? null : F(from), to: F(to), lyFrom: hasLy && from != null ? F(from - lyShift) : null, lyTo: hasLy ? F(to - lyShift) : null, cumulative: !!cumulative, ty, ly,
      d: ly ? { beds: ty.beds - ly.beds, leases: ty.leases - ly.leases, trev: r2(ty.trev - ly.trev), occPts: ty.occPct != null && ly.occPct != null ? ty.occPct - ly.occPct : null } : null,
      pct: ly ? { beds: growth(ty.beds, ly.beds), leases: growth(ty.leases, ly.leases), trev: growth(ty.trev, ly.trev) } : null };
  };
  const cmp = { hasLy, lyShiftDays: hasLy ? lyShift : null, asOf: F(cmpAsOf), undatedBeds: undated.reduce((a, r) => a + r.coveredBeds, 0), undatedLeases: undated.length, countedBeds: cum.beds, partial: week === curMonday && cmpAsOf < weekEnd,
    week: pair('This week to date', week, cmpAsOf, false), month: pair('This month to date', monthStartN, cmpAsOf, false), year: pair('This academic year to date', null, cmpAsOf, true) };
  const pwMonthStart = D(F(prevEnd).slice(0, 8) + '01');
  cmp.pw = { week: pair('Prior week', week - 7, prevEnd, false), month: pair('Month to prior week end', pwMonthStart, prevEnd, false), year: pair('Academic year to prior week end', null, prevEnd, true) };

  return {
    ay, basis, today, week: F(week), weekEnd: F(weekEnd), isCurrent: week === curMonday, weekOptions, totalBeds, history, sel, prev, hasPrior: hasLy, shiftDays: lyShift, offsetDays: offset,
    groupBy: groupBy === 'fund' ? 'fund' : 'market', byGroup, pipeline, lyWeek: hasLy ? F(week - offset) : null, lyWeekEnd: hasLy ? F(weekEnd - offset) : null, cmp,
    chart: { pts: history.slice(-60).map((h) => [h.week, h.occPct, h.lyOccPct]), ahead, ayStart: ayStartDate(ay) },
    undated: { leases: undated.length, beds: undated.reduce((s, r) => s + r.coveredBeds, 0), mrev: r2(undated.reduce((s, r) => s + r.lease.monthlyRent, 0)) },
    inProcess, executed, sentThisWeek, inactivated,
    sentYoY: { ...sectionYoY(sentThisWeek, (l) => l.sentDate), sentBased: true, coverage: sentCoverage, volumeThin: lySentThin },
    execYoY: sectionYoY(executed, (l) => l.signedDate),
    inProcessYoY: { ...sectionYoY(inProcess, null, priorOpen), sentBased: true, coverage: sentCoverage, volumeThin: lySentThin },
  };
}
