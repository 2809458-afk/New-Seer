global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
const chart = { 1: { 1: 1 } };
function pet(id, name) { return { id, name, base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } }; }
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 1 }, info: '', effects: [] }, over || {});
}
const SOUL1499 = '回合开始时转动命运之轮·恒，战斗阶段结束时转动命运之轮·界，随机获得其中1种命运之轮效果；|对手每次主动切换精灵则对手下一只精灵登场当回合命运之轮·恒和命运之轮·界的效果全部触发（boss无效）|命运之轮·恒：①令自身全属性+1且获得200点护盾和200点护罩（护盾和护罩不可叠加）、②令对手随机1个技能PP值归零且当回合无法通过自身技能恢复体力|命运之轮·界：①令对手全属性-1且下回合受到的固定伤害和百分比伤害提升30%、②恢复自身最大体力的1/3且自身下回合所有技能额外先制+1';
function battle(rngv, withBench) {
  const team = [{ pet: pet(4275, '命运之轮·莫伊莱'), combo, skills: [skill({ id: 3 }), skill({ id: 4 })], passives: B.parseSoulmark(SOUL1499) }];
  if (withBench) team.push({ pet: pet(9998, '替补'), combo, skills: [skill()] });
  return new B.Battle({ chart, comboOf: () => combo, rng: () => (rngv == null ? 0 : rngv), level: 100, meTeam: team,
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 }), skill({ id: 22 })] }] });
}
console.log('— 4275 命运之轮·莫伊莱：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1499);
  ok(sm.some(x => x.kind === 'fateWheel'), '回合开始/结束各转一次命运之轮');
  ok(sm.some(x => x.kind === 'fateOnSwitch'), '对手切换 → 下一只登场双轮齐触发');
  ok(sm.some(x => x.kind === 'fateHengDef' && x.shield === 200 && x.ward === 200), '恒：全属性+1 + 200 护盾护罩');
  ok(sm.some(x => x.kind === 'fateHengDef' && x.pp === 1), '恒：对手随机 1 技能 PP 归零 + 禁回血');
  ok(sm.some(x => x.kind === 'fateJieDef' && x.pct === 30), '界：对手全属性-1 + 固伤百分比受伤 +30%');
  ok(sm.some(x => x.kind === 'fateJieDef' && x.den === 3 && x.prio === 1), '界：回 1/3 血 + 下回合先制 +1');
}
console.log('— 4275 恒（回合开始） —');
{
  const b = battle(0);
  const me = b.me.team[0], foe = b.foe.team[0];
  b.startOfTurn();
  eq(me.stages.atk, 1, '恒：全属性 +1');
  eq(me.shield, 200, '恒：200 护盾');
  eq(me.ward, 200, '恒：200 护罩');
  eq(foe.skills.filter(x => x.pp === 0).length, 1, '恒：对手随机 1 技能 PP 归零');
  eq(foe.healBlock, 1, '恒：对手本回合无法回血');
}
{
  const b = battle(0.9);
  const me = b.me.team[0];
  b.startOfTurn();
  eq(me.stages.atk, 0, '未抽到恒：强化不变');
  eq(me.shield, 0, '未抽到恒：没有护盾');
}
console.log('— 4275 界（回合结束） —');
{
  const b = battle(0);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = me.maxHp - 900;
  const hp0 = me.hp;
  b.endOfTurn();
  eq(foe.stages.atk, -1, '界：对手全属性 -1');
  ok(foe.fixedPctTakenUp && foe.fixedPctTakenUp.pct === 30, '界：对手固伤/百分比受伤 +30%');
  ok(me.hp > hp0, '界：自身回 1/3 血');
  eq(me.pendingNextPrio, 1, '界：下回合先制 +1');
}
{
  const b = battle(0);
  const foe = b.foe.team[0];
  foe.fixedPctTakenUp = { turns: 1, pct: 30 };
  const d0 = b.directDamage(foe, 100, 'fixed');
  eq(d0, 130, '固伤受伤 +30% 生效');
}
console.log('— 4275 对手切换 → 双轮齐触发 —');
{
  const b = battle(0, true);
  const me = b.me.team[0];
  b.switchIn('foe', 0);
  ok(me.fateBothThisEntry === true, '对手切换 → 我方命运之轮标记双轮齐触发');
  b.startOfTurn();
  ok(me.stages.atk >= 1, '双轮：恒已触发（自身强化 +1）');
  ok(b.foe.team[0].stages.atk <= -1, '双轮：界已触发（对手全属性 -1）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
