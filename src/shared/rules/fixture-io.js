/** Load a fixture directory (plain .json or .json.gz) into the engine's input shape. Node only. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TABLES = ['properties', 'units', 'leases', 'targets', 'academic_years', 'stage_rows', 'stage_notes', 'stage_log', 'customers', 'subsidiaries', 'lists'];
export function loadFixture(dir) {
  const out = {};
  for (const t of TABLES) {
    const gz = path.join(dir, `${t}.json.gz`), js = path.join(dir, `${t}.json`);
    if (fs.existsSync(gz)) out[t] = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
    else if (fs.existsSync(js)) out[t] = JSON.parse(fs.readFileSync(js, 'utf8'));
    else out[t] = t === 'lists' ? null : [];
  }
  const m = path.join(dir, 'manifest.json');
  out.manifest = fs.existsSync(m) ? JSON.parse(fs.readFileSync(m, 'utf8')) : null;
  return out;
}
export function defaultFixtureDir() {
  const root = path.resolve('test/fixtures');
  if (process.env.AMICUS_FIXTURE) return process.env.AMICUS_FIXTURE;
  if (fs.existsSync(path.join(root, 'live', 'leases.json'))) return path.join(root, 'live');
  const snaps = fs.readdirSync(root).filter((d) => d.startsWith('snapshot-')).sort();
  return snaps.length ? path.join(root, snaps[snaps.length - 1]) : null;
}
