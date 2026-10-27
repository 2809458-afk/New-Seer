global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 11, name: '战斗', primary: { id: 11 }, secondary: { id: 30 } };
const chart = { 11: { 11: 1 } };
const SOUL = '自身于战斗阶段内受到致死伤害且死亡时，若自身的等级为100级，则附加等同于自身当回合所受技能伤害的真实伤害，然后若对手的体力为0则自身主动恢复1点体力|自身使用技能之后，每回合结束后恢复自身最大体力的1/3（boss有效）|（标注部分boss有效，其余无效）';
const pet = (id, name) => ({ id, name, base_stats: { hp: 2000, atk: 150, def: 130, sp_atk: 150, sp_def: 130, spd: 140 } });
const sk = (over) => Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0, priority: 0, must_hit: true, category: { id: 4 }, type: { id: 11 }, info: '', effects: [] }, over || {});
const ATK = sk({ id: 900, name: '普通攻击', power: 60, category: { id: 1 } });
const S = {
  reverse: sk({ id: 23285, name: '逆转机甲', effects: [{ id: 544, args: [], info: '解除自身的烧伤、冻伤、中毒状态' }, { id: 3, args: [], info: '解除自身的能力下降状态' }, { id: 43, args: [1], info: '恢复自身最大体力的1/1' }, { id: 58, args: [2], info: '下2回合自身攻击技能必定打出致命一击' }, { id: 481, args: [1, 2], info: '下1回合自身攻击先制+2' }] }),
  fist: sk({ id: 15967, name: '圣战之拳', power: 130, category: { id: 1 }, effects: [{ id: 402, args: [100], info: '后出手时，额外附加100点固定伤害' }] }),
  rush: sk({ id: 19366, name: '狂绝冲撞', power: 85, priority: 3, category: { id: 1 }, effects: [{ id: 859, args: [3], info: '吸收对手能力提升，吸收成功减少对手1/3最大体力' }, { id: 776, args: [2], info: '下2回合自身造成的攻击伤害翻倍' }] }),
  awe: sk({ id: 24780, name: '霸威冠宇', effects: [{ id: 585, args: [1, 1, 1, 1, 1, 1], info: '全属性+1' }, { id: 806, args: [3, 1], info: '3回合内若对手使用攻击技能则使用后令自身全属性+1' }, { id: 191, args: [5], info: '5回合内免疫并反弹所有受到的异常状态' }] }),
  fist2: sk({ id: 19368, name: '天威凛怒拳', power: 150, category: { id: 1 }, effects: [{ id: 826, args: [1], info: '当回合击败对手则下回合开始后随机附加1种异常状态' }, { id: 456, args: [300], info: '若对手体力不足300则直接秒杀' }] }),
  final: sk({ id: 19369, name: '破釜沉舟战', power: 160, category: { id: 1 }, effects: [{ id: 901, args: [2, 0, 0, 0, 2, 0], info: '消除对手回合类效果，消除成功则攻击+2，速度+2' }, { id: 422, args: [40], info: '附加所造成伤害值40%的固定伤害' }] }),
  star: sk({ id: 15969, name: '碎星机动拳', power: 150, category: { id: 1 }, effects: [{ id: 459, args: [40], info: '附加对手防御值40%的百分比伤害' }] }),
  laser: sk({ id: 15966, name: '激光连射', power: 30, category: { id: 2 }, effects: [{ id: 31, args: [3, 5], info: '1回合做3~5次攻击' }] }),
  aura: sk({ id: 24779, name: '圣甲气魄', effects: [{ id: 60, args: [4, 150], info: '4回合内每回合都能附加150点固定伤害' }, { id: 478, args: [2], info: '2回合内令对手使用的属性技能无效' }, { id: 894, args: [200], info: '吸取对手200点体力，体力低于对手时吸取效果翻倍' }] }),
  breakArmy: sk({ id: 19367, name: '破阵猛攻', power: 140, category: { id: 2 }, effects: [{ id: 521, args: [], info: '反转自身能力下降状态' }] }),
  armor: sk({ id: 23287, name: '英勇圣甲', effects: [{ id: 408, args: [3, 120], info: '3回合内每回合所受的伤害减少120' }, { id: 48, args: [5], info: '5回合内免疫所有受到的异常状态' }] }),
};
const ALL = [S.reverse, S.fist, S.rush, S.awe, S.fist2, S.final, S.star, S.laser, S.aura, S.breakArmy, S.armor, ATK];
function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(3056, '圣甲·盖亚'), combo, skills: opts.skills || ALL, passives: B.parseSoulmark(SOUL) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [ATK, sk({ id: 21, name: '撞击2', power: 60, category: { id: 1 } }), sk({ id: 30, name: '威慑', effects: [{ id: 15, args: [100], info: '命中后100%令对方害怕' }] })] }];
  return new B.Battle({ chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: opts.level == null ? 100 : opts.level, meTeam, foeTeam });
}
const idx = (id) => ALL.findIndex(s => s.id === id);
const logHas = (b, s) => (b.log || []).some(x => String(x).indexOf(s) >= 0);

