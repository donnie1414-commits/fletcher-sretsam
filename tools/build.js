#!/usr/bin/env node
/**
 * npm run build → bundle, test, enforce budgets, write dist/ (§9).
 *   --check-only   budgets + load check on an existing dist/
 *   --skip-tests   (CI runs tests separately)
 *
 * Server: src/server/suitelet.js → dist/amicus_leasing_sl.js  (one AMD module; N/* stay external)
 * Client: src/client/app.jsx    → dist/amicus_leasing_app.js  (one IIFE; React-API source over preact/compat)
 * Styles: src/styles/app.css     → dist/amicus_leasing_app.css
 * Then: load the server bundle in Node with a fake `define` and assert onRequest is a function (§8.7).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const BUDGET = { clientMinifiedBytes: 250 * 1024, initialGzipBytes: 150 * 1024, shellBytes: 4 * 1024 };
const N_MODULES = ['N/query', 'N/record', 'N/runtime', 'N/log', 'N/file', 'N/cache', 'N/url', 'N/search', 'N/crypto', 'N/encode', 'N/https', 'N/redirect'];
const args = new Set(process.argv.slice(2));
fs.mkdirSync('dist', { recursive: true });

async function buildServer() {
  const r = await esbuild.build({
    entryPoints: ['src/server/suitelet.js'], bundle: true, write: false, format: 'cjs', platform: 'neutral', target: ['es2020'],
    external: N_MODULES, legalComments: 'none', minify: false, treeShaking: true, charset: 'utf8', logLevel: 'silent',
  });
  const code = r.outputFiles[0].text;
  const used = N_MODULES.filter((m) => code.includes(`require("${m}")`));
  const header = fs.readFileSync('src/server/suitelet.js', 'utf8').match(/\/\*\*[\s\S]*?\*\//)[0];
  const wrapped = `${header}\ndefine(${JSON.stringify(used)}, function (${used.map((m, i) => `__n${i}`).join(', ')}) {\n  'use strict';\n  var __N = {${used.map((m, i) => `${JSON.stringify(m)}: __n${i}`).join(', ')}};\n  var require = function (id) { if (Object.prototype.hasOwnProperty.call(__N, id)) return __N[id]; throw new Error('module not available in the server bundle: ' + id); };\n  var module = { exports: {} }; var exports = module.exports;\n${code}\n  if (typeof module.exports.onRequest !== 'function') throw new Error('bundle does not export onRequest');\n  return module.exports;\n});\n`;
  fs.writeFileSync('dist/amicus_leasing_sl.js', wrapped.replace(/\r\n/g, '\n'));
  return wrapped.length;
}
async function buildClient() {
  // The source is written against the React API; the bundle ships preact/compat under it (same API, ~120 KB smaller),
  // which is what keeps the client inside the 250 KB budget with every v2 screen in it. Flip REACT_RUNTIME=react to bundle React itself.
  const alias = process.env.REACT_RUNTIME === 'react' ? {} : { react: 'preact/compat', 'react-dom/client': 'preact/compat/client', 'react-dom': 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' };
  const r = await esbuild.build({ entryPoints: ['src/client/app.jsx'], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2018'], minify: true, sourcemap: false, jsx: 'automatic', jsxImportSource: process.env.REACT_RUNTIME === 'react' ? 'react' : 'preact', alias, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const code = r.outputFiles[0].text.replace(/\r\n/g, '\n');
  fs.writeFileSync('dist/amicus_leasing_app.js', code);
  const css = await esbuild.build({ entryPoints: ['src/styles/app.css'], bundle: true, write: false, minify: true, logLevel: 'silent' });
  fs.writeFileSync('dist/amicus_leasing_app.css', css.outputFiles[0].text);
  return { js: Buffer.byteLength(code), css: Buffer.byteLength(css.outputFiles[0].text), gz: zlib.gzipSync(code).length + zlib.gzipSync(css.outputFiles[0].text).length };
}
function loadCheck() {
  // §8.7 — node --check is not evidence a module loads. Execute the AMD wrapper with fake N modules.
  const src = fs.readFileSync('dist/amicus_leasing_sl.js', 'utf8');
  let exported = null;
  const define = (deps, factory) => { exported = factory(...deps.map((d) => ({ __fake: d }))); };
  new Function('define', src)(define);
  if (!exported || typeof exported.onRequest !== 'function') throw new Error('load check failed: onRequest is not a function');
  return Object.keys(exported);
}
async function engineLoadCheck() {
  const eng = await import(path.resolve('src/shared/rules/index.js'));
  for (const fn of ['runEngine', 'prepare', 'buildInventory', 'normalizeLease', 'placeLeases', 'rollup', 'weeklyReport', 'lookupsFromLists']) if (typeof eng[fn] !== 'function') throw new Error(`engine does not export ${fn}`);
}
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function lineEndings(p) { const s = fs.readFileSync(p, 'utf8'); return s.includes('\r\n') ? 'CRLF' : 'LF'; }

(async () => {
  if (!args.has('--check-only')) {
    if (!args.has('--skip-tests')) { execSync('node --test "test/**/*.test.js"', { stdio: 'inherit' }); }
    const serverBytes = await buildServer();
    const c = await buildClient();
    console.log(`server bundle ${serverBytes} B · client ${c.js} B min (${(c.js / 1024).toFixed(0)} KB) · css ${c.css} B · initial gzip ${c.gz} B`);
  }
  const exportsSeen = loadCheck();
  await engineLoadCheck();
  const clientBytes = fs.statSync('dist/amicus_leasing_app.js').size;
  const gz = zlib.gzipSync(fs.readFileSync('dist/amicus_leasing_app.js')).length + zlib.gzipSync(fs.readFileSync('dist/amicus_leasing_app.css')).length;
  const failures = [];
  if (clientBytes > BUDGET.clientMinifiedBytes) failures.push(`client bundle ${clientBytes} B exceeds ${BUDGET.clientMinifiedBytes} B`);
  if (gz > BUDGET.initialGzipBytes) failures.push(`initial payload ${gz} B gzipped exceeds ${BUDGET.initialGzipBytes} B`);
  const manifest = {
    builtAt: new Date().toISOString(), budgets: BUDGET, files: {},
    roles: { 'dist/amicus_leasing_sl.js': 'suitelet-entry', 'dist/amicus_leasing_app.js': 'client-bundle', 'dist/amicus_leasing_app.css': 'client-styles' },
  };
  for (const f of Object.keys(manifest.roles)) manifest.files[f] = { bytes: fs.statSync(f).size, sha256: sha256(f), lineEndings: lineEndings(f) };
  fs.writeFileSync('dist/MANIFEST.json', JSON.stringify(manifest, null, 2));
  console.log(`load check: server exports [${exportsSeen.join(', ')}]; engine exports OK; manifest written`);
  if (failures.length) { console.error('BUDGET FAILURE:\n  ' + failures.join('\n  ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
