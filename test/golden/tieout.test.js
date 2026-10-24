/** Golden tie-out (§8.3): totals at every level for 3 AYs × 2 bases must match the committed golden file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFixture } from '../../src/shared/rules/fixture-io.js';
import { computeGolden, diffGolden } from '../../tools/golden.mjs';

const root = path.resolve('test/fixtures');
const snaps = fs.readdirSync(root).filter((d) => d.startsWith('snapshot-')).sort();
for (const snap of snaps) {
  const goldenPath = path.join('test/golden', `${snap}.json`);
  test(`golden tie-out: ${snap}`, { skip: fs.existsSync(goldenPath) ? false : `no golden file ${goldenPath}` }, () => {
    const fixture = loadFixture(path.join(root, snap));
    const { history, fixture: _f, ...expected } = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const diffs = diffGolden(expected, computeGolden(fixture));
    assert.deepEqual(diffs, [], `numbers moved — if intended, run: node tools/golden.mjs --write "reason"\n` + diffs.slice(0, 25).join('\n'));
  });
  test(`acceptance shape: ${snap}`, () => {
    const g = computeGolden(loadFixture(path.join(root, snap)));
    for (const [k, run] of Object.entries(g.runs)) {
      assert.equal(run.pipeline.bedsStudent, run.student.beds, `${k}: pipeline total beds must equal Summary total beds`);
      assert.equal(run.pipeline.bedsStr, run.str.beds, `${k}: STR pipeline beds equal STR summary beds`);
      assert.equal(run.pipeline.rows, g.inventory.pipelineRows, `${k}: pipeline row count equals the inventory unit-level leaf count`);
    }
    assert.ok(g.inventory.pipelineRows >= g.inventory.units);
  });
}
if (!snaps.length) test('golden tie-out', { skip: 'no snapshot fixture present' }, () => {});
