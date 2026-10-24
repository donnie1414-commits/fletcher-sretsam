/** The only HTML the server emits: a ~2 KB shell plus the bootstrap JSON block. Everything else is JSON. */
import { routeBootstrap } from './routes/bootstrap.js';
export function renderShell(ctx) {
  const boot = routeBootstrap(ctx);
  const json = JSON.stringify(boot).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const js = assetUrl(ctx, 'custscript_al_client_js'), css = assetUrl(ctx, 'custscript_al_client_css');
  return `<!doctype html><html lang="en" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amicus Leasing</title>${css ? `<link rel="stylesheet" href="${css}">` : ''}<style>html,body{margin:0;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif}@media(prefers-color-scheme:dark){html,body{background:#121417;color:#e6e8eb}}#root{min-height:100vh}.al-boot{padding:24px;max-width:720px}</style></head><body><div id="root"><div class="al-boot" id="al-boot">Loading Amicus Leasing…</div></div><script type="application/json" id="al-bootstrap">${json}</script>${js ? `<script src="${js}" defer></script>` : `<script>document.getElementById('al-boot').textContent='Client bundle not configured: set the script parameters custscript_al_client_js / custscript_al_client_css to the File Cabinet ids of amicus_leasing_app.js / .css (see SETUP-CHECKLIST).';</script>`}</body></html>`;
}
function assetUrl(ctx, param) {
  try { const id = ctx.N.runtime.getCurrentScript().getParameter({ name: param }); if (!id) return null; const f = ctx.N.file.load({ id: Number(id) }); return f.url; } catch (e) { ctx.log.error({ title: 'shell asset', details: `${param}: ${e && e.message}` }); return null; }
}
