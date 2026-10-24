#!/usr/bin/env node
/**
 * npm run deploy — File Cabinet upload with SHA-256 verification and role/slot guards (§3.3, §9).
 *
 * NOTHING deploys without --yes. Default is a dry run that prints the plan and the per-click checklist.
 *
 * Mapping file: deploy.map.json  { "dist/amicus_leasing_sl.js": { "fileId": 225835, "role": "suitelet-entry" }, … }
 * Guards:
 *   - a file whose content declares @NScriptType Suitelet may only go to a slot whose role is "suitelet-entry"
 *   - the client bundle / css may never go to the suitelet-entry slot
 *   - the local file's role (dist/MANIFEST.json) must equal the slot's role
 * Transport: --transport restlet  POSTs {fileId, name, contentBase64, sha256} to a companion RESTlet URL
 *   (tools/csp-probe/al_deploy_rl.js, uploaded once by hand) which saves the file with N/file and returns the
 *   SHA-256 of what NetSuite stored. Verification = that hash equals ours. Baseline is written to deploy.baseline.json.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const mapPath = (args.find((a) => a.startsWith('--map=')) || '--map=deploy.map.json').slice(6);
const manifest = JSON.parse(fs.readFileSync('dist/MANIFEST.json', 'utf8'));
const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : null;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const declaresSuitelet = (p) => /@NScriptType\s+Suitelet/.test(fs.readFileSync(p, 'utf8').slice(0, 2000));

if (!map) { console.log(`No ${mapPath}. Create it from this template and fill the File Cabinet ids:\n` + JSON.stringify(Object.fromEntries(Object.entries(manifest.roles).map(([f, role]) => [f, { fileId: null, role }])), null, 2)); process.exit(2); }
const plan = [];
for (const [file, slot] of Object.entries(map)) {
  const role = manifest.roles[file];
  const problems = [];
  if (!role) problems.push('file is not in dist/MANIFEST.json');
  if (slot.role !== role) problems.push(`slot role "${slot.role}" ≠ file role "${role}"`);
  if (declaresSuitelet(file) && slot.role !== 'suitelet-entry') problems.push('entry module targeted at a non-entry slot');
  if (!declaresSuitelet(file) && slot.role === 'suitelet-entry') problems.push('REFUSING: non-entry module targeted at the Suitelet slot (this is the §3.3 failure)');
  if (!slot.fileId) problems.push('no fileId');
  plan.push({ file, fileId: slot.fileId, role, sha256: sha(file), lineEndings: manifest.files[file]?.lineEndings, problems });
}
for (const p of plan) console.log(`${p.problems.length ? '✗' : '✓'} ${p.file} → File Cabinet id ${p.fileId} (${p.role}) sha256 ${p.sha256.slice(0, 12)}… ${p.lineEndings}${p.problems.length ? '\n    ' + p.problems.join('\n    ') : ''}`);
if (plan.some((p) => p.problems.length)) { console.error('plan has problems; nothing uploaded'); process.exit(1); }
if (!yes) { console.log('\nDry run. Re-run with --yes --transport restlet to upload, or upload by hand following docs/SETUP-CHECKLIST.md and then run with --verify to compare hashes.'); process.exit(0); }
const transport = (args.find((a) => a.startsWith('--transport=')) || '--transport=restlet').slice(12);
if (transport !== 'restlet') { console.error('only the restlet transport is implemented'); process.exit(2); }
const url = process.env.AL_DEPLOY_RESTLET_URL; if (!url) { console.error('AL_DEPLOY_RESTLET_URL is not set'); process.exit(2); }
const { oauthHeader } = await import('./netsuite-rest.mjs');
const baseline = { deployedAt: new Date().toISOString(), files: {} };
for (const p of plan) {
  const body = JSON.stringify({ fileId: p.fileId, contentBase64: fs.readFileSync(p.file).toString('base64'), sha256: p.sha256 });
  const res = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader({ method: 'POST', url }), 'Content-Type': 'application/json' }, body });
  const out = await res.json();
  if (!res.ok || out.sha256 !== p.sha256) { console.error(`✗ ${p.file}: NetSuite stored sha256 ${out.sha256} ≠ ${p.sha256}`); process.exit(1); }
  baseline.files[p.file] = { fileId: p.fileId, sha256: p.sha256, lineEndings: p.lineEndings, role: p.role };
  console.log(`✓ uploaded + verified ${p.file}`);
}
fs.writeFileSync('deploy.baseline.json', JSON.stringify(baseline, null, 2));
