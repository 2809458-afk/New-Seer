/* spec/battle-golden.json 对拍：旧 Web 记录的 20 个用例（6 能力值 + 14 伤害）必须在新引擎上复现 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}

const WEB = path.resolve(__dirname, '..');
const r = spawnSync(process.execPath, [path.join(WEB, 'tools', 'golden.js')], { cwd: WEB, encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
const line = out.split('\n').find((l) => l.indexOf('对拍') >= 0) || '';
const pass = /全部通过/.test(out);
ok(pass, 'battle-golden 全部用例通过（' + line.trim() + '）');
if (!pass) {
  out.split('\n').filter((l) => l.indexOf('期望') >= 0).slice(0, 6).forEach((l) => console.error('  ' + l.trim()));
}

if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
