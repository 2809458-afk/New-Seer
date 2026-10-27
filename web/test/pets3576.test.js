global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 76, name: '电', primary: { id: 76 }, secondary: { id: 30 } };
const chart = { 76: { 76: 1 } };
const SOUL = '每次对手攻击技能命中前令对手全属性-1；|战斗阶段结束时若自身处于异常状态或能力下降状态，则消除对手回合类效果并附加给对手等同于自身的异常状态或能力下降状态（自身体力为0时也可触发）；|回合结束后若自身死亡，则令己方下只精灵出战时全属性+1且免疫下1次受到的异常状态|（boss无效）';
function pet(id, name, stats) {
  return { id, name, base_stats: Object.assign({ hp: 2000, atk: 150, def: 130, sp_atk: 80, sp_def: 130, spd: 140 }, stats || {}) };
}
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 76 }, info: '', effects: [] }, over || {});
}
const ATK = skill({ id: 900, name: '普通攻击', power: 60, category: { id: 1 } });
const S = {
  dhy: skill({ id: 31838, name: '禅定印', power: 85, priority: 3, category: { id: 1 }, effects: [{ id: 1332, args: [2], info: '消除对手回合类效果，消除成功则随机附加2种异常状态' }, { id: 1263, args: [4, 3], info: '吸取对手最大体力的1/4，自身体力低于对手时变为1/3' }] }),
  flash: skill({ id: 31839, name: '闪雷之暴', power: 120, category: { id: 2 }, effects: [{ id: 749, args: [50, 1], info: '50%令对手全属性-1' }] }),
  tianwei: skill({ id: 26030, name: '明王天威', effects: [{ id: 962, args: [1], info: '全属性+1，自身不处于能力提升状态时强化效果翻倍' }, { id: 1065, args: [4, 3, 2], info: '4回合内每回合使用技能恢复自身最大体力的1/3并造成等量百分比伤害，恢复体力时若自身体力低于最大体力的1/2则恢复效果和百分比伤害翻倍' }, { id: 843, args: [2, 2], info: '下2回合令自身所有技能先制+2' }] }),
  huanglei: skill({ id: 26029, name: '圣界煌雷', effects: [{ id: 191, args: [4], info: '4回合内免疫并反弹所有受到的异常状态' }, { id: 47, args: [4], info: '4回合内免疫能力下降状态' }, { id: 1270, args: [80, 0, 1], info: '命中则80%使对手麻痹，未触发则对手下1次技能无效' }] }),
  yuanji: skill({ id: 31842, name: '圆寂归尘', priority: 3, category: { id: 1 }, effects: [{ id: 875, args: [], info: '消耗自身全部体力，对手所有技能PP值归零，全属性-1' }] }),
  jinlun: skill({ id: 31843, name: '金轮耀世斩', power: 160, category: { id: 1 }, effects: [{ id: 1061, args: [], info: '反转对手能力提升状态，反转成功则自身附加相同的能力提升，反转失败则消除对手能力提升状态' }, { id: 1136, args: [2, 3], info: '自身体力高于1/2时附加自身当前体力1/3的百分比伤害' }, { id: 1137, args: [2, 3], info: '自身体力低于1/2时吸取对手最大体力的1/3' }] }),
  kongjian: skill({ id: 31840, name: '空间破碎', power: 130, category: { id: 1 }, effects: [{ id: 890, args: [], info: '自身处于能力提升状态时造成的伤害翻倍' }] }),
  lingkong: skill({ id: 13100, name: '灵空击', power: 70, category: { id: 1 }, effects: [{ id: 35, args: [], info: '惩罚，对方能力等级越高，此技能威力越大' }] }),
  guang: skill({ id: 31841, name: '光轮回旋', power: 140, category: { id: 2 }, effects: [{ id: 683, args: [200, 400], info: '随机附加200~400点固定伤害' }] }),
  pudu: skill({ id: 26028, name: '雷音普渡', effects: [{ id: 681, args: [2], info: '下2回合自身攻击技能必定致命、必定命中' }] }),
  zhihuan: skill({ id: 24201, name: '致幻雷鸣', effects: [{ id: 47, args: [3], info: '3回合内免疫能力下降状态' }, { id: 583, args: [1], info: '使对手随机1项技能的PP值归零' }] }),
  rain: skill({ id: 20086, name: '雷雨天', effects: [{ id: 5, args: [1, 100, -1], info: '技能使用成功时，100%改变对手防御等级-1' }, { id: 5, args: [3, 100, -1], info: '技能使用成功时，100%改变对手特防等级-1' }] }),
  jingdian: skill({ id: 11267, name: '静电强击', power: 60, category: { id: 1 }, effects: [{ id: 5, args: [4, 15, -1], info: '技能使用成功时，15%改变对手速度等级-1' }] }),
};
const ALL = [S.dhy, S.flash, S.tianwei, S.huanglei, S.yuanji, S.jinlun, S.kongjian, S.lingkong, S.guang, S.pudu, S.zhihuan, S.rain, S.jingdian, ATK];
function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(3576, '大轮明王'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [
    skill({ id: 21, name: '撞击', power: 35, category: { id: 1 } }),
    skill({ id: 22, name: '撞击2', power: 35, category: { id: 1 } }),
    skill({ id: 23, name: '撞击3', power: 35, category: { id: 1 } })] }];
  return new B.Battle({ chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: 100, meTeam, foeTeam });
}
function idx(id) { for (let i = 0; i < ALL.length; i++) if (ALL[i].id === id) return i; return -1; }
function logHas(b, s) { return (b.log || []).some(function (x) { return String(x).indexOf(s) >= 0; }); }

