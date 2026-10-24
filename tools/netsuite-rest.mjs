/**
 * Minimal SuiteTalk REST client (SuiteQL) with TBA (OAuth 1.0a, HMAC-SHA256). No dependencies.
 * Credentials come from the environment only:
 *   NS_ACCOUNT (e.g. 8229294), NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET
 * Read-only: this client only issues SuiteQL POSTs to /services/rest/query/v1/suiteql.
 */
import crypto from 'node:crypto';

export function hasCredentials(env = process.env) { return ['NS_ACCOUNT', 'NS_CONSUMER_KEY', 'NS_CONSUMER_SECRET', 'NS_TOKEN_ID', 'NS_TOKEN_SECRET'].every((k) => env[k]); }
function pct(s) { return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
export function oauthHeader({ method, url, env = process.env, nonce = crypto.randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000) }) {
  const u = new URL(url);
  const params = { oauth_consumer_key: env.NS_CONSUMER_KEY, oauth_token: env.NS_TOKEN_ID, oauth_signature_method: 'HMAC-SHA256', oauth_timestamp: String(ts), oauth_nonce: nonce, oauth_version: '1.0' };
  for (const [k, v] of u.searchParams) params[k] = v;
  const norm = Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join('&');
  const base = `${method.toUpperCase()}&${pct(`${u.origin}${u.pathname}`)}&${pct(norm)}`;
  const key = `${pct(env.NS_CONSUMER_SECRET)}&${pct(env.NS_TOKEN_SECRET)}`;
  const sig = crypto.createHmac('sha256', key).update(base).digest('base64');
  const realm = env.NS_ACCOUNT.toUpperCase().replace('-', '_');
  return `OAuth realm="${realm}", ` + Object.entries({ ...params, oauth_signature: sig }).filter(([k]) => k.startsWith('oauth_')).map(([k, v]) => `${k}="${pct(v)}"`).join(', ');
}
export async function suiteql(sql, { env = process.env, limit = 1000, offset = 0, fetchImpl = fetch } = {}) {
  const acct = env.NS_ACCOUNT.toLowerCase().replace('_', '-');
  const url = `https://${acct}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: oauthHeader({ method: 'POST', url, env }), 'Content-Type': 'application/json', Prefer: 'transient' }, body: JSON.stringify({ q: sql }) });
  if (!res.ok) throw new Error(`SuiteQL HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json(); // { items, hasMore, totalResults, offset, count }
}
/** Page past the 1,000-row cap. */
export async function suiteqlAll(sql, opts = {}) {
  const rows = []; let offset = 0;
  for (;;) { const page = await suiteql(sql, { ...opts, offset }); rows.push(...page.items.map(({ links, ...r }) => r)); if (!page.hasMore) break; offset += page.items.length; }
  return rows;
}
