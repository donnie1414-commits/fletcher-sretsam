/**
 * The only HTML the server emits: a ~2 KB shell plus the bootstrap JSON block. Everything else is JSON.
 * The client bundle and stylesheet are served THROUGH the Suitelet (?route=asset) so they are same-origin:
 * a File Cabinet media URL can be refused by the page's Content-Security-Policy or answered with a login
 * redirect, and either leaves the page on "Loading…". The File Cabinet ids still come from the two parameters.
 */
import { routeBootstrap } from './routes/bootstrap.js';
export const ASSET_PARAMS = { js: 'custscript_al_client_js', css: 'custscript_al_client_css' };
export function renderShell(ctx) {
  const boot = routeBootstrap(ctx);
  const json = JSON.stringify(boot).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const js = assetUrl(ctx, 'js'), css = assetUrl(ctx, 'css');
  return `<!doctype html><html lang="en" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amicus Leasing</title>${css ? `<link rel="stylesheet" href="${css}">` : ''}<style>html,body{margin:0;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif}@media(prefers-color-scheme:dark){html,body{background:#121417;color:#e6e8eb}}#root{min-height:100vh}.al-boot{padding:24px;max-width:720px}</style></head><body><div id="root"><div class="al-boot" id="al-boot">Loading Amicus Leasing…</div></div><script type="application/json" id="al-bootstrap">${json}</script>${js ? `<script src="${js}" defer onerror="document.getElementById('al-boot').textContent='The client bundle could not be loaded from ${js.replace(/'/g, '')} — open the browser console (F12) for the reason.'"></script>` : `<script>document.getElementById('al-boot').textContent='Client bundle not configured: set the script parameters custscript_al_client_js / custscript_al_client_css to the File Cabinet ids of amicus_leasing_app.js / .css (see SETUP-CHECKLIST).';</script>`}<script>setTimeout(function(){var b=document.getElementById('al-boot');if(b&&b.textContent.indexOf('Loading')===0)b.textContent='The client bundle loaded but did not start. Open the browser console (F12) and send the first error line.';},8000);</script></body></html>`;
}
/** Same-origin URL for an asset: the Suitelet's own URL with route=asset. Falls back to the File Cabinet URL if the id is not set. */
function assetUrl(ctx, kind) {
  const id = fileId(ctx, kind);
  if (!id) return null;
  const p = ctx.params || {};
  const keep = ['script', 'deploy', 'compid', 'whence'].filter((k) => p[k] != null && p[k] !== '').map((k) => `${k}=${encodeURIComponent(p[k])}`);
  return `/app/site/hosting/scriptlet.nl?${keep.join('&')}&route=asset&kind=${kind}&v=${id}`;
}
export function fileId(ctx, kind) {
  try { const id = ctx.N.runtime.getCurrentScript().getParameter({ name: ASSET_PARAMS[kind] }); return id ? Number(id) : null; } catch (e) { return null; }
}
/** ?route=asset&kind=js|css → the File Cabinet file's contents with the right Content-Type. Cached by the browser for a day; `v` busts it. */
export function serveAsset(ctx, context) {
  const kind = String((ctx.params || {}).kind || '').toLowerCase();
  const id = fileId(ctx, kind);
  if (!ASSET_PARAMS[kind] || !id) { context.response.setHeader({ name: 'Content-Type', value: 'text/plain' }); context.response.write(`asset ${kind} is not configured`); return; }
  let f;
  try { f = ctx.N.file.load({ id }); } catch (e) { ctx.log.error({ title: 'asset load', details: `${ASSET_PARAMS[kind]}=${id}: ${e && e.message}` }); context.response.setHeader({ name: 'Content-Type', value: 'text/plain' }); context.response.write(`could not load file ${id}: ${e && e.message}`); return; }
  context.response.setHeader({ name: 'Content-Type', value: kind === 'css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' });
  context.response.setHeader({ name: 'Cache-Control', value: 'private, max-age=86400' });
  context.response.write(f.getContents());
}
