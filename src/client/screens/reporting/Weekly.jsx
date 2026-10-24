import { useState } from 'react';
import { useRoute } from '../../hooks.js';
import { recordUrl } from '../../api.js';
import { Tile, Stat, Section, Table, Skeleton, ErrorBox, Button, Select, Disclosure, OccPill, Segmented } from '../../ui.jsx';
import { PaceChart, VelocityChart } from '../../components/Chart.jsx';
import { fmtInt, fmtMoney, fmtMoney2, fmtMoneyK, fmtPct, fmtPts, fmtGrowth, fmtSigned, fmtSignedMoney, fmtDate, ayShort, isNum, occTone, paceTone } from '../../format.js';

const D = (v, f) => (isNum(v) ? <span className={`delta ${v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : ''}`}>{f(v)}</span> : <span className="muted">–</span>);
const diff = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
const leaseLink = (r) => <a className="link" href={recordUrl('lease', r.id)} target="_blank" rel="noreferrer">{r.name}</a>;

/** Weekly report (v2 parity): tiles, to-date comparisons, by market/fund, per-lease sections, pace, history, inactivations, velocity. */
export function Weekly({ sel, onPresent, boot }) {
  const [week, setWeek] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const { data: w, error, loading } = useRoute('weekly', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market, week, groupBy });
  if (error) return <ErrorBox error={error} />;
  if (loading || !w) return <Skeleton rows={5} />;
  return <WeeklyBody w={w} sel={sel} week={week} setWeek={setWeek} groupBy={groupBy} setGroupBy={setGroupBy} onPresent={onPresent} boot={boot} />;
}

