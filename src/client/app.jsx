// Client entry (step 5 shell). The React application (DataGrid, screens) starts at step 6 once the
// engine tie-out is signed off (§10). This stub proves the File Cabinet <script src> path and the
// bootstrap handshake under NetSuite's CSP; it renders the scope and degradation state and nothing else.
import { STAGES, THEME, humanStages } from '../shared/constants.js';

function boot() {
  const el = document.getElementById('al-bootstrap');
  const root = document.getElementById('al-boot');
  if (!el || !root) return;
  let b; try { b = JSON.parse(el.textContent); } catch (e) { root.textContent = 'Bootstrap JSON unreadable: ' + e.message; return; }
  const lines = [
    `Signed in as ${b.session.name || b.session.userId}. Scope: ${b.scope.all ? 'all markets' : b.scope.marketIds.join(', ') || 'none'} (${b.scope.reason}).`,
    `Academic years: ${b.academicYears.map((a) => a.short).join(', ')}; current ${b.currentAy}.`,
    `Stages known to both sides: ${STAGES.length}; human-owned: ${humanStages().map((s) => s.label).join(' · ')}; live stage ids learned: ${Object.keys(b.ids.stage).length}.`,
    b.degraded.length ? `Degraded features (missing fields): ${b.degraded.map((d) => `${d.table}.${d.field}`).join(', ')}.` : 'Schema probe: every optional field present.',
    'Client bundle loaded from the File Cabinet under CSP: OK.',
  ];
  root.innerHTML = '';
  root.style.borderLeft = `3px solid ${THEME.accent}`;
  for (const t of lines) { const p = document.createElement('p'); p.textContent = t; root.appendChild(p); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
