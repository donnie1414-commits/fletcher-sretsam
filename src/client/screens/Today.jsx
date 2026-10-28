import { useState } from 'react';
import { useRoute } from '../hooks.js';
import { invalidate, isPreview } from '../api.js';
import { Skeleton, ErrorBox, Button, Empty, Pill } from '../ui.jsx';
import { fmtInt, fmtDate } from '../format.js';
import { StagePill } from './Pipeline.jsx';
import { TourDialog, TourLine } from './people/TourDialog.jsx';
import { LeadDialog } from './people/LeadDialog.jsx';

export function Today({ sel, go, openExceptions, bootstrap }) {
  const { data, error, loading } = useRoute('today', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  const [dialog, setDialog] = useState(null); // { kind: 'tour', lead?, tour? } | { kind: 'lead' }
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Skeleton rows={6} cols={3} />;
  const refresh = () => { for (const k of ['today', 'tours', 'leads', 'pipeline']) invalidate(k); };
  const nothing = !data.followups.count && !data.stale.count && !data.exceptions.count && !data.blockedTenants.missingProperty && !data.blockedTenants.missingAy && !data.tours.count && !data.leads.count;
  const Section = ({ title, count, children, action }) => <section className="queue"><h3>{title} <span className="count">{fmtInt(count)}</span>{action}</h3>{children}</section>;
  const tours = data.tours || {};
  return (
    <div className="screen today">
      <p className="muted">Everything here already exists elsewhere; this is the part that needs you, in your markets, for AY {String(sel.ay).slice(2)}-{String(sel.ay + 1).slice(2)}.</p>
      {nothing && <Empty title="Nothing needs you today" body="No tours, no follow-ups due, no stale stages, no new leads waiting, no blocked tenants, no exceptions in your markets." />}
      <Section title="Tours today and tomorrow" count={tours.count} action={<span className="hdr-actions">{tours.available !== false && <Button small kind="primary" onClick={() => setDialog({ kind: 'tour' })}>Schedule tour…</Button>}{!isPreview() && tours.calendarUrl && <a className="btn btn-sm" href={tours.calendarUrl} target="_blank" rel="noreferrer">My calendar</a>}</span>}>
        {tours.available === false ? <p className="muted small">Tours are off: {tours.note}.</p> : tours.count ? <ul className="queue-list">{tours.rows.map((t) => <li key={t.id}><TourLine t={t} onEdit={(x) => setDialog({ kind: 'tour', tour: x })} /></li>)}</ul> : <p className="muted small">No tours on the books for today or tomorrow{tours.week ? ` · ${fmtInt(tours.week)} of yours later this week` : ''}.</p>}
        {tours.count > 0 && tours.week > tours.rows.filter((t) => String(t.organizerId) === String(tours.me)).length && <p className="muted small">{fmtInt(tours.week)} of yours this week in total.</p>}
      </Section>
      {data.followups.count > 0 && <Section title="Follow-ups due or overdue" count={data.followups.count} action={<Button small onClick={() => go('pipeline', { q: '' })}>Open pipeline</Button>}>
        <ul className="queue-list">{data.followups.rows.map((r) => <li key={r.key}><button type="button" className="linkish" onClick={() => go('pipeline', { q: r.unit === '(whole property)' ? r.property : r.unit })}>{r.property} · {r.unit}</button> <span className="muted">{fmtDate(r.followup)}</span> <StagePill stageKey={r.stage} days={r.daysInStage} />{r.expectedTenants && <span className="muted small"> {r.expectedTenants}</span>}</li>)}</ul>
      </Section>}
      {data.stale.count > 0 && <Section title={`In a stage longer than ${data.stale.thresholdDays} days`} count={data.stale.count}>
        <ul className="queue-list">{data.stale.rows.map((r) => <li key={r.key}><button type="button" className="linkish" onClick={() => go('pipeline', { q: r.unit === '(whole property)' ? r.property : r.unit })}>{r.property} · {r.unit}</button> <StagePill stageKey={r.stage} days={r.daysInStage} /></li>)}</ul>
      </Section>}
      <Section title="Leads with no next action" count={data.leads.count} action={<span className="hdr-actions"><Button small kind="primary" onClick={() => setDialog({ kind: 'lead' })}>+ Add lead</Button><Button small onClick={() => go('people', { seg: 'leads' })}>Open leads</Button></span>}>
        {data.leads.count ? <ul className="queue-list">{data.leads.rows.map((l) => <li key={l.id}><strong>{l.name}</strong> <Pill tone={l.statusId === 18 ? 'active' : 'info'}>{l.status}</Pill> <span className="muted small">{[l.school, l.desiredLocation ? `asked for ${l.desiredLocation}` : null, l.created ? `since ${fmtDate(l.created)}` : null].filter(Boolean).join(' · ')}</span> {tours.available !== false && <button type="button" className="linkish small" onClick={() => setDialog({ kind: 'tour', lead: l })}>schedule tour</button>}</li>)}</ul> : <p className="muted small">Every new inquiry in your markets has a property or a tour.</p>}
        {data.leads.count > data.leads.rows.length && <p className="muted small">Showing {data.leads.rows.length} of {fmtInt(data.leads.count)}.</p>}
      </Section>
      <Section title="Tenants who cannot be attached to a lease" count={data.blockedTenants.missingProperty + data.blockedTenants.missingAy} action={<Button small onClick={() => go('people', { seg: 'tenants' })}>Open tenants</Button>}>
        <p className="muted small">{fmtInt(data.blockedTenants.missingProperty)} with no Property, {fmtInt(data.blockedTenants.missingAy)} with no Academic Year.</p>
        <ul className="queue-list">{data.blockedTenants.sample.map((t) => <li key={t.id}>{t.name} <span className="muted small">{t.desiredLocation ? `asked for ${t.desiredLocation}` : ''}</span></li>)}</ul>
      </Section>
      <Section title="Exceptions in your markets" count={data.exceptions.count} action={<Button small onClick={openExceptions}>Open drawer</Button>}>
        <ul className="queue-list">{data.exceptions.byCode.map((g) => <li key={g.code}><button type="button" className="linkish" onClick={openExceptions}>{g.label}</button> <span className="muted">{fmtInt(g.n)}</span></li>)}</ul>
      </Section>
      {dialog && dialog.kind === 'tour' && <TourDialog lead={dialog.lead} tour={dialog.tour} sel={sel} bootstrap={bootstrap} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog && dialog.kind === 'lead' && <LeadDialog sel={sel} bootstrap={bootstrap} onClose={() => setDialog(null)} onDone={refresh} onTourFor={(lead) => setDialog({ kind: 'tour', lead })} />}
    </div>
  );
}
