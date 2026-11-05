import { useRoute } from '../hooks.js';
import { Modal, Button, Skeleton, ErrorBox, Pill } from '../ui.jsx';
import { isPreview } from '../api.js';

/** What the hub expects in NetSuite and whether it exists, checked live. */
export function SetupStatus({ onClose }) {
  const { data, error, loading } = useRoute('setup', {});
  const tone = { ok: 'done', missing: 'warn', unknown: 'muted' };
  const word = { ok: 'Created', missing: 'Not created', unknown: 'Cannot check' };
  return (
    <Modal open onClose={onClose} title="Setup status" width={820} foot={<div className="toolbar"><span className="muted small">{isPreview() ? 'Preview: sample answers.' : 'Checked just now with your role. Steps: SETUP-CHECKLIST and RECORDS-SETUP in the hand-back.'}</span><span className="spacer" /><Button small onClick={onClose}>Close</Button></div>}>
      {error ? <ErrorBox error={error} /> : loading || !data ? <Skeleton rows={8} cols={3} /> : (
        <table className="dense setup-tbl"><thead><tr><th className="l">Area</th><th className="l">What</th><th className="l">Status</th><th className="l">Needed</th><th className="l">What it switches on</th></tr></thead>
          <tbody>{data.items.map((x) => <tr key={x.id}><td className="l">{x.area}</td><td className="l">{x.label}<div className="muted small"><code>{x.id}</code>{x.detail ? ` · ${x.detail}` : ''}</div></td><td className="l"><Pill tone={tone[x.status]}>{word[x.status]}</Pill></td><td className="l muted">{x.need}</td><td className="l muted small">{x.effect}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}
