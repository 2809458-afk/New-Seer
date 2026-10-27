/* P1 校验：新 TS 计算层 vs 旧 web/js/battle.js 逐项比对
 * 运行：cd app && npx tsx test/formula.compare.ts
 */
import { createRequire } from 'node:module';
import {
  computeStats, buildChart, effectiveness, comboElements, calcDamage, stageMul
} from '../src/core/formula';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacy = require('../../web/js/battle.js');

let fails = 0;
function eq(name: string, a: unknown, b: unknown) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.error(`  FAIL ${name}\n    新: ${JSON.stringify(a)}\n    旧: ${JSON.stringify(b)}`); }
  else console.log(`  ok   ${name}`);
}

// ---- 面板计算 ----
const pets = [
  { base_stats: { hp: 80, atk: 90, def: 70, sp_atk: 80, sp_def: 70, spd: 60 } },
  { base_stats: { hp: 131, atk: 120, def: 100, sp_atk: 60, sp_def: 95, spd: 130 } },
  { base_stats: { hp: 45, atk: 40, def: 55, sp_atk: 60, sp_def: 65, spd: 50 } }
];
const optsList = [
  {},
  { level: 1 },
  { level: 50, iv: 0 },
  { level: 100, iv: 31, ev: { hp: 252, atk: 252, spd: 6 } },
  { level: 100, nature: { attributes: { atk: 10, sp_atk: -10 } } },
  { level: 100, nature: { attributes: { atk: 0.1, percent: true } } },
  { level: 100, bonus: { hp: 100, atk: 75 }, bonusPct: { spd: 10, hp: 10 } }
];
pets.forEach((p, i) => optsList.forEach((o, j) => {
  eq(`computeStats pet${i} opts${j}`, computeStats(p, o), legacy.computeStats(p, o));
}));

// ---- 属性表 / 克制 ----
const types = [
  { id: 1, relations: [{ target_type: { id: 1 }, multiple: 1 }, { target_type: { id: 3 }, multiple: 0.5 }, { target_type: { id: 5 }, multiple: 2 }] },
  { id: 3, relations: [{ target_type: { id: 1 }, multiple: 2 }, { target_type: { id: 3 }, multiple: 1 }] },
  { id: 5, relations: [{ target_type: { id: 1 }, multiple: 0.5 }, { target_type: { id: 5 }, multiple: 2 }] }
];
const chartNew = buildChart(types);
const chartOld = legacy.buildChart(types);
eq('buildChart', chartNew, chartOld);

const combos = [
  { primary: { id: 1 } },
  { primary: { id: 1 }, secondary: { id: 3 } },
  { primary: { id: 3 }, secondary: { id: 5 } }
];
combos.forEach((a, i) => combos.forEach((d, j) => {
  eq(`effectiveness ${i}->${j}`,
    effectiveness(chartNew, comboElements(a), comboElements(d)),
    legacy.effectiveness(chartOld, legacy.comboElements(a), legacy.comboElements(d)));
}));

// ---- 伤害公式 ----
const actor = {
  level: 100,
  stats: { hp: 400, atk: 300, def: 200, spAtk: 280, spDef: 210, spd: 260 },
  stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 },
  status: null
};
const target = {
  level: 100,
  stats: { hp: 420, atk: 280, def: 240, spAtk: 260, spDef: 230, spd: 240 },
  stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 },
  status: null
};
const skills = [
  { power: 150, category: { id: 1 }, crit_rate: 0 },
  { power: 90, category: { id: 2 }, crit_rate: 0 },
  { power: 0, category: { id: 4 }, crit_rate: 0 }
];
const rngs = [() => 0, () => 0.5, () => 0.99];
skills.forEach((sk, i) => rngs.forEach((r, j) => {
  const a = { ...actor, stats: { ...actor.stats }, stages: { ...actor.stages } };
  const t = { ...target, stats: { ...target.stats }, stages: { ...target.stages } };
  eq(`calcDamage skill${i} rng${j}`,
    calcDamage({
      actor: a, target: t, skill: sk,
      skillCombo: { primary: { id: 1 } }, actorCombo: { primary: { id: 1 } }, targetCombo: { primary: { id: 3 } },
      chart: chartNew, rng: r
    }),
    legacy.calcDamage({
      actor: { ...a }, target: { ...t }, skill: sk,
      skillCombo: { primary: { id: 1 } }, actorCombo: { primary: { id: 1 } }, targetCombo: { primary: { id: 3 } },
      chart: chartOld, rng: r
    }));
}));

// ---- 能力等级 ----
for (let s = -6; s <= 6; s++) eq(`stageMul ${s}`, stageMul(s), legacy.stageMul(s));

console.log(fails ? `\n✗ ${fails} 项不一致` : '\n✓ 全部一致');
process.exit(fails ? 1 : 0);