export function WeeklyBody({ w, sel, week, setWeek, groupBy, setGroupBy, onPresent, slides = false, big = false }) {
  const s = w.sel || {}, prev = w.prev || {}, pl = w.pipeline, c = w.cmp;
  const ly = w.hasPrior && w.priorAy ? ayShort(w.priorAy) : null;
  const signedWord = w.basis === 'executed' ? 'Signed' : 'Sent';
  const basisNote = w.basis === 'executed' ? 'Fully Executed, dated by Lease Signed Date' : 'Pro-forma, dated by Lease Sent Date';
  const pw = (val, d) => ['Prior week', val, d];
  const lw = (val, d) => (ly ? ['Same week LY', val, d] : null);
  const i = w.weekOptions.findIndex((o) => o.value === w.week);
  const step = (n) => { const o = w.weekOptions[i - n]; if (o) setWeek(o.value === w.weekOptions[0].value ? '' : o.value); };
  const rbCols = ly ? [{ label: 'Rent / Bed', value: (r) => fmtMoney2(r.rentBed) }, { label: `${ly} Rent / Bed`, value: (r) => (r.lyRentBed == null ? <span className="muted">n/a</span> : <>{fmtMoney2(r.lyRentBed)}{r.lyPartial && <span className="muted">*</span>}</>) }, { label: 'vs LY', value: (r) => D(r.rentBedPct, fmtGrowth) }] : [{ label: 'Rent / Bed', value: (r) => fmtMoney2(r.rentBed) }];
  const base = [{ label: 'Lease', align: 'l', value: leaseLink }, { label: 'Market', align: 'l', value: (r) => r.market || '–' }, { label: 'Property', align: 'l', value: (r) => r.property || '–' }, { label: 'Units/Bedroom', align: 'l', value: (r) => r.linked || '–' }, { label: 'Lease Type', align: 'l', value: (r) => r.type }];
  const inProcessCols = [...base, { label: 'Tenants', value: (r) => fmtInt(r.people) }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.mrev) }, ...rbCols, { label: 'Sent', value: (r) => fmtDate(r.sent) }, { label: 'Days in Process', value: (r) => (r.days == null ? '–' : <strong className={r.days > 21 ? 'warn-text' : ''}>{fmtInt(r.days)}</strong>) }, { label: 'Note', align: 'l', value: (r) => r.note || '' }];
  const execCols = [...base, { label: 'Beds', value: (r) => fmtInt(r.beds) }, { label: 'Tenants', value: (r) => fmtInt(r.people) }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.mrev) }, ...rbCols, { label: 'Sent', value: (r) => fmtDate(r.sent) }, { label: 'Signed', value: (r) => fmtDate(r.signed) }, { label: 'Note', align: 'l', value: (r) => r.note || '' }];
  const inactCols = [{ label: 'Lease', align: 'l', value: leaseLink }, { label: 'Academic Year', align: 'l', value: (r) => r.ay || '–' }, { label: 'Market', align: 'l', value: (r) => r.market || '–' }, { label: 'Property', align: 'l', value: (r) => r.property || '–' }, { label: 'Units/Bedroom', align: 'l', value: (r) => r.linked || '–' }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.mrev) }, { label: 'Inactivated', align: 'l', value: (r) => r.changed }, { label: 'By', align: 'l', value: (r) => r.changedBy }, { label: 'Now', align: 'l', value: (r) => (r.stillInactive ? 'Inactive' : <span className="pill pill-done">Reactivated</span>) }];
  const yoyStrip = (y, word) => {
    if (!y) return null;
    if (!y.ly) return <p className="muted small">Year over year: <strong>n/a</strong> · {y.lyUnusable ? `${ly} has too few Lease Sent Dates to compare against.` : ly ? `No ${word.toLowerCase()} leases in the same week of ${ly}.` : 'No prior academic year in NetSuite.'}</p>;
    const thin = !!y.volumeThin;
    const cell = (label, tyv, lyv, dNode, pct, drop) => <div className={`yoy-cell ${drop ? 'thin' : ''}`}><span>{label}</span><strong>{tyv}</strong><em>{ly} {lyv}</em><div>{drop ? <span className="muted">not comparable</span> : <>{dNode} {isNum(pct) && D(pct, fmtGrowth)}</>}</div></div>;
    return <>
      <div className="yoy-strip">{cell('Leases', fmtInt(y.ty.leases), fmtInt(y.ly.leases), D(y.dLeases, fmtSigned), y.leasesPct, thin)}{cell('Beds', fmtInt(y.ty.beds), fmtInt(y.ly.beds), D(y.dBeds, fmtSigned), y.bedsPct, thin)}{cell('Rent / Bed', fmtMoney2(y.ty.rentBed), fmtMoney2(y.ly.rentBed), D(y.dRentBed, fmtSignedMoney), y.rentBedPct, false)}<div className={`yoy-cell ${thin ? 'thin' : ''}`}><span>Total Revenue</span><strong>{thin ? <span className="muted">n/a</span> : D(y.trevPct, fmtGrowth)}</strong><em>{fmtMoneyK(y.ty.trev)} vs {fmtMoneyK(y.ly.trev)}</em></div></div>
      {thin && <p className="muted small">⚠ {ly} has a Lease Sent Date on {fmtInt(y.coverage.sent)} of its {fmtInt(y.coverage.signed)} signed leases, so its count here is a floor. Leases, Beds and Revenue are not like-for-like; Rent / Bed still stands.</p>}
    </>;
  };
  const strip = (cells) => <div className="sec-tiles">{cells.filter(Boolean).map((x, k) => <Stat key={k} value={x[1]} label={x[0]} sub={x[2]} tone={x[3]} />)}</div>;
  const sentRoll = w.sentYoY && w.sentYoY.ty, execRoll = w.execYoY && w.execYoY.ty;
  const inacBeds = (w.inactivated || []).reduce((t, r) => t + (Number(r.beds) || 0), 0);
  const inProcessRows = (w.inProcess || []).slice().sort((a, b) => (a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days));
  const histAll = w.history.slice().reverse();
  const cmpCard = (p, kind, pwp, tail) => {
    const rentBedOf = (x) => (x && x.beds > 0 ? x.mrev / x.beds : null);
    const row = (label, key, money) => { const f = money ? fmtMoneyK : fmtInt; const dv = p.d ? p.d[key] : null, pv = p.pct ? p.pct[key] : null, wow = pwp ? p.ty[key] - pwp.ty[key] : null; return <tr key={key}><th>{label}</th><td>{f(p.ty[key])}</td><td>{p.ly ? f(p.ly[key]) : <span className="muted">n/a</span>}</td><td>{p.ly ? <>{D(dv, money ? fmtSignedMoney : fmtSigned)}{isNum(pv) && <span className="sub"> {fmtGrowth(pv)}</span>}</> : '–'}</td><td>{pwp ? D(wow, money ? fmtSignedMoney : fmtSigned) : '–'}</td></tr>; };
    const ty = rentBedOf(p.ty), lyv = p.ly ? rentBedOf(p.ly) : null, pwv = pwp ? rentBedOf(pwp.ty) : null;
    const headline = kind === 'year' ? fmtPct(p.ty.occPct) : fmtInt(p.ty.leases), headLabel = kind === 'year' ? 'Pre-lease %' : `Leases ${signedWord}`;
    const vsLy = p.d ? (kind === 'year' ? D(p.d.occPts, fmtPts) : D(p.d.leases, fmtSigned)) : '–';
    const vsPw = pwp ? (kind === 'year' ? D(diff(p.ty.occPct, pwp.ty.occPct), fmtPts) : D(p.ty.leases - pwp.ty.leases, fmtSigned)) : '–';
    return <div className="cmp-tile" key={kind}>
      <div className="sec-head"><div><h3>{p.label}</h3><p className="muted small">{p.from ? `${fmtDate(p.from)} – ` : 'Through '}{fmtDate(p.to)}{p.ly ? ` · ${ly} ${p.lyFrom ? `${fmtDate(p.lyFrom)} – ` : 'through '}${fmtDate(p.lyTo)}` : ''}</p></div></div>
      <div className="cmp-big"><span>{headLabel}</span><strong>{headline}</strong><small>{kind === 'year' ? `${fmtInt(p.ty.beds)} of ${fmtInt(w.totalBeds)} beds` : `${fmtInt(p.ty.beds)} beds · ${fmtMoneyK(p.ty.trev)}`}</small><div className="cmp-deltas"><em>vs {ly || 'LY'}</em><span>{vsLy}</span><em>vs prior wk</em><span>{vsPw}</span></div></div>
      <Disclosure summary="Detail"><table className="mini wide cmp-tbl"><thead><tr><th>Metric</th><th>This Year</th><th>{ly || 'Last Year'}</th><th>vs LY</th><th>vs Prior Wk</th></tr></thead><tbody>{row('Beds Leased', 'beds')}{row(`Leases ${signedWord}`, 'leases')}{row('Revenue Leased', 'trev', true)}<tr><th>Rent / Bed</th><td>{fmtMoney2(ty)}</td><td>{isNum(lyv) ? fmtMoney2(lyv) : <span className="muted">n/a</span>}</td><td>{isNum(ty) && isNum(lyv) ? D(ty - lyv, fmtSignedMoney) : '–'}</td><td>{isNum(ty) && isNum(pwv) ? D(ty - pwv, fmtSignedMoney) : '–'}</td></tr>{tail}</tbody></table></Disclosure>
    </div>;
  };
  const yearTail = c && c.undatedBeds ? <tr className="recon-row"><th>Not yet dated<div className="muted small">{fmtInt(c.undatedLeases)} lease{c.undatedLeases === 1 ? '' : 's'} with no {w.basis === 'executed' ? 'signed' : 'sent or signed'} date: counted on Summary, in no week</div></th><td>{fmtInt(c.undatedBeds)}</td><td>–</td><td>–</td><td>–</td></tr> : null;
  const groupLabel = w.groupBy === 'fund' ? 'Fund' : 'Market';
  const totalRow = { name: 'Total', beds: w.totalBeds, occPct: s.occPct, dOccPct: s.dOccPct, lyOccPct: s.lyOccPct, vsLyPct: s.vsLyPct, newBeds: s.newBeds, lyNewBeds: s.lyNewBeds, inProcess: pl.now, trev: s.trev, trevPace: isNum(s.lyTrev) && s.lyTrev > 0 ? s.trev / s.lyTrev - 1 : null };
  const gCols = [{ label: groupLabel, align: 'l', value: (r) => r.name, foot: () => 'Total' }, { label: 'Total Beds', value: (r) => fmtInt(r.beds), foot: (t) => fmtInt(t.beds) }, { label: 'Occ. %', value: (r) => <OccPill r={r.occPct} d={ly ? r.vsLyPct : null} />, foot: (t) => <OccPill r={t.occPct} d={ly ? t.vsLyPct : null} /> }, { label: 'WoW', value: (r) => D(r.dOccPct, fmtPts), foot: (t) => D(t.dOccPct, fmtPts) },
    ...(ly ? [{ label: ly, value: (r) => fmtPct(r.lyOccPct), foot: (t) => fmtPct(t.lyOccPct) }, { label: 'vs LY', value: (r) => D(r.vsLyPct, fmtPts), foot: (t) => D(t.vsLyPct, fmtPts) }] : []),
    { label: 'Beds Leased', value: (r) => fmtInt(r.newBeds), foot: (t) => fmtInt(t.newBeds) }, ...(ly ? [{ label: 'LY Beds Leased', value: (r) => fmtInt(r.lyNewBeds), foot: (t) => fmtInt(t.lyNewBeds) }] : []), { label: 'In Process', value: (r) => fmtInt(r.inProcess), foot: (t) => fmtInt(t.inProcess) }, { label: 'Total Revenue', value: (r) => fmtMoneyK(r.trev), foot: (t) => fmtMoneyK(t.trev) }, ...(ly ? [{ label: 'Rev. vs LY', value: (r) => D(r.trevPace, fmtGrowth), foot: (t) => D(t.trevPace, fmtGrowth) }] : [])];

  const secSent = <Section key="sent" title="Leases Sent This Week" count={`${fmtInt((w.sentThisWeek || []).length)} leases`} note={`Lease Sent Date ${fmtDate(w.week)} – ${fmtDate(w.weekEnd)}. Rent / Bed is this lease's monthly rent over its beds; ${ly ? `${ly} Rent / Bed is the same unit or bedroom a year earlier (* = only part of the scope was leased).` : ''}`}
    strip={strip([['Leases sent', fmtInt((w.sentThisWeek || []).length), ly && w.sentYoY && w.sentYoY.ly ? `${ly} ${fmtInt(w.sentYoY.ly.leases)}` : ''], ['Beds', fmtInt(sentRoll ? sentRoll.beds : 0), ly && w.sentYoY ? D(w.sentYoY.dBeds, fmtSigned) : ''], ['Rent / bed', fmtMoney2(sentRoll ? sentRoll.rentBed : null), ly && w.sentYoY && isNum(w.sentYoY.dRentBed) ? D(w.sentYoY.dRentBed, fmtSignedMoney) : ''], ['Revenue', fmtMoneyK(sentRoll ? sentRoll.trev : 0), 'full term'], ['Prior week', fmtInt(prev.newLeases), D(diff(s.newLeases, prev.newLeases), fmtSigned)]])} fold defaultOpen={!slides}>
    {yoyStrip(w.sentYoY, 'Sent')}<Table cols={execCols} rows={w.sentThisWeek || []} empty="No leases sent this week" /></Section>;
  const secExec = <Section key="exec" title="Fully Executed This Week" count={`${fmtInt(w.executed.length)} leases`} note={`Lease Status = Fully Executed, signed ${fmtDate(w.week)} – ${fmtDate(w.weekEnd)}.`}
    strip={strip([['Executed', fmtInt(w.executed.length), ly && w.execYoY && w.execYoY.ly ? `${ly} ${fmtInt(w.execYoY.ly.leases)}` : ''], ['Beds', fmtInt(execRoll ? execRoll.beds : 0), ly && w.execYoY ? D(w.execYoY.dBeds, fmtSigned) : ''], ['Rent / bed', fmtMoney2(execRoll ? execRoll.rentBed : null), ly && w.execYoY && isNum(w.execYoY.dRentBed) ? D(w.execYoY.dRentBed, fmtSignedMoney) : ''], ['Revenue', fmtMoneyK(execRoll ? execRoll.trev : 0), 'full term']])} fold defaultOpen={!slides}>
    {yoyStrip(w.execYoY, 'Executed')}<Table cols={execCols} rows={w.executed} empty="No leases fully executed this week" /></Section>;
  const secInProc = <Section key="inproc" title="Leases In Process" count={`${fmtInt(pl.now)} at week end${pl.noSent ? ` + ${fmtInt(pl.noSent)} with no sent date` : ''}`} note={`Lease Sent Date on or before ${fmtDate(w.weekEnd)} and not signed by then. Days = ${w.isCurrent ? 'today' : 'week end'} less Lease Sent Date.`}
    strip={strip([['In process', fmtInt(pl.now), `${fmtInt(pl.over21)} over 21 days`, pl.over21 ? 'warn' : ''], ['Prior week', fmtInt(pl.prev), D(diff(pl.now, pl.prev), fmtSigned)], ly ? [ly, isNum(pl.ly) ? fmtInt(pl.ly) : 'n/a', isNum(pl.ly) ? D(diff(pl.now, pl.ly), fmtSigned) : 'no sent dates'] : null, pl.noSent ? ['No sent date', fmtInt(pl.noSent), 'not dated into any week', 'warn'] : null])} fold defaultOpen={!slides}>
    {yoyStrip(w.inProcessYoY, 'In process')}<Table cols={inProcessCols} rows={inProcessRows} empty="No leases in process" /></Section>;
  const secInact = <Section key="inact" title="Lease Records Made Inactive This Week" count={fmtInt(w.inactivated.length)} note={w.inactivationsAvailable === false ? 'System notes are not readable by this role, so this section cannot be filled (see SETUP-CHECKLIST).' : `From system notes (Inactive set to Yes) ${fmtDate(w.week)} – ${fmtDate(w.weekEnd)}, all academic years.`}
    strip={strip([['Made inactive', fmtInt(w.inactivated.length), 'this week', w.inactivated.length ? 'warn' : ''], ['Beds affected', fmtInt(inacBeds), 'across all academic years'], ['Still inactive', fmtInt((w.inactivated || []).filter((r) => r.stillInactive).length), 'not reactivated']])} fold>
    <Table cols={inactCols} rows={w.inactivated} empty={w.inactivationsAvailable === false ? 'Unavailable to this role' : 'No lease records were made inactive this week'} /></Section>;
  const secPace = <Section key="pace" title="Leasing Pace" count="cumulative occupancy by week" note={`Occupancy at each week end${ly ? `; ${ly} shifted onto this year’s calendar (same week of the leasing cycle)` : ''}. ${basisNote}.`}
    strip={strip([['Pre-leased', fmtPct(s.occPct), `${fmtInt(s.occ)} of ${fmtInt(w.totalBeds)} beds`], ['vs prior week', D(s.dOccPct, fmtPts), `${fmtInt(s.newBeds)} beds this week`], ly ? [`vs ${ly}`, D(s.vsLyPct, fmtPts), `${ly} ${fmtPct(s.lyOccPct)}`] : null, ['Beds to go', fmtInt(w.totalBeds - (s.occ || 0)), 'unleased at week end']])}>
    <PaceChart pts={w.chart.pts} ahead={w.chart.ahead} ayStart={w.chart.ayStart} curName={`AY ${ayShort(w.ay)}`} lyName={ly ? `AY ${ly}` : null} big={big} /></Section>;
  const secHist = <HistorySection key="hist" w={w} ly={ly} strip={strip} slides={slides} />;

  if (slides) return { pre: { beds: w.totalBeds, occ: s.occ, occPct: s.occPct, lyOcc: s.lyOcc, lyOccPct: s.lyOccPct, vsLyPct: s.vsLyPct, dOccPct: s.dOccPct, newBeds: s.newBeds, newLeases: s.newLeases, leases: s.leases, lyLeases: s.lyLeases, trev: s.trev, lyTrev: s.lyTrev, mrev: s.mrev, lyMrev: s.lyMrev, inProcess: pl.now, over21: pl.over21, sent: (w.sentThisWeek || []).length, executed: w.executed.length, inactivated: (w.inactivated || []).length }, group: [secExec, secSent, secInProc, secInact], pace: secPace, history: secHist, ly };

  return (
    <div className="wk">
      <div className="sec-head wk-head">
        <div><h3>Weekly Leasing Report · {ayShort(w.ay)}</h3><p className="muted small">Week of {fmtDate(w.week)} – {fmtDate(w.weekEnd)}{w.isCurrent ? ' (this week, to date)' : ''} · {basisNote}{ly ? ` · LY = same week of ${ly} (${fmtDate(w.lyWeek)} – ${fmtDate(w.lyWeekEnd)})` : ''}</p></div>
        <div className="toolbar">
          <Button small onClick={() => step(-1)} disabled={i >= w.weekOptions.length - 1} title="Previous week">←</Button>
          <Select label="Week" value={w.week} onChange={(v) => setWeek(v === w.weekOptions[0].value ? '' : v)} options={w.weekOptions.map((o, k) => ({ value: o.value, label: `${fmtDate(o.value)} – ${fmtDate(o.label.split(' – ')[1])}${k === 0 ? ' (this week)' : ''}` }))} />
          <Button small onClick={() => step(1)} disabled={w.isCurrent} title="Next week">→</Button>
          <Segmented ariaLabel="Group by" value={w.groupBy} onChange={setGroupBy} options={[{ value: 'market', label: 'By market' }, { value: 'fund', label: 'By fund' }]} />
          {onPresent && <Button small kind="primary" onClick={onPresent}>▭ Present</Button>}
        </div>
      </div>
      <div className="wk-cmp">{cmpCard(c.year, 'year', c.pw && c.pw.year, yearTail)}{cmpCard(c.month, 'month', c.pw && c.pw.month)}{cmpCard(c.week, 'week', c.pw && c.pw.week)}</div>
      <p className="muted small">Figures run to {fmtDate(c.asOf)}{c.partial ? ' (week still in progress)' : ''}. {c.hasLy ? `Last year is the same number of elapsed days, ${fmtInt(c.lyShiftDays)} days earlier (the AY-start gap rounded to whole weeks).` : 'No prior academic year to compare against.'}</p>
      <div className="tiles six">
        <Tile label="Occupancy" value={fmtPct(s.occPct)} bar={s.occPct} tone={ly ? paceTone(s.vsLyPct) : occTone(s.occPct)} rows={[pw(fmtPct(prev.occPct), D(s.dOccPct, fmtPts)), lw(fmtPct(s.lyOccPct), D(s.vsLyPct, fmtPts))]} note={`of ${fmtInt(w.totalBeds)} beds`} />
        <Tile label="Occupied Beds" value={fmtInt(s.occ)} rows={[pw(fmtInt(prev.occ), D(s.dOcc, fmtSigned)), lw(fmtInt(s.lyOcc), D(diff(s.occ, s.lyOcc), fmtSigned))]} />
        <Tile label="Beds Leased This Week" value={fmtInt(s.newBeds)} rows={[pw(fmtInt(prev.newBeds), D(diff(s.newBeds, prev.newBeds), fmtSigned)), lw(fmtInt(s.lyNewBeds), D(diff(s.newBeds, s.lyNewBeds), fmtSigned))]} />
        <Tile label={`Leases ${signedWord} This Week`} value={fmtInt(s.newLeases)} rows={[pw(fmtInt(prev.newLeases), D(diff(s.newLeases, prev.newLeases), fmtSigned)), lw(fmtInt(s.lyNewLeases), D(diff(s.newLeases, s.lyNewLeases), fmtSigned))]} />
        <Tile label="Total Revenue Leased" value={fmtMoney(s.trev)} rows={[pw(fmtMoneyK(prev.trev), D(s.dTrev, fmtSignedMoney)), lw(fmtMoneyK(s.lyTrev), D(isNum(s.lyTrev) && s.lyTrev > 0 ? s.trev / s.lyTrev - 1 : null, fmtGrowth))]} note="full term" />
        <Tile label="Leases In Process" value={fmtInt(pl.now)} tone={pl.over21 ? 'warn' : null} rows={[pw(fmtInt(pl.prev), D(diff(pl.now, pl.prev), fmtSigned)), lw(isNum(pl.ly) ? fmtInt(pl.ly) : 'n/a', isNum(pl.ly) ? D(diff(pl.now, pl.ly), fmtSigned) : null)]} note={pl.over21 ? `${fmtInt(pl.over21)} over 21 days` : 'at week end'} />
      </div>
      {w.undated.leases > 0 && <p className="warn-note small">⚠ {fmtInt(w.undated.leases)} counted lease{w.undated.leases === 1 ? '' : 's'} ({fmtInt(w.undated.beds)} beds) have no {w.basis === 'executed' ? 'signed' : 'sent or signed'} date, so the weekly figures leave them out (Exceptions › Lease dates).</p>}
      <Section title={`By ${groupLabel}`} count={`week ending ${fmtDate(w.weekEnd)}`} note={`Occupancy at week end; WoW = change vs the prior week end; ${ly ? `LY = the same week of ${ly}; ` : ''}Beds Leased = leases dated this week.`}>
        <Table cols={gCols} rows={w.byGroup} keyOf={(r) => r.name} foot={w.byGroup.length > 1 ? totalRow : null} />
      </Section>
      {secSent}{secExec}{secInProc}{secPace}{secHist}{secInact}
      <VelocitySection sel={sel} totalBeds={w.totalBeds} />
    </div>
  );
}
function HistorySection({ w, ly, strip, slides }) {
  const [n, setN] = useState(8);
  const rows = w.history.slice().reverse();
  const s = w.sel || {}, prev = w.prev || {};
  const shown = n ? rows.slice(0, n) : rows;
  const cols = [{ label: 'Week', align: 'l', value: (h) => `${fmtDate(h.week)} – ${fmtDate(h.weekEnd)}` }, { label: 'Leases', value: (h) => fmtInt(h.newLeases) }, { label: 'Beds Leased', value: (h) => fmtInt(h.newBeds) }, { label: 'Occupied Beds', value: (h) => fmtInt(h.occ) }, { label: 'Occ. %', value: (h) => fmtPct(h.occPct) }, { label: 'WoW', value: (h) => D(h.dOccPct, fmtPts) }, { label: 'Total Revenue', value: (h) => fmtMoney(h.trev) },
    ...(ly ? [{ label: 'LY Beds Leased', value: (h) => fmtInt(h.lyNewBeds) }, { label: 'LY Occ. %', value: (h) => fmtPct(h.lyOccPct) }, { label: 'vs LY', value: (h) => D(h.vsLyPct, fmtPts) }] : [])];
  return <Section title="Week-over-Week History" count={`${fmtInt(rows.length)} weeks`} note={`Cumulative figures at each week end, restated from today’s active leases.${ly ? ` ${ly} columns = the same week of the prior AY.` : ''}`}
    strip={strip([['This week', fmtPct(s.occPct), `${fmtDate(w.week)} – ${fmtDate(w.weekEnd)}`], ['Prior week', fmtPct(prev.occPct), D(s.dOccPct, fmtPts)], ['Weeks tracked', fmtInt(rows.length), 'restated from live leases']])} fold defaultOpen={!slides}>
    {rows.length > 8 && <div className="toolbar small"><Segmented ariaLabel="Weeks shown" value={n} onChange={setN} options={[{ value: 8, label: 'Last 8' }, ...(rows.length > 26 ? [{ value: 26, label: '26' }] : []), { value: 0, label: 'All' }]} /></div>}
    <Table cols={cols} rows={shown} keyOf={(h) => h.week} rowClass={(h) => (h.week === w.week ? 'cur' : '')} /></Section>;
}
function VelocitySection({ sel, totalBeds }) {
  const [basis, setBasis] = useState(sel.basis);
  const [open, setOpen] = useState(false);
  const { data, error } = useRoute('velocity', { ay: sel.ay, fund: sel.fund, market: sel.market }, open);
  return <Section title="Leasing Velocity" count="this academic year against the last three" note="Counted leases by days from the academic year start, cumulative. Hover a line for its total.">
    <Disclosure summary="Show chart" onToggle={setOpen}>
      {error ? <ErrorBox error={error} /> : !data ? <p className="muted small">Loading…</p> : <><div className="toolbar small"><Segmented ariaLabel="Basis" value={basis} onChange={setBasis} options={[{ value: 'proforma', label: 'Pro-forma' }, { value: 'executed', label: 'Executed' }]} /></div><VelocityChart rows={data[basis]} ays={data.ays} totalBeds={totalBeds} basisLabel={basis === 'executed' ? 'Dated by Lease Signed Date' : 'Dated by Lease Sent Date'} /></>}
    </Disclosure>
  </Section>;
}