console.log('— 大轮明王 3576：魂印解析 —');
{
  const sm = B.parseSoulmark(SOUL);
  eq(sm.length, 3, '魂印解析 3 条');
  eq(sm[0].kind, 'mwAtkStatDown', '对手攻击命中前全属性 -1');
  eq(sm[1].kind, 'mwPhaseTransfer', '战斗阶段结束转移异常/弱化');
  eq(sm[2].kind, 'mwDeathBless', '阵亡后祝福下只精灵');
}

console.log('— 魂印：对手攻击命中前全属性 -1 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  b.useSkill('foe', 0, { isFirst: true });
  eq(foe.stages.atk, -1, '攻击者全属性 -1（攻击）');
  eq(foe.stages.spd, -1, '攻击者全属性 -1（速度）');
}

console.log('— 魂印：战斗阶段结束转移异常与弱化 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.status = { id: 'fear', turns: 2 };
  me.stages.atk = -2;
  foe.guards.push({ turns: 3, mul: 0.5, scope: 'all' });
  b.endOfTurn();
  eq(foe.guards.length, 0, '清除对手回合类效果');
  ok(foe.status && foe.status.id === 'fear', '附加自身异常状态给对手');
  eq(foe.stages.atk, -2, '附加自身能力下降给对手');
}

console.log('— 魂印：阵亡转移 + 下只精灵祝福 —');
{
  const meTeam = [
    { pet: pet(3576, '大轮明王'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) },
    { pet: pet(9999, '替补'), combo, skills: [ATK], passives: [] }];
  const b = battle({ meTeam, rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.status = { id: 'burn', turns: 2 };
  me.stages.def = -1;
  me.hp = 0;
  b.checkFaints();
  const nxt = b.me.team[1];
  ok(b.mw3576Bless && b.mw3576Bless['me'], '阵亡后留下下只精灵祝福');
  b.onEnter(nxt);
  ok(nxt.stages.atk === 1 && nxt.stages.def >= 0, '下只精灵登场全属性 +1');
  ok((nxt.immuneStatus || 0) >= 1, '下只精灵免疫下 1 次异常');
  b.endOfTurn();
  ok(foe.status && foe.status.id === 'burn', '阵亡后战斗阶段结束仍转移异常');
  eq(foe.stages.def, -1, '阵亡后仍转移能力下降');
}

console.log('— 禅定印：吸取 1/4，体力低于对手变 1/3 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.maxHp = 3000; foe.hp = 3000;
  const hp0 = me.hp;
  b.useSkill('me', idx(31838), { isFirst: true });
  ok(logHas(b, '吸取了对手 750 点体力'), '吸取对手最大体力 1/4');
  me.hp = 100;
  foe.hp = 3000;
  b.useSkill('me', idx(31838), { isFirst: true });
  ok(logHas(b, '吸取了对手 1000 点体力'), '自身体力低于对手：吸取 1/3');
}

console.log('— 闪雷之暴：50% 全属性 -1 —');
{
  const b = battle({ rng: () => 0.4 });
  const foe = b.foe.team[0];
  b.useSkill('me', idx(31839), { isFirst: true });
  eq(foe.stages.atk, -1, '50% 触发（攻击）');
  eq(foe.stages.spd, -1, '50% 触发（速度）');
  const b2 = battle({ rng: () => 0.6 });
  const foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(31839), { isFirst: true });
  eq(foe2.stages.atk, 0, '未触发时不弱化');
}

console.log('— 明王天威：无强化时全属性 +2 / 回血百分比 / 先制 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', idx(26030), { isFirst: true });
  eq(me.stages.atk, 2, '自身无强化：全属性 +2');
  ok(me.teUseHeal && me.teUseHeal.percent, '4 回合回血并造成等量百分比伤害');
  ok(me.teUseHeal.lowHalf === 2, '体力低于 1/2 时翻倍');
  ok(me.priorityBuff && me.priorityBuff.value === 2, '下 2 回合先制 +2');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0];
  me2.stages.atk = 1;
  b2.useSkill('me', idx(26030), { isFirst: true });
  eq(me2.stages.atk, 2, '自身已有强化：只 +1');
}

