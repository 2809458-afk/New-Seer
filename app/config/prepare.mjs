import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
for (const script of ['gen-effect-kinds.mjs', 'build-asset-manifest.mjs', 'build-skill-effects.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../tools/' + script, import.meta.url))], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
