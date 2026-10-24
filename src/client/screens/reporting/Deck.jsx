import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Button, Tile, Stat } from '../../ui.jsx';
import { fmtInt, fmtPct, fmtPts, fmtSigned, fmtMoneyK, fmtDate, ayFull, ayShort, isNum } from '../../format.js';
import { WeeklyBody } from './Weekly.jsx';

const D = (v, f) => (isNum(v) ? <span className={`delta ${v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : ''}`}>{f(v)}</span> : <span className="muted">–</span>);

/**
 * Present mode (v2 deck): one slide of pre-leasing across every future academic year, then for each of them a
 * "leasing activity this week" slide and a pace slide. ← → PageUp/Down move, Escape exits. Built from the same
 * weekly route as the tab, so nothing is computed twice.
 */
export function Deck({ sel, boot, onExit }) {
  const forward = boot.academicYears.filter((a) => a.start > boot.session.today);
  const [data, setData] = useState({});
  const [at, setAt] = useState(0);
  useEffect(() => { let alive = true; forward.forEach((a) => api('weekly', { ay: a.year, basis: sel.basis, fund: sel.fund, market: sel.market }).then((w) => alive && setData((d) => ({ ...d, [a.year]: w }))).catch((e) => alive && setData((d) => ({ ...d, [a.year]: { error: e.message } })))); return () => { alive = false; }; }, [sel.basis, sel.fund, sel.market]); // eslint-disable-line
  useEffect(() => { try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* optional */ } return () => { try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ } }; }, []);
  const slides = [{ kind: 'pre', title: 'Pre-leasing by academic year' }];
  for (const a of forward) { slides.push({ kind: 'group', title: 'Leasing activity this week', ay: a }); slides.push({ kind: 'pace', title: 'Leasing Pace', ay: a }); }
  const go = (i) => setAt(Math.max(0, Math.min(slides.length - 1, i)));
  useEffect(() => { const on = (e) => { if (e.key === 'Escape') onExit(); else if (/^(INPUT|TEXTAREA|SELECT|SUMMARY|BUTTON)$/.test((e.target || {}).tagName || '')) return; else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); } }; document.addEventListener('keydown', on); return () => document.removeEventListener('keydown', on); }, [at, slides.length]); // eslint-disable-line
  const sl = slides[at];
  const bodies = Object.fromEntries(forward.map((a) => [a.year, data[a.year] && !data[a.year].error ? WeeklyBody({ w: data[a.year], sel, slides: true, big: true }) : null]));
  const first = forward[0] && data[forward[0].year];
  const line = [first && !first.error ? `Week of ${fmtDate(first.week)} – ${fmtDate(first.weekEnd)}` : '', sel.market || sel.fund ? [sel.fund, sel.market].filter(Boolean).join(' · ') : 'All markets', sel.basis === 'executed' ? 'Fully Executed' : 'Pro-forma'].filter(Boolean).join(' · ');
  const ly = first && !first.error && first.priorAy ? ayShort(first.priorAy) : 'LY';
  const content = () => {
    if (!forward.length) return <div className="empty"><div className="empty-title">No future academic years to present</div><p className="muted">Add an Academic Year that starts after today, with leases against it.</p></div>;
    if (sl.kind === 'pre') {
      const cells = forward.map((a) => { const b = bodies[a.year]; const w = data[a.year]; if (!b) return <div key={a.year} className="cmp-tile"><h3>{ayFull(a.year)}</h3><p className="muted">{w && w.error ? w.error : 'Preparing…'}</p></div>; const p = b.pre; return <div key={a.year} className="cmp-tile"><div className="sec-head"><div><h3>{ayFull(a.year)}</h3><p className="muted small">Pre-leasing to AY {ayShort(a.year)}</p></div></div><div className="cmp-big"><span>Pre-leased</span><strong>{fmtPct(p.occPct)}</strong><small>{fmtInt(p.occ)} of {fmtInt(p.beds)} beds</small><div className="cmp-deltas"><em>vs {b.ly || ly}</em><span>{D(p.vsLyPct, fmtPts)}</span><em>vs prior wk</em><span>{D(p.dOccPct, fmtPts)}</span></div></div><div className="sec-tiles"><Stat value={fmtInt(p.newBeds)} label="This week" sub="beds leased" /><Stat value={fmtInt(p.sent)} label="Sent" sub="this week" /><Stat value={fmtInt(p.executed)} label="Executed" sub="this week" /><Stat value={fmtInt(p.inProcess)} label="In process" sub="at week end" /></div></div>; });
      const row = (label, pick, cls) => <tr key={label}><th>{label}</th>{forward.map((a) => <td key={a.year} className={cls}>{bodies[a.year] ? pick(bodies[a.year].pre) : <span className="muted">–</span>}</td>)}</tr>;
      const grp = (label) => <tr key={label} className="grp"><td colSpan={forward.length + 1}>{label}</td></tr>;
      const rentBed = (p) => (p.occ > 0 ? p.mrev / p.occ : null), lyRentBed = (p) => (p.lyOcc > 0 ? p.lyMrev / p.lyOcc : null);
      return <>
        <div className="wk-cmp">{cells}</div>
        <div className="sec"><div className="sec-head"><div><h3>Side by side <em className="sec-count">same week, same markets</em></h3><p className="muted small">Every academic year that has not started yet, measured at the same week ending and under the same market scope.</p></div></div>
          <table className="mini wide ay-tbl"><thead><tr><th>Metric</th>{forward.map((a) => <th key={a.year}>{ayFull(a.year)}</th>)}</tr></thead><tbody>
            {grp('Where the year stands')}{row('Total beds', (p) => fmtInt(p.beds))}{row('Pre-leased beds', (p) => fmtInt(p.occ))}{row('Pre-lease %', (p) => fmtPct(p.occPct), 'hi')}{row(`vs ${ly}`, (p) => D(p.vsLyPct, fmtPts))}{row('vs prior week', (p) => D(p.dOccPct, fmtPts))}{row('Beds still to lease', (p) => fmtInt(p.beds - (p.occ || 0)))}
            {grp('Movement this week')}{row('Beds leased this week', (p) => fmtInt(p.newBeds))}{row('Leases sent this week', (p) => fmtInt(p.sent))}{row('Executed this week', (p) => fmtInt(p.executed))}{row('In process at week end', (p) => <>{fmtInt(p.inProcess)}{p.over21 ? <span className="muted small"> ({fmtInt(p.over21)} over 21d)</span> : null}</>)}{row('Made inactive this week', (p) => fmtInt(p.inactivated))}
            {grp('Cumulative to date')}{row('Leases to date', (p) => <>{fmtInt(p.leases)}{p.lyLeases != null && <span className="muted small"> {ly} {fmtInt(p.lyLeases)}</span>}</>)}{row('Total revenue leased', (p) => <>{fmtMoneyK(p.trev)}{p.lyTrev != null && <span className="muted small"> {ly} {fmtMoneyK(p.lyTrev)}</span>}</>)}{row('Rent / bed', (p) => <>{isNum(rentBed(p)) ? `$${Math.round(rentBed(p))}` : '–'}{isNum(lyRentBed(p)) && <span className="muted small"> {ly} ${Math.round(lyRentBed(p))}</span>}</>)}
          </tbody></table></div>
      </>;
    }
    const b = bodies[sl.ay.year]; const w = data[sl.ay.year];
    if (!b) return <div className="empty"><div className="empty-title">{w && w.error ? w.error : 'Preparing…'}</div></div>;
    return sl.kind === 'group' ? <div className="deck-group">{b.group}</div> : <>{b.pace}{b.history}</>;
  };
  return (
    <div className="deck" role="dialog" aria-label="Presentation">
      <div className="deck-head"><div><span className="ay">{sl.ay ? ayFull(sl.ay.year) : 'All future academic years'}</span><h2>{sl.title}</h2><p className="muted">{line}</p></div><span className="pos">{at + 1} of {slides.length}</span></div>
      <div className="deck-body">{content()}</div>
      <div className="slide-bar"><b>{sl.title}</b><span className="spacer" /><span>{at + 1} / {slides.length}</span><Button small onClick={() => go(at - 1)} disabled={at === 0}>←</Button><Button small onClick={() => go(at + 1)} disabled={at >= slides.length - 1}>→</Button><Button small onClick={onExit}>Exit</Button></div>
    </div>
  );
}
