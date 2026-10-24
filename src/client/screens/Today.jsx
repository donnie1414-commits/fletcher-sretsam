import { useRoute } from '../hooks.js';
import { Skeleton, ErrorBox, Button, Empty } from '../ui.jsx';
import { fmtInt, fmtDate } from '../format.js';
import { StagePill } from './Pipeline.jsx';
import { EXCEPTION_CODES } from '../../shared/constants.js';

export function Today({ sel, go, openExceptions }) {
  const { data, error, loading } = useRoute('today', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Skeleton rows={6} cols={3} />;
  const nothing = !data.followups.count && !data.stale.count && !data.exceptions.count && !data.blockedTenants.missingProperty && !data.blockedTenants.missingAy;
  const Section = ({ title, count, children, action }) => <section className="queue"><h3>{title} <span className="count">{fmtInt(count)}</span>{action}</h3>{children}</section>;
  return (
    <div className="screen today">
      <p className="muted">Everything here already exists elsewhere; this is the part that needs you, in your markets, for AY {String(sel.ay).slice(2)}-{String(sel.ay + 1).slice(2)}.</p>
      {nothing && <Empty title="Nothing needs you today" body="No follow-ups due, no stale stages, no blocked tenants, no exceptions in your markets." />}
      {data.followups.count > 0 && <Section title="Follow-ups due or overdue" count={data.followups.count} action={<Button small onClick={() => go('pipeline', { q: '' })}>Open pipeline</Button>}>
        <ul className="queue-list">{data.followups.rows.map((r) => <li key={r.key}><button type="button" className="linkish" onClick={() => go('pipeline', { q: r.unit === '(whole property)' ? r.property : r.unit })}>{r.property} · {r.unit}</button> <span className="muted">{fmtDate(r.followup)}</span> <StagePill stageKey={r.stage} days={r.daysInStage} />{r.expectedTenants && <span className="muted small"> {r.expectedTenants}</span>}</li>)}</ul>
      </Section>}
      <Section title="Tours today and tomorrow" count={data.tours.count}><p className="muted small">{data.tours.note}</p></Section>
      {data.stale.count > 0 && <Section title={`In a stage longer than ${data.stale.thresholdDays} days`} count={data.stale.count}>
        <ul className="queue-list">{data.stale.rows.map((r) => <li key={r.key}><button type="button" className="linkish" onClick={() => go('pipeline', { q: r.unit === '(whole property)' ? r.property : r.unit })}>{r.property} · {r.unit}</button> <StagePill stageKey={r.stage} days={r.daysInStage} /></li>)}</ul>
      </Section>}
      <Section title="Leads with no next action" count={data.leads.count}><p className="muted small">{data.leads.note}</p></Section>
      <Section title="Tenants who cannot be attached to a lease" count={data.blockedTenants.missingProperty + data.blockedTenants.missingAy} action={<Button small onClick={() => go('people', { seg: 'tenants' })}>Open tenants</Button>}>
        <p className="muted small">{fmtInt(data.blockedTenants.missingProperty)} with no Property, {fmtInt(data.blockedTenants.missingAy)} with no Academic Year.</p>
        <ul className="queue-list">{data.blockedTenants.sample.map((t) => <li key={t.id}>{t.name} <span className="muted small">{t.desiredLocation ? `asked for ${t.desiredLocation}` : ''}</span></li>)}</ul>
      </Section>
      <Section title="Exceptions in your markets" count={data.exceptions.count} action={<Button small onClick={openExceptions}>Open drawer</Button>}>
        <ul className="queue-list">{data.exceptions.byCode.map((g) => <li key={g.code}><button type="button" className="linkish" onClick={openExceptions}>{g.label}</button> <span className="muted">{fmtInt(g.n)}</span></li>)}</ul>
      </Section>
    </div>
  );
}
