/* 战斗引擎单元测试：node test/battle.test.js */
const B = require('../js/battle.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')');
}

// ---------- 面板数值 ----------
const pet = {
  id: 1,
  name: '布布种子',
  base_stats: { hp: 55, atk: 69, def: 65, sp_atk: 45, sp_def: 55, spd: 31, total: 320 },
  type: { id: 1 }
};

const s = B.computeStats(pet, { level: 100, iv: 31, ev: {} });
eq(s.hp, 251, 'HP 公式');
eq(s.atk, 174, '攻击公式');
eq(s.spd, 98, '速度公式');

const nature = { attributes: { atk: 10, sp_atk: -10, percent: true } };
const s2 = B.computeStats(pet, { level: 100, iv: 31, ev: {}, nature: nature });
eq(s2.atk, 191, '性格 +10% 攻击');
eq(s2.spAtk, 113, '性格 -10% 特攻');

// ---------- 属性克制 ----------
const chart = { 1: { 2: 2, 3: 0.5, 1: 0.5 }, 3: { 1: 2, 3: 0.5 } };
eq(B.effectiveness(chart, [1], [2]), 2, '草打水 ×2');
eq(B.effectiveness(chart, [1], [3]), 0.5, '草打火 ×0.5');
eq(B.effectiveness(chart, [1], [2, 3]), 1, '双属性倍率相乘');
eq(B.effectiveness(chart, [9], [2]), 1, '未知属性按 ×1');

// ---------- 属性组合解析 ----------
eq(B.comboElements({ primary: { id: 1 }, secondary: null }).length, 1, '单属性组合');
eq(B.comboElements({ primary: { id: 1 }, secondary: { id: 3 } })[1], 3, '双属性组合取第二属性');

// ---------- 技能描述解析 ----------
const eff = B.parseEffectInfo('技能使用成功时，100%改变自身防御等级+1');
eq(eff.length, 1, '解析出 1 条能力变化');
eq(eff[0].stat, 'def', '识别为防御');
eq(eff[0].stages, 1, '变化量 +1');
eq(eff[0].target, 'self', '目标为自身');
eq(eff[0].chance, 100, '概率 100%');

const eff2 = B.parseEffectInfo('使对手攻击等级-2');
eq(eff2[0].target, 'foe', '识别为对手');
eq(eff2[0].stages, -2, '变化量 -2');

// ---------- 伤害结算 ----------
function mkCombatant(base) {
  return {
    level: 100,
    stats: base,
    stages: { atk: 0, def: 0, spAtk: 0, spDef: 0, spd: 0, acc: 0, eva: 0 }
  };
}
const attacker = mkCombatant({ hp: 250, atk: 143, def: 143, spAtk: 143, spDef: 143, spd: 143 });
const defender = mkCombatant({ hp: 250, atk: 143, def: 143, spAtk: 143, spDef: 143, spd: 143 });

const skill = {
  id: 10001, name: '撞击', power: 35, max_pp: 35, accuracy: 95, crit_rate: 0,
  category: { id: 1 }, type: { id: 1 }, info: null
};

const dmg = B.calcDamage({
  actor: attacker, target: defender, skill: skill,
  skillCombo: { primary: { id: 1 }, secondary: null },
  actorCombo: { primary: { id: 1 }, secondary: null },
  targetCombo: { primary: { id: 2 }, secondary: null },
  chart: { 1: { 2: 2 } },
  level: 100,
  rng: function () { return 0.5; }
});
ok(dmg.damage > 60, '本系 + 克制后伤害明显提高：' + dmg.damage);
eq(dmg.effectiveness, 2, '伤害结算里的克制倍率');
ok(dmg.stab === true, '本系加成生效');
eq(dmg.crit, false, '暴击率 0 时不暴击');

// ---------- 整场对战冒烟测试 ----------
const combos = {
  1: { id: 1, name: '草', primary: { id: 1 }, secondary: null },
  3: { id: 3, name: '火', primary: { id: 3 }, secondary: null }
};
function makeTeam(comboId) {
  return [1, 2, 3].map(function (i) {
    return {
      pet: {
        id: i, name: '测试' + i,
        base_stats: { hp: 70 + i, atk: 80 + i, def: 70, sp_atk: 80, sp_def: 70, spd: 60 + i }
      },
      combo: combos[comboId],
      skills: [
        { id: 1, name: '撞击', power: 35, max_pp: 30, accuracy: 100, crit_rate: 6.25, category: { id: 1 }, type: { id: comboId }, info: null },
        { id: 2, name: '强化', power: 0, max_pp: 20, accuracy: 100, category: { id: 4 }, type: { id: comboId }, info: '100%改变自身攻击等级+1' }
      ]
    };
  });
}

let battle;
try {
  battle = new B.Battle({
    chart: { 1: { 3: 0.5 }, 3: { 1: 2 } },
    comboOf: function (id) { return combos[id]; },
    difficulty: 'normal',
    meTeam: makeTeam(1),
    foeTeam: makeTeam(3)
  });
  ok(true, '对战对象可以创建');
} catch (e) {
  ok(false, '创建对战失败：' + e.message);
}

if (battle) {
  let guard = 0;
  while (!battle.over && guard < 400) {
    guard++;
    if (battle.needPlayerSwitch) {
      const alive = battle.me.team.findIndex(function (c) { return c.hp > 0; });
      battle.playerSwitch(alive);
      continue;
    }
    const active = battle.activeOf('me');
    const idx = active.skills.findIndex(function (sl) { return sl.pp > 0; });
    battle.step({ type: 'skill', index: idx < 0 ? 0 : idx });
  }
  ok(battle.over, '对战能在有限回合内结束（用了 ' + guard + ' 次操作）');
  ok(battle.winner === 'me' || battle.winner === 'foe', '产生胜负结果：' + battle.winner);

  const snap = battle.snapshot();
  ok(snap.me.team.length === 3 && snap.foe.team.length === 3, '快照包含双方队伍');
  ok(snap.me.team.every(function (t) { return t.hp >= 0 && t.hp <= t.maxHp; }), 'HP 始终在合法区间');
  ok(battle.log.length > 5, '产生了战斗日志，共 ' + battle.log.length + ' 行');
}

// ---------- PP 消耗 ----------
const b2 = new B.Battle({
  chart: {},
  comboOf: function () { return combos[1]; },
  difficulty: 'easy',
  meTeam: makeTeam(1),
  foeTeam: makeTeam(3)
});
const before = b2.activeOf('me').skills[0].pp;
b2.step({ type: 'skill', index: 0 });
eq(b2.activeOf('me').skills[0].pp, before - 1, '使用技能消耗 1 点 PP');

console.log('');
if (fails) {
  console.log('✗ ' + fails + ' 项失败');
  process.exit(1);
} else {
  console.log('✓ 全部通过');
}
