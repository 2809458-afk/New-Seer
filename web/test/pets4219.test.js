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
const SOUL1438 = '自身能力提升状态被消除或吸取则100%令对手焚烬，未触发焚烬则自身下回合选择使用攻击技能时获得灼心之焰效果；|战斗阶段结束时，若对手处于烧伤状态则令对手全属性-1且下回合自身所有技能先制+1，若对手不处于烧伤状态则消除对手回合类效果，若对手不处于回合类效果或回合类效果无法被消除则恢复自身最大体力的1/3并造成等量百分比伤害（boss无效）|灼心之焰BUFF说明:先制+1、攻击必定打出致命一击、攻击命中且伤害结算后随机令自身2项能力值+1';
function battle(meSkills) {
  return new B.Battle({ chart, comboOf: () => combo, rng: () => 0, level: 100,
    meTeam: [{ pet: pet(4219, '红莲之誓·安卡'), combo, skills: meSkills, passives: B.parseSoulmark(SOUL1438) }],
    foeTeam: [{ pet: pet(2, '木桩'), combo, skills: [skill({ id: 21 })] }] });
}
console.log('— 4219 红莲之誓·安卡：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL1438);
  ok(sm.some(x => x.kind === 'fenjinOnClear'), '强化被消 → 对手焚烬');
  ok(sm.some(x => x.kind === 'pendingZhuoxin'), '未触发 → 下回合攻击获得灼心之焰');
  ok(sm.some(x => x.kind === 'burnEndBranch' && x.prio === 1 && x.den === 3), '回合末：烧伤分支 / 断回合回血分支');
  ok(sm.some(x => x.kind === 'zhuoxinBuff' && x.prio === 1 && x.ups === 2), '灼心之焰：先制+1、必暴、命中后随机 2 项+1');
}
console.log('— 4219 强化被消 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 2;
  me.prevPosStages = 2;
  me.stages.atk = 0;
  b.startOfTurn();
  ok(foe.status && foe.status.id === 'burn', '强化归零 → 对手焚烬（按烧伤实现）');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = 2;
  me.prevPosStages = 2;
  me.stages.atk = 0;
  foe.immuneStatus = 1;
  b.startOfTurn();
  ok(me.pendingZhuoxin === true, '焚烬未触发 → 下回合灼心之焰待触发');
}
console.log('— 4219 回合末分支 —');
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.status = { id: 'burn', turns: 9 };
  b.endOfTurn();
  ok(foe.stages.atk === -1, '对手烧伤 → 全属性 -1');
}
{
  const b = battle([skill()]);
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = me.maxHp - 800;
  const hp0 = me.hp;
  b.endOfTurn();
  ok(me.hp > hp0, '对手无烧伤且无回合效果 → 回 1/3 体力');
}
console.log('— 4219 灼心之焰 —');
{
  const b = battle([skill({ id: 41, power: 60, category: { id: 1 } })]);
  const me = b.me.team[0];
  me.pendingZhuoxin = true;
  b.useSkill('me', 0, { isFirst: true });
  ok(me.zhuoxinActive === false, '灼心之焰命中后消耗');
  ok(me.critBuffTurns >= 1, '灼心之焰：必暴');
  ok(me.priorityBuff && me.priorityBuff.value === 1, '灼心之焰：先制 +1');
  const ups = ['atk', 'def', 'spAtk', 'spDef', 'spd'].reduce((s, k) => s + Math.max(0, me.stages[k]), 0);
  ok(ups >= 2, '灼心之焰：命中后随机 2 项 +1（合计 ' + ups + '）');
}
if (fails) { console.error('FAILED ' + fails); process.exit(1); }
console.log('ALL PASS');
