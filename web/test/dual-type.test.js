/* B10 / PORT_NOTES D008：双系克制（默认关闭，打开后与 godot pc_effectiveness 对齐） */
global.self = global;
const B = require('../js/battle.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}

// 1 克 2、2 克 3，二者都克 4；3 免疫 1；其余 1
const chart = {
  1: { 1: 1, 2: 2, 3: 1, 4: 2 },
  2: { 1: 1, 2: 1, 3: 2, 4: 2 },
  3: { 1: 0, 2: 1, 3: 1, 4: 1 },
  4: { 1: 1, 2: 1, 3: 1, 4: 1 }
};

// 单→单 / 单→双
ok(B.pcEffectiveness(chart, [1], [2]) === 2, '单→单取表值 2');
ok(B.pcEffectiveness(chart, [1], [2, 3]) === 1.5, '单→双：(2+1)/2 = 1.5');
ok(B.pcEffectiveness(chart, [3], [1, 2]) === 0.25, '单→双 含免疫：(0+1)/4 = 0.25');

// 双→单
ok(B.pcEffectiveness(chart, [1, 2], [4]) === 4, '双→单 两系均克制：规则显式取 4');
ok(B.pcEffectiveness(chart, [1, 2], [3]) === 1.5, '双→单 一克一常：(1+2)/2 = 1.5');
ok(B.pcEffectiveness(chart, [1, 2], [1]) === 1, '双→单 都普通：(1+1)/2 = 1');
ok(B.pcEffectiveness(chart, [1, 3], [1]) === 0.25, '双→单 含免疫：(1+0)/4 = 0.25');

// 双→双：先按双→单算每个防守属性，再平均
ok(B.pcEffectiveness(chart, [1, 2], [2, 3]) === 1.5, '双→双：( (2+1)/2 + (1+2)/2 ) / 2 = 1.5');
ok(B.pcEffectiveness(chart, [1, 2], [1, 3]) === 1.25, '双→双：( (1+1)/2 + (1+2)/2 ) / 2 = 1.25');
ok(B.pcEffectiveness(chart, [1, 2], [4, 4]) === 4, '双→双 两个防守属性都触发「双克双」时取 4');

// 旧口径仍是连乘（默认行为不变）
ok(B.effectiveness(chart, [1, 2], [2]) === 2, '旧口径连乘：(1→2)=2 × (2→2)=1 → 2');
ok(B.effectiveness(chart, [1, 2], [1, 3]) === 2, '旧口径连乘：1×1×1×2 = 2');
ok(B.effectiveness(chart, [3], [1]) === 0, '旧口径：免疫取 0');

// 开关
ok(B.getPcRules() === false, 'pcRules 默认关闭（旧 Web 金标准不变）');
ok(B.setPcRules(true) === true && B.getPcRules() === true, 'setPcRules(true) 生效');
B.setPcRules(false);

if (fails) { console.error('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
