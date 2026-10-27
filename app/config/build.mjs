import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const app = fileURLToPath(new URL('..', import.meta.url));
const temp = fileURLToPath(new URL('../.tmp', import.meta.url));
mkdirSync(temp, { recursive: true });
// 系统 Temp 中 esbuild 临时文件曾被拒绝删除；只调整本次构建进程。
process.env.TEMP = temp;
process.env.TMP = temp;
const tsc = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-b'], { cwd: app, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status || 1);
const { build } = await import('vite');
await build({ root: app });
