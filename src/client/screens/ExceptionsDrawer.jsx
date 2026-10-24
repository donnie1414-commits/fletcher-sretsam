import { useState } from 'react';
import { useRoute } from '../hooks.js';
import { recordUrl, isPreview } from '../api.js';
import { Drawer, Disclosure, Button, Pill, Skeleton, ErrorBox, Dot } from '../ui.jsx';
import { fmtInt, fmtMoney, fmtDate, toCSV, downloadCSV } from '../format.js';
import { MARKETS } from '../../shared/constants.js';

const sevTone = (s) => (s <= 1 ? 'crit' : s <= 2 ? 'warn' : s <= 3 ? 'note' : 'muted');
export function useExceptionCount(sel) { const { data } = useRoute('exceptions', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market }); return data ? data.count : null; }
export function ExceptionsDrawer({ open, onClose, sel }) {
  const { data, error, loading } = useRoute('exceptions', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market }, open);
  return (
    <Drawer open={open} onClose={onClose} title={`Exceptions · AY ${String(sel.ay).slice(2)}-${String(sel.ay + 1).slice(2)}`} width={640}>
      {error ? <ErrorBox error={error} /> : loading || !data ? <Skeleton rows={5} cols={2} /> : (
        <div>
          <p className="muted">{fmtInt(data.count)} items in your markets, by severity. {data.overlapRule ? 'Overlap rule on: sequential leases are not conflicts.' : 'Legacy rule: any two leases on one scope in one year are a conflict (overlap rule pending sign-off).'}</p>
          {data.tenantDoubles.length > 0 && <section className="alert"><h3>Double-booked tenants ({data.tenantDoubles.length})</h3>
            {data.tenantDoubles.map((d) => <div key={d.tenantId} className="alert-row"><a className="link" href={recordUrl('customer', d.tenantId)} target="_blank" rel="noreferrer">Tenant #{d.tenantId}</a> is on {d.leases.map((l) => <span key={l.leaseId}> <a className="link" href={recordUrl('lease', l.leaseId)} target="_blank" rel="noreferrer">{l.leaseName}</a> ({l.property}{l.unit ? ' · ' + l.unit : ''}, {MARKETS.find((m) => m.id === l.market)?.label || l.market}, {fmtMoney(l.monthlyRent)}/mo, {fmtDate(l.start)}–{fmtDate(l.end)})</span>).reduce((a, b) => [a, ' and', b])}. Monthly rent counted twice: {fmtMoney(Math.min(...d.leases.map((l) => l.monthlyRent)))}.</div>)}
          </section>}
          {data.groups.filter((g) => g.code !== 'TENANT_DOUBLE').map((g) => (
            <Disclosure key={g.code} summary={<span><Dot level={g.severity <= 1 ? 2 : g.severity <= 3 ? 1 : 0} /> {g.label} <span className="count">{g.rows.length}</span>{!g.excludes && <Pill tone="muted">does not exclude</Pill>}</span>} defaultOpen={g.severity <= 1}>
              <p className="muted small">{g.meaning}</p>
              <p className="small"><strong>To fix:</strong> {g.action}</p>
              <div className="toolbar"><Button small onClick={() => downloadCSV(`exceptions-${g.code}.csv`, toCSV(g.rows, [{ key: 'leaseName', label: 'Lease' }, { key: 'property', label: 'Property' }, { key: 'unit', label: 'Unit' }, { key: 'bedroom', label: 'Bedroom' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'monthlyRent', label: 'Monthly' }, { key: 'detail', label: 'Detail' }, { key: 'partners', label: 'With', value: (r) => r.partners.join(' ') }]))}>CSV</Button></div>
              <ul className="exc-list">{g.rows.map((r, i) => <ExceptionRow key={r.leaseId + ':' + i} r={r} />)}</ul>
            </Disclosure>
          ))}
          {!data.groups.length && <p>No exceptions in your markets for this year.</p>}
        </div>
      )}
    </Drawer>
  );
}
function ExceptionRow({ r }) {
  const [fix, setFix] = useState(false);
  return (
    <li>
      <div><a className="link" href={recordUrl('lease', r.leaseId)} target="_blank" rel="noreferrer">{r.leaseName}</a> <span className="muted small">{r.typeKey} · {r.statusKey === 'NONE' ? 'no status' : r.statusKey} · {fmtDate(r.start)}–{fmtDate(r.end)} · {fmtMoney(r.monthlyRent)}/mo</span></div>
      <div className="muted small">{r.property && <a className="link" href={recordUrl('property', r.propertyId)} target="_blank" rel="noreferrer">{r.property}</a>}{r.unit && <> · <a className="link" href={recordUrl('unit', r.unitId)} target="_blank" rel="noreferrer">{r.unit}</a></>}{r.bedroom && <> · {r.bedroom}</>}{r.detail && <> · {r.detail}</>}{r.partners.length > 0 && <> · with {r.partners.map((p) => <a key={p} className="link" href={recordUrl('lease', p)} target="_blank" rel="noreferrer">#{p}</a>).reduce((a, b) => [a, ', ', b])}</>}{r.overlapDays != null && <> · overlaps {r.overlapDays} days</>}</div>
      <div className="fixbar"><Button small onClick={() => setFix(!fix)}>{fix ? 'Hide fix' : 'Fix…'}</Button>{fix && <span className="small muted"> Relink, change type, correct dates or academic year, set status, or inactivate — each shows its before → after and re-runs this rule. {isPreview() ? 'Disabled in the preview: nothing is written.' : 'Available once the write module is enabled for this role.'}</span>}</div>
    </li>
  );
}
