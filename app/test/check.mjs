import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readEffectiveOracle } from '../config/oracle.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const temp = resolve(app, '.tmp');
mkdirSync(temp, { recursive: true });
writeFileSync(resolve(temp, 'oracle.cjs'), readEffectiveOracle());
const env = { ...process.env, TEMP: temp, TMP: temp,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require="${resolve(app, 'test/register-oracle.cjs').replaceAll('\\', '/')}"` };
let failed = false, log = '';
for (const name of readdirSync(resolve(app, 'test')).filter((f) => /\.(check|compare)\.ts$/.test(f)).sort()) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(app, 'test', name)], { cwd: app, env, encoding: 'utf8', timeout: 60000 });
  const out = (result.stdout || '') + (result.stderr || '');
  log += `\n${name}\n${out}`;
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`);
  if (result.status !== 0) { failed = true; console.error(out); }
}
const output = resolve(app, '../docs/maintenance');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'app-checks.log'), log);
process.exitCode = failed ? 1 : 0;
