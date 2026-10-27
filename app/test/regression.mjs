import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { oracleEsbuildPlugin, readEffectiveOracle } from '../config/oracle.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(app, '..');
const output = resolve(root, 'docs/maintenance');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'app-regression.json'), JSON.stringify({ pass: false, status: 'running' }));
mkdirSync(resolve(app, '.tmp'), { recursive: true });
await build({ entryPoints: [resolve(app, 'src/core/engine.ts')], bundle: true,
  platform: 'node', format: 'cjs', outfile: resolve(app, '.tmp/core.cjs'), plugins: [oracleEsbuildPlugin()] });
writeFileSync(resolve(app, '.tmp/oracle.cjs'), readEffectiveOracle());
// battle-trace.js 期待整个 CommonJS API。
writeFileSync(resolve(app, '.tmp/trace-core.cjs'), "module.exports = require('./core.cjs').default;\n");
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require="${resolve(app, 'test/register-core.cjs').replaceAll('\\', '/')}"` };
const suites = [];
let log = '';
for (const name of readdirSync(resolve(root, 'web/test')).filter((f) => f.endsWith('.test.js')).sort()) {
  const result = spawnSync(process.execPath, [resolve(root, 'web/test', name)], { cwd: resolve(root, 'web'), env, encoding: 'utf8', timeout: 60000 });
  const out = (result.stdout || '') + (result.stderr || '');
  const checks = (out.match(/^ {2}ok /gm) || []).length;
  const pass = result.status === 0 && !/FAIL/.test(out);
  suites.push({ name, pass, checks });
  log += `\n${name}\n${out}`;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} (${checks})`);
}
writeFileSync(resolve(output, 'app-regression.log'), log);
const baseline = JSON.parse(readFileSync(resolve(root, 'web/spec/regression-baseline.json'), 'utf8'));
assert(suites.length >= baseline.suites.count, 'suite count decreased');
assert(suites.reduce((n, s) => n + s.checks, 0) >= baseline.suites.checks, 'assertion count decreased');

const traces = [];
for (const [label, engine] of [['frozen', resolve(root, 'web/js/battle.js')], ['oracle', resolve(app, '.tmp/oracle.cjs')], ['core', resolve(app, '.tmp/trace-core.cjs')]]) {
  const out = resolve(app, '.tmp', `trace-${label}.json`);
  const result = spawnSync(process.execPath, [resolve(root, 'web/tools/battle-trace.js'),
    '--engine=' + engine, '--data=' + resolve(root, 'web/data'), '--seeds=8', '--turns=30', '--out=' + out],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  traces.push(JSON.parse(readFileSync(out, 'utf8')).battles);
}
assert.deepEqual(traces[2], traces[1], 'full event/state trace differs from expanded oracle');
assert.deepEqual(traces[1], traces[0], 'unrelated frozen event/state traces changed');
assert.equal(suites.filter((s) => !s.pass).length, 0, 'legacy suites failed; see app-regression.log');
const report = { date: new Date().toISOString(), suites, checks: suites.reduce((n, s) => n + s.checks, 0), traces: 8, frozenTraces: 8, pass: true };
writeFileSync(resolve(output, 'app-regression.json'), JSON.stringify(report, null, 2));
console.log(`${suites.length} suites / ${report.checks} checks / 8 full event-state traces PASS`);
