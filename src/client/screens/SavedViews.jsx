import { useState } from 'react';
import { useRoute } from '../hooks.js';
import { post, invalidate } from '../api.js';
import { Button, Select } from '../ui.jsx';
/** §4.2 — name and save a filter/sort/column set per workspace, set a default, share to a market team. */
export function SavedViews({ workspace, state, onApply }) {
  const { data } = useRoute('savedviews', { workspace });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const views = (data?.views || []).filter((v) => v.workspace === workspace);
  const save = async (isDefault) => {
    if (!name.trim()) return;
    const res = await post('savedviews', { changeId: `sv:${Date.now()}`, view: { workspace, name: name.trim(), state, isDefault, sharedMarkets: [] } });
    const r = (res.results || [])[0];
    if (res.degraded) { setMsg(`Not saved: ${res.degraded}. If you just created the record, use "Re-check now" in the banner or reload the page.`); return; }
    if (res.error) { setMsg(`Not saved: ${res.error}`); return; }
    if (r && !r.ok) { setMsg(`Not saved: ${r.code}: ${r.message}`); return; }
    setMsg(''); setNaming(false); setName(''); invalidate('savedviews'); setTick(tick + 1);
  };
  return (
    <span className="savedviews">
      <Select label="View" value="" onChange={(id) => { const v = views.find((x) => x.id === id); if (v) onApply(v.state); }} options={[{ value: '', label: views.length ? 'Saved views…' : 'No saved views' }, ...views.map((v) => ({ value: v.id, label: (v.isDefault ? '★ ' : '') + v.name + (v.mine ? '' : ' (shared)') }))]} />
      {msg && <span className="warn-text small">{msg}</span>}
      {naming ? <span className="inline-form"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" aria-label="View name" /><Button small onClick={() => save(false)}>Save</Button><Button small onClick={() => save(true)}>Save as default</Button><Button small onClick={() => setNaming(false)}>Cancel</Button></span> : <Button small onClick={() => setNaming(true)}>Save view</Button>}
    </span>
  );
}
