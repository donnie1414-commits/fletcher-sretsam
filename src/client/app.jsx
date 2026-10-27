/** Client entry: four top-level items, one accent, shell-first. Everything else fetches its own JSON when opened (§3.6). */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getBootstrap, isPreview, BUILD, serverBuild, stylesApplied, post } from './api.js';
import { useUrlState, usePref, useMedia } from './state.js';
import { Segmented, Select, Button, cx } from './ui.jsx';
import { Today } from './screens/Today.jsx';
import { Pipeline } from './screens/Pipeline.jsx';
import { People } from './screens/People.jsx';
import { Reporting } from './screens/Reporting.jsx';
import { ExceptionsDrawer, useExceptionCount } from './screens/ExceptionsDrawer.jsx';
import { MARKETS, FUNDS, FUND_ORDER, BASES, CALENDAR_URL } from '../shared/constants.js';
import { ayShort } from './format.js';

function App({ boot }) {
  const [url, setUrl] = useUrlState({ view: 'today', ay: String(boot.defaultAy || boot.currentAy), basis: 'proforma', fund: '', market: '', sub: 'summary', rt: 'occrev', seg: 'tenants', q: '' });
  const [theme, setTheme] = usePref('theme', 'auto');
  const [density, setDensity] = usePref('density', 'comfortable');
  const [present, setPresent] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const isMobile = useMedia('(max-width: 720px)');
  const [styled, setStyled] = useState(true);
  useEffect(() => { setStyled(stylesApplied()); }, []);
  const sb = serverBuild();
  const staleFiles = !isPreview() && sb && sb !== 'dev' && BUILD !== 'dev' && sb !== BUILD;
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme === 'auto' ? '' : theme); }, [theme]);
  const sel = useMemo(() => ({ ay: Number(url.ay), basis: url.basis, fund: url.fund || null, market: url.market || null, q: url.q || '' }), [url.ay, url.basis, url.fund, url.market, url.q]);
  const excCount = useExceptionCount(sel);
  const go = (view, patch = {}) => setUrl({ view, ...patch });
  const markets = MARKETS.filter((m) => boot.markets.includes(m.id));
  const ays = boot.academicYears.map((a) => ({ value: String(a.year), label: `AY ${a.short}` }));
  return (
    <div className={cx('app', present && 'is-present', `density-${density}`)}>
      <header className="top">
        <div className="brand">{!isPreview() && <a className="ns-back" href="/app/center/card.nl" title="Back to NetSuite">← NetSuite</a>}<span className="brand-mark" aria-hidden="true" /> Amicus Leasing {isPreview() && <span className="pill pill-muted">preview · snapshot {boot.snapshotDate || ''}</span>}</div>
        {!present && <nav className="nav" aria-label="Primary"><Segmented ariaLabel="Screen" value={url.view} onChange={(v) => go(v)} options={[{ value: 'today', label: 'Today' }, { value: 'pipeline', label: 'Pipeline' }, { value: 'people', label: 'People' }, { value: 'reporting', label: 'Reporting' }]} /></nav>}
        <div className="controls">
          <Select label="Year" value={url.ay} onChange={(v) => setUrl({ ay: v })} options={ays} />
          <Segmented ariaLabel="Basis" value={url.basis} onChange={(v) => setUrl({ basis: v })} options={Object.values(BASES).map((b) => ({ value: b.id, label: b.id === 'proforma' ? 'Pro-forma' : 'Executed' }))} />
          <Select label="Fund" value={url.fund} onChange={(v) => setUrl({ fund: v })} options={[{ value: '', label: 'All funds' }, ...FUND_ORDER.map((k) => ({ value: k, label: FUNDS[k].label }))]} />
          <Select label="Market" value={url.market} onChange={(v) => setUrl({ market: v })} options={[{ value: '', label: boot.scope.all ? 'All markets' : 'My markets' }, ...markets.map((m) => ({ value: m.id, label: m.label }))]} />
          {!present && <input className="search" type="search" placeholder="Search units, properties, tenants" aria-label="Search" defaultValue={url.q} onKeyDown={(e) => { if (e.key === 'Enter') setUrl({ q: e.target.value, view: url.view === 'people' ? 'people' : 'pipeline' }); }} onBlur={(e) => e.target.value !== url.q && setUrl({ q: e.target.value })} />}
          <button type="button" className={cx('badge-btn', excCount > 0 && 'has')} onClick={() => setDrawer(true)} aria-label={`Exceptions: ${excCount ?? '…'}`} title="Exceptions">⚠ {excCount == null ? '…' : excCount}</button>
          {isPreview() ? <Button small title="Preview: NetSuite's calendar opens here in NetSuite" disabled>Calendar</Button> : <a className="btn btn-sm" href={CALENDAR_URL} target="_blank" rel="noreferrer" title="My NetSuite calendar (tours are events on it)">Calendar</a>}
          {!isPreview() && boot.links && boot.links.auditLog && <a className="btn btn-sm" href={boot.links.auditLog} target="_blank" rel="noreferrer" title="Every change the hub has made: who, when, old and new value">Change log</a>}
          <Button small onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')} title={`Theme: ${theme}`} aria-label="Toggle theme">{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</Button>
          <Button small onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} title="Density" aria-label="Toggle density">{density === 'compact' ? '≡' : '☰'}</Button>
          <Button small onClick={() => setPresent(!present)} title="Presentation mode" aria-label="Presentation mode">{present ? 'Exit' : '▭'}</Button>
          {!isMobile && <span className="build" title={sb && sb !== BUILD ? `app files ${BUILD} · Suitelet ${sb}` : 'Build id: compare with MANIFEST.json after an upload'}>build {BUILD}</span>}
        </div>
      </header>
      {staleFiles && <div className="banner warn">The app files NetSuite is serving are from build <code>{BUILD}</code>, but the Suitelet is build <code>{sb}</code>. Re-upload <code>amicus_leasing_app.js</code> and <code>amicus_leasing_app.css</code> from the same hand-back as the Suitelet (DEPLOY.md, section 6), then reload with Ctrl+Shift+R.</div>}
      {!styled && <div className="banner warn">The stylesheet did not apply, so this page is unstyled. In the File Cabinet open <code>amicus_leasing_app.css</code>, check its type is CSS File (not Plain Text) and that it starts with <code>:root{'{'}--accent</code>, then reload with Ctrl+Shift+R.</div>}
      {!boot.scope.all && boot.scope.marketIds.length === 0 && <div className="banner warn">You have no market access: {boot.scope.reason}. Ask an administrator to set your markets.</div>}
      {boot.degraded && boot.degraded.length > 0 && url.view !== 'reporting' && <div className="banner">Some fields are not created yet, so these features are off: {boot.degraded.map((d) => d.feature || d.field).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}. {!isPreview() && <button type="button" className="linkish" onClick={async () => { await post('reprobe', {}); window.location.reload(); }}>Re-check now</button>}</div>}
      <main className="main">
        {url.view === 'today' && <Today sel={sel} go={go} openExceptions={() => setDrawer(true)} bootstrap={boot} />}
        {url.view === 'pipeline' && <Pipeline sel={sel} setSel={setUrl} density={density} isMobile={isMobile} bootstrap={boot} />}
        {url.view === 'people' && <People sel={sel} seg={url.seg} setSeg={(v) => setUrl({ seg: v })} density={density} isMobile={isMobile} bootstrap={boot} />}
        {url.view === 'reporting' && <Reporting sel={sel} sub={url.sub} setSub={(v) => setUrl({ sub: v })} rt={url.rt} setRt={(v) => setUrl({ rt: v })} density={density} presentation={present} boot={boot} />}
      </main>
      <ExceptionsDrawer open={drawer} onClose={() => setDrawer(false)} sel={sel} bootstrap={boot} />
    </div>
  );
}
function boot() {
  const el = document.getElementById('root');
  const b = getBootstrap();
  if (!el) return;
  if (!b) { el.textContent = 'Bootstrap JSON missing.'; return; }
  createRoot(el).render(<App boot={b} />);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