console.log('— 魂印：回合结束回 1/3 / 满级致死真伤 —');
{
  const sm = B.parseSoulmark(SOUL);
  ok(sm.some(x => x.kind === 'endHeal' && x.den === 3), '回合结束恢复 1/3');
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  me.hp = 1000;
  b.endOfTurn();
  ok(me.hp > 1000, '回合结束回血');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  b2.applyDamage('me', 500, { attack: true });
  me2.hp = 0;
  b2.checkFaints();
  eq(foe2.hp, foe2.maxHp - 500, '阵亡时按本回合所受技能伤害追加真实伤害');
  const b3 = battle({ rng: () => 0.99 });
  const me3 = b3.me.team[0], foe3 = b3.foe.team[0];
  b3.applyDamage('me', 500, { attack: true });
  foe3.hp = 300;
  me3.hp = 0;
  b3.checkFaints();
  eq(me3.hp, 1, '对手体力归零则自身恢复 1 点体力');
}

console.log('— 23285 逆转机甲：解异常 / 解弱 / 回满 / 先制 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  me.status = { id: 'burn', turns: 3 };
  me.stages.atk = -2; me.hp = 100;
  b.useSkill('me', idx(23285), { isFirst: true });
  eq(me.status, null, '解除烧伤');
  eq(me.stages.atk, 0, '解除能力下降');
  eq(me.hp, me.maxHp, '恢复全部体力');
  eq(me.critBuffTurns, 2, '2 回合必暴');
  eq(me.priorityBuff && me.priorityBuff.turns, 2, '下 1 回合先制 +2');
}

console.log('— 15967 圣战之拳：后出手附加 100 固伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  b.useSkill('me', idx(15967), { isFirst: false });
  ok(logHas(b, '附加 100 点固定伤害'), '后出手附加 100 固伤');
  const b2 = battle({ rng: () => 0.99 });
  const foe2 = b2.foe.team[0];
  foe2.hp = 99999; foe2.maxHp = 99999;
  b2.useSkill('me', idx(15967), { isFirst: true });
  ok(!logHas(b2, '附加 100 点固定伤害'), '先出手不附加');
}

console.log('— 19366 狂绝冲撞：吸收强化 / 削 1/3 体力 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.maxHp = 9000; foe.hp = 9000;
  foe.stages.atk = 2; foe.stages.def = 1;
  b.useSkill('me', idx(19366), { isFirst: true });
  eq(foe.stages.atk, 0, '对手攻击提升被吸收');
  eq(me.stages.atk, 2, '自身获得相同强化');
  ok(logHas(b, '减少其 1/3 最大体力（3000）'), '吸取成功削 1/3 最大体力');
  ok(me.damageBuff && me.damageBuff.mul === 2, '下 2 回合伤害 ×2');
}

console.log('— 24780 霸威冠宇：全属性 / 受攻击再强化 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', idx(24780), { isFirst: true });
  eq(me.stages.atk, 1, '全属性 +1');
  eq(me.reflectStatus, 5, '5 回合免疫反弹异常');
  eq(me.jaStatOnHit && me.jaStatOnHit.turns, 3, '3 回合受攻击强化');
  b.useSkill('foe', 0, { isFirst: true });
  eq(me.stages.atk, 2, '对手攻击后自身全属性 +1');
  b.useSkill('foe', 2, { isFirst: true });
  ok(!me.status, '自身免疫异常状态');
  ok(foe.status && foe.status.id === 'fear', '异常状态反弹给对手');
  ok(logHas(b, '反弹给了'), '日志显示反弹');
}

console.log('— 19368 天威凛怒拳：秒杀 / 下回合异常 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  foe.hp = 250; foe.maxHp = 9000;
  b.useSkill('me', idx(19368), { isFirst: true });
  eq(foe.hp, 0, '体力不足 300 直接秒杀');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.jaNextStatus = true;
  b2.startOfTurn();
  ok(foe2.status, '下回合开始随机附加异常状态');
}

console.log('— 19369 破釜沉舟战：断回合强化 / 40% 固伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  foe.guards.push({ turns: 2, mul: 0.5, scope: 'all' });
  b.useSkill('me', idx(19369), { isFirst: true });
  eq(foe.guards.length, 0, '消除对手回合类效果');
  eq(me.stages.atk, 2, '消除成功攻击 +2');
  eq(me.stages.spd, 2, '消除成功速度 +2');
  ok(logHas(b, '40%') || logHas(b, '追加'), '附加所造成伤害 40% 的固伤');
}

console.log('— 15969 / 15966 / 24779 / 19367 / 23287 —');
{
  const b = battle({ rng: () => 0 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  b.useSkill('me', idx(15969), { isFirst: true });
  ok(logHas(b, '防御') || logHas(b, '百分比'), '碎星机动拳附加防御 40% 百分比伤害');
  b.useSkill('me', idx(15966), { isFirst: true });
  ok(b.lastHits >= 3 && b.lastHits <= 5, '激光连射 3~5 段');
  me.hp = 100; foe.hp = 9000;
  b.useSkill('me', idx(24779), { isFirst: true });
  ok(foe.dot && foe.dot.value === 150, '圣甲气魄：4 回合每回合 150 固伤');
  eq(foe.skillBlock, 2, '2 回合属性技能无效');
  ok(logHas(b, '吸取 400 点体力') || me.hp > 100, '体力低于对手吸取翻倍');
  me.stages.atk = -2;
  b.useSkill('me', idx(19367), { isFirst: true });
  eq(me.stages.atk, 2, '反转自身能力下降');
  b.useSkill('me', idx(23287), { isFirst: true });
  ok(me.guardFlat && me.guardFlat.value === 120, '3 回合减伤 120');
  eq(me.immuneStatus, 5, '5 回合免疫异常');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); } else { console.log('ALL PASS'); }