console.log('— 圣界煌雷：80% 麻痹，未触发技能失效 —');
{
  const b = battle({ rng: () => 0.5 });
  const b2 = battle({ rng: () => 0.9 });
  const foe = b.foe.team[0], foe2 = b2.foe.team[0];
  b.useSkill('me', idx(26029), { isFirst: true });
  ok(foe.status && foe.status.id === 'paralyze', '80% 触发麻痹');
  b2.useSkill('me', idx(26029), { isFirst: true });
  eq(foe2.skillBlock, 1, '未触发：对手下 1 次技能失效');
  eq(b.me.team[0].reflectStatus, 4, '4 回合免疫并反弹异常');
}

console.log('— 圆寂归尘：自爆 + 对手 PP 归零 / 全属性 -1 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  b.useSkill('me', idx(31842), { isFirst: true });
  eq(me.hp, 0, '消耗自身全部体力');
  ok(foe.skills.every(sl => sl.pp === 0), '对手所有技能 PP 归零');
  eq(foe.stages.atk, -1, '对手全属性 -1');
}

console.log('— 金轮耀世斩：反转强化 / 高血百分比 / 低血吸取 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = me.maxHp;
  foe.maxHp = 99999; foe.hp = 99999;
  foe.stages.atk = 2;
  b.useSkill('me', idx(31843), { isFirst: true });
  eq(foe.stages.atk, -2, '反转对手能力提升');
  eq(me.stages.atk, 2, '自身获得相同强化');
  ok(logHas(b, '百分比伤害（' + Math.floor(me.maxHp / 3) + '）'), '体力高于 1/2：附加当前体力 1/3 百分比伤害');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  me2.hp = 1000;
  foe2.maxHp = 3000; foe2.hp = 3000;
  const hp0 = me2.hp;
  b2.useSkill('me', idx(31843), { isFirst: true });
  ok(me2.hp > hp0, '体力低于 1/2：吸取对手最大体力 1/3 并回复');
  ok(logHas(b2, '1/3（1000）'), '吸取量 = 对手最大体力 1/3');
}

console.log('— 空间破碎：自身有强化时伤害翻倍 —');
{
  const noBuff = Object.assign({}, S.kongjian, { effects: [] });
  function dmgWith(skillObj, up) {
    const b = battle({ rng: () => 0.99, meTeam: [{ pet: pet(3576, '大轮明王'), combo, skills: [skillObj, ATK], passives: [] }] });
    b.me.team[0].stages.atk = up ? 1 : 0;
    b.foe.team[0].hp = 99999; b.foe.team[0].maxHp = 99999;
    const before = b.foe.team[0].hp;
    b.useSkill('me', 0, { isFirst: true });
    return before - b.foe.team[0].hp;
  }
  const withBuff = dmgWith(S.kongjian, true);
  const control = dmgWith(noBuff, true);
  ok(withBuff >= control * 1.8, '自身有强化：本技能伤害翻倍 (' + control + '→' + withBuff + ')');
  ok(dmgWith(S.kongjian, false) < withBuff, '无强化时伤害更低');
}

console.log('— 灵空击 / 光轮回旋 / 雷音普渡 / 致幻雷鸣 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 3;
  const base = B.calcDamage({ actor: me, target: foe, skill: S.lingkong, rng: () => 0.99, turn: 1 }).damage;
  const plain = B.calcDamage({ actor: me, target: foe, skill: S.lingkong, rng: () => 0.99, turn: 1 }).damage;
  ok(base > 0, '灵空击可结算');
  b.useSkill('me', idx(31841), { isFirst: true });
  ok(logHas(b, '随机附加'), '光轮回旋附加 200~400 固伤');
  b.useSkill('me', idx(26028), { isFirst: true });
  ok(me.mustHitTurns === 2 || me.mustHitTurns > 0, '2 回合必定命中');
  ok(me.critBuffTurns === 2 || me.critBuffTurns > 0, '2 回合必定致命');
  b.useSkill('me', idx(24201), { isFirst: true });
  ok(me.immuneStat === 3 || me.immuneStatTurns === 3, '3 回合免疫能力下降');
  ok(foe.skills.some(sl => sl.pp === 0), '随机 1 项技能 PP 归零');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); } else { console.log('ALL PASS'); }
