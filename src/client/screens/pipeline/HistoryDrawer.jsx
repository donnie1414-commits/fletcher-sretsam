import { useRoute } from '../../hooks.js';
import { recordUrl } from '../../api.js';
import { Drawer, Skeleton, ErrorBox, Pill } from '../../ui.jsx';
import { fmtInt, fmtMoney, fmtMoney2, fmtDate, ayShort } from '../../format.js';
import { StagePill } from '../Pipeline.jsx';

/** The per-unit leasing-history drawer (v2 row expander): rent by academic year, settle floor, beds available, stage log, notes, prior tenants. */
export function HistoryDrawer({ row, sel, onClose, onOpenNotes, onOpenLease }) {
  const { data, error, loading } = useRoute('unithistory', { ay: sel.ay, basis: sel.basis, unit: row ? row.key : null }, !!row);
  if (!row) return null;
  return (
    <Drawer open onClose={onClose} title={row.unit === '(whole property)' ? row.property : row.unit} subtitle={`${row.property} · ${row.marketLabel || row.market}`} width={720}>
      {error ? <ErrorBox error={error} /> : loading || !data ? <Skeleton rows={6} cols={3} /> : (
        <div className="two-col">
          <div>
            <h4>Rent by academic year</h4>
            <table className="mini wide"><thead><tr><th>Academic year</th><th>Monthly</th><th>Per bed</th><th>Status</th></tr></thead><tbody>
              {data.years.map((y) => <tr key={y.year} className={y.kind === 'current' ? 'cur' : ''}><th>{y.label}</th><td>{fmtMoney(y.kind === 'current' && y.actual != null ? y.actual : y.monthly)}</td><td>{fmtMoney(y.kind === 'current' && y.actual != null && row.beds ? y.actual / row.beds : y.perBed)}</td><td className="l muted">{y.kind === 'current' ? (y.actual != null ? `Signed ${fmtMoney(y.actual)} · target ${fmtMoney(y.monthly)}` : y.status === 'Not started' ? 'Not started' : <StagePill stageKey={data.stage} />) : y.status}</td></tr>)}
            </tbody></table>
            <dl className="kv">
              <dt>Settle floor</dt><dd>{fmtMoney(data.settleMonthly)}{data.breach && <span className="warn-text"> signed below it</span>}</dd>
              <dt>Offered /bed</dt><dd>{fmtMoney(data.lastOffer)}</dd>
              {row.bedrooms.length > 0 && <><dt>Beds available</dt><dd>{row.bedrooms.filter((b) => b.free).length ? `${fmtInt(row.bedrooms.filter((b) => b.free).length)} of ${fmtInt(row.beds)} · ${row.bedrooms.filter((b) => b.free).map((b) => b.name).join(', ')}` : `none — all ${fmtInt(row.beds)} are spoken for`}</dd></>}
              {data.unit.occupiedBy !== 'Vacant' && <><dt>Occupied by</dt><dd>{data.unit.occupiedBy}{[['Whole house', data.unit.occWH], ['Unit', data.unit.occUnit], ['Bedroom', data.unit.occBed]].filter((x) => x[1]).length > 1 && <span className="muted small"> ({[['WH', data.unit.occWH], ['Unit', data.unit.occUnit], ['Bed', data.unit.occBed]].filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}`).join(' · ')})</span>}{(data.unit.leaseStart || data.unit.leaseEnd) && <div className="muted small">{fmtDate(data.unit.leaseStart)} – {fmtDate(data.unit.leaseEnd)}</div>}</dd></>}
            </dl>
            {data.log.length > 0 && <><h4>Stage log</h4><ul className="log">{data.log.slice().reverse().map((l) => <li key={l.id}><span className="muted small">{fmtDate(l.date)}</span> {l.from || 'none'} → <strong>{l.to || 'none'}</strong> <span className="muted small">({l.source})</span></li>)}</ul></>}
          </div>
          <div>
            <h4>Pre-leasing</h4>
            <dl className="kv">
              <dt>Stage</dt><dd><StagePill stageKey={data.stage} days={data.daysInStage} /> <span className="muted small">{data.stageSource === 'lease' ? '(from the lease)' : data.stageSource === 'manual' ? '(set by leasing)' : ''}</span></dd>
              <dt>Days in stage</dt><dd>{data.daysInStage == null ? '–' : <>{data.daysInStage} <span className="muted small">since {fmtDate(data.stageDate)}</span></>}</dd>
              <dt>Lease</dt><dd>{data.leases.length ? data.leases.map((l) => <div key={l.id}><a className="link" href={recordUrl('lease', l.id)} target="_blank" rel="noreferrer">{l.name}</a> <span className="muted small">{l.typeLabel} · {l.status === 'EXECUTED' ? 'Fully Executed' : l.status === 'IN_PROCESS' ? 'In Process' : l.status} · {fmtMoney(l.monthly)}/mo · {fmtDate(l.start)} – {fmtDate(l.end)}{!l.placed && l.code ? ` · excluded: ${l.code}` : ''}</span></div>) : data.draftLease ? <div><a className="link" href={recordUrl('lease', data.draftLease.id)} target="_blank" rel="noreferrer">{data.draftLease.name}</a> <Pill tone="warn">no status</Pill><div className="small warn-text">This lease has no Lease Status, so it is out of every leasing statistic. Set it to In Process with the Sent Date once it goes out.</div></div> : <span className="muted">none yet</span>}
                {data.twoYear && <div className="small">Year {data.twoYear.year} of a {data.twoYear.of}-year lease — one record, counted in each year it runs.</div>}
                {data.leases.length > 1 && <div className="muted small">{data.leases.length} leases cover beds in this unit</div>}</dd>
              <dt>Sent / signed</dt><dd>{fmtDate(data.sent)} · {fmtDate(data.signed)}</dd>
              <dt>Current tenants</dt><dd>{data.priorTenants.length ? <>{data.priorTenants.map((t) => <a key={t.id} className="link" href={recordUrl('customer', t.id)} target="_blank" rel="noreferrer">{t.name}</a>).reduce((a, b) => [a, ', ', b])} <span className="muted small">({data.priorAyLabel})</span></> : <span className="muted">none on record</span>}</dd>
              <dt>Expected tenants</dt><dd>{data.expectedTenants || <span className="muted">none recorded</span>}</dd>
              <dt>Follow-up</dt><dd>{fmtDate(data.followup)}</dd>
              <dt>Notes</dt><dd>{fmtInt(data.notes.length)}{data.legacyNotes ? <div className="muted small">Legacy field: {data.legacyNotes}</div> : null} <button type="button" className="linkish" onClick={() => onOpenNotes(row)}>Open thread</button></dd>
            </dl>
            <div className="toolbar"><button type="button" className="btn btn-sm" onClick={() => onOpenLease(row)} disabled={!row.unitId}>{row.leaseTerms ? 'Lease terms · captured' : 'Create lease record…'}</button></div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
