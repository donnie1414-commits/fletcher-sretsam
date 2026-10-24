import { useEffect, useRef, useState } from 'react';
import { useRoute } from '../../hooks.js';
import { post, invalidate, isPreview } from '../../api.js';
import { Drawer, Button, Skeleton, ErrorBox } from '../../ui.jsx';
import { fmtDate } from '../../format.js';
import { UAS_NOTE, UAS } from '../../../shared/constants.js';

/** Append-only, timestamped notes per pipeline row with @mentions from the leasing team (v2 notes overlay). */
export function NotesDrawer({ row, sel, today, onClose, onSaved }) {
  const { data, error, loading } = useRoute('notes', { row: row && row.rowId }, !!(row && row.rowId));
  const team = useRoute('team', {}, !!row);
  const [text, setText] = useState('');
  const [ac, setAc] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [local, setLocal] = useState([]);
  const ta = useRef(null);
  useEffect(() => { setLocal([]); setText(''); setMsg(null); }, [row && row.key]);
  if (!row) return null;
  const members = (team.data && team.data.team) || [];
  const notes = (data ? data.notes : []).concat(local);
  const showAc = () => {
    const el = ta.current; if (!el) return;
    const head = el.value.slice(0, el.selectionStart);
    const m = /@([A-Za-z.\-']*(?:\s[A-Za-z.\-']*)?)$/.exec(head);
    if (!m) { setAc([]); return; }
    const q = m[1].toLowerCase();
    setAc(members.filter((t) => !q || t.name.toLowerCase().includes(q)).sort((x, y) => (x.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (y.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) || x.name.localeCompare(y.name)).slice(0, 25));
  };
  const pick = (name) => { const el = ta.current; const c = el.selectionStart; const v = el.value.slice(0, c).replace(/@([A-Za-z.\-']*(?:\s[A-Za-z.\-']*)?)$/, `@${name} `) + el.value.slice(c); setText(v); setAc([]); setTimeout(() => el.focus(), 0); };
  const add = async () => {
    const t = text.trim(); if (!t) return;
    const tagged = members.filter((m) => t.includes('@' + m.name)).map((m) => m.id);
    setBusy(true); setMsg(null);
    const changes = [];
    let rowRef = row.rowId;
    if (!rowRef) { changes.push({ changeId: `uas:${row.key}:${Date.now()}`, recordType: UAS.TYPE, recordId: null, fields: { name: `${row.unit} — AY ${sel.ay}-${sel.ay + 1}`, [UAS.UNIT]: Number(row.unitId), [UAS.AY]: Number(row.ayId || 0) || undefined, [UAS.PROPERTY]: Number(row.propertyId), [UAS.STAGE_SOURCE]: 1 } }); }
    changes.push({ changeId: `note:${row.key}:${Date.now()}`, recordType: UAS_NOTE.TYPE, recordId: null, fields: { name: `${row.unit} — ${today}`.slice(0, 300), custrecord_ad_note_status: rowRef ? Number(rowRef) : '$prev', custrecord_ad_note_text: t.slice(0, 4000), custrecord_ad_note_date: today, custrecord_ad_note_mentions: tagged } });
    const res = await post('write', { changes });
    const last = (res.results || [])[changes.length - 1];
    setBusy(false);
    if (last && last.ok) { setLocal((l) => l.concat([{ id: last.recordId, date: today, author: 'You', text: t, mentions: tagged }])); setText(''); invalidate('notes'); invalidate('pipeline'); onSaved && onSaved(row, { date: today, author: 'You', text: t, mentions: tagged }); }
    else setMsg((last && last.message) || (res.results && res.results[0] && res.results[0].message) || 'The note could not be saved.');
  };
  return (
    <Drawer open onClose={onClose} title={row.unit === '(whole property)' ? row.property : row.unit} subtitle={`${row.property} · ${row.marketLabel || row.market} · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`} width={560}
      foot={<div className="composer">
        <div className="acwrap"><textarea ref={ta} rows={3} value={text} placeholder={members.length ? 'Add a note. Type @ to tag someone.' : 'Add a note.'} onChange={(e) => { setText(e.target.value); showAc(); }} onKeyUp={showAc} onBlur={() => setTimeout(() => setAc([]), 160)} />{ac.length > 0 && <div className="ac">{ac.map((t) => <button type="button" key={t.id} className="acitem" onMouseDown={(e) => { e.preventDefault(); pick(t.name); }}>{t.name}</button>)}</div>}</div>
        <div className="toolbar"><span className="muted small">Stamped with today’s date and your name{members.length ? ` · ${members.length} taggable` : team.data && !team.data.available ? ' · the employee list is not readable by this role, so @mentions are off' : ''}{isPreview() ? ' · preview: nothing is written' : ''}</span><span className="spacer" /><Button kind="primary" small disabled={busy || !text.trim()} onClick={add}>{busy ? 'Saving…' : 'Add note'}</Button></div>
        {msg && <div className="errorbox small">{msg}</div>}
      </div>}>
      {row.rowId && error ? <ErrorBox error={error} /> : row.rowId && (loading || !data) ? <Skeleton rows={3} cols={2} /> : (
        <div className="notes">
          {!row.rowId && <p className="muted small">This unit has no status record for this academic year yet; adding a note creates one.</p>}
          {data && data.legacy && <div className="note legacy"><div className="meta"><b>Legacy notes field</b></div><p>{data.legacy}</p></div>}
          {notes.length ? notes.slice().reverse().map((n, i) => <div key={n.id || i} className={`note ${i === 0 ? 'newest' : ''}`}><div className="meta"><b>{n.author || 'Unknown'}</b><span className="muted small">{fmtDate(n.date)}</span></div><p>{renderMentions(n.text, members)}</p></div>) : <p className="muted" style={{ textAlign: 'center', padding: '22px 0' }}>No notes on this unit yet.</p>}
        </div>
      )}
    </Drawer>
  );
}
function renderMentions(text, members) {
  if (!members.length) return text;
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const out = []; let last = 0, m;
  while ((m = re.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push(<span key={m.index} className="mention">@{m[1]}</span>); last = m.index + m[0].length; }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
