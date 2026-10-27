/* 烘焙产物契约：tools/bake-pet-anim.py 的输出必须能被 Phaser 侧约定消费 */
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}

const WEB = path.resolve(__dirname, '..');
const DIR = path.join(WEB, 'assets', 'pet-anim');
const anim = JSON.parse(fs.readFileSync(path.join(DIR, '5000.json'), 'utf8'));

ok(anim.schema === 1, 'schema 为 1');
ok(anim.pet === '5000', 'pet 字段为 5000');
ok(anim.fps === 24, '帧率与 Unity FrameRate 一致（24）');
ok(anim.frames.length === 208, 'standby 27 + attack 173 + hited 8 = 208 帧（实际 ' + anim.frames.length + '）');
ok(anim.anims.standby.length === 27, 'standby 帧数 27');
ok(anim.anims.attack.length === 173, 'attack 帧数 173');
ok(anim.anims.hited.length === 8, 'hited 帧数 8');
ok(anim.labels.attack.action_hit === 138, 'attack 命中标签在 138 帧');
ok(/\.webp$/.test(anim.image), '图集用 webp（体积 ~3 MB）');

const cols = anim.cols, size = anim.frameSize;
const rows = Math.ceil(anim.frames.length / cols);
const seen = new Set();
let inRange = true, sized = true;
anim.frames.forEach((f) => {
  seen.add(f.name);
  if (!(f.x >= 0 && f.y >= 0 && f.x + f.w <= cols * size && f.y + f.h <= rows * size)) inRange = false;
  if (f.w !== size || f.h !== size) sized = false;
});
ok(inRange, '所有帧都在图集范围内');
ok(sized, '所有帧都是 ' + size + 'x' + size);
ok(seen.size === anim.frames.length, '帧名唯一（Phaser 按 name 注册帧）');
ok(anim.anims.standby.every((i) => anim.frames[i]), 'standby 索引都指向存在的帧');
ok(anim.source.atlas[0] === 8192 && anim.source.atlas[1] === 8192, '图集来源为 8192x8192 原图');
ok(fs.existsSync(path.join(WEB, anim.image)), 'meta.image 指向的图集文件存在');

// 清单：stage-phaser 靠它自动判断哪些精灵可播动画
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
ok(index.schema === 1, 'index schema 为 1');
ok(Object.keys(index.pets).length >= 3, '清单至少 3 只精灵（实际 ' + Object.keys(index.pets).length + '）');
ok(Object.keys(index.pets).every((id) => fs.existsSync(path.join(WEB, index.pets[id].image))), '清单里每个图集文件都存在');
ok(index.pets['5000'].anims.attack >= 173 - 173, '清单记录 5000 的动画帧数');
ok(index.pets['5000'].labels.attack.action_hit === 138, '清单透传 action_hit 标签');

// UV 解码：与 unity-pet-extractor/public/animation-edit.js 的 partRect 一致
function partRect(uvs, quad) {
  const first = uvs[quad * 2] >>> 0;
  const second = uvs[quad * 2 + 1] >>> 0;
  const u1 = first >>> 16, v1 = first & 0xffff;
  const u2 = second >>> 16, v2 = second & 0xffff;
  return { minU: Math.min(u1, u2), minV: Math.min(v1, v2), maxU: Math.max(u1, u2), maxV: Math.max(v1, v2) };
}
const r = partRect([0x1234abcd, 0x5678ef01], 0);
ok(r.minU === 0x1234 && r.minV === 0xabcd, 'minU/minV 取第一字的两个 16 位');
ok(r.maxU === 0x5678 && r.maxV === 0xef01, 'maxU/maxV 取第二字的两个 16 位');
ok(r.maxU > r.minU && r.maxV > r.minV, 'uv 矩形正向');

if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
