global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
const combo = { id: 110, name: '混沌次元', primary: { id: 110 }, secondary: { id: 30 } };
const chart = { 110: { 110: 1 } };
const SOUL = '自身受到的攻击伤害高于300时下回合自身受到的攻击伤害减少50%|自身被击败后，将对手体力降为1点，然后消除对手回合类效果并反转对手能力提升（BOSS无效）';
function pet(id, name, stats) {
  return { id, name, base_stats: Object.assign({ hp: 2000, atk: 150, def: 130, sp_atk: 80, sp_def: 130, spd: 140 }, stats || {}) };
}
function skill(over) {
  return Object.assign({ id: 1, name: '测试技能', power: 0, max_pp: 10, accuracy: 100, crit_rate: 0,
    priority: 0, must_hit: true, category: { id: 4 }, type: { id: 110 }, info: '', effects: [] }, over || {});
}
const ATK = skill({ id: 900, name: '普通攻击', power: 60, category: { id: 1 }, effects: [] });
const S = {
  chain: skill({ id: 22193, name: '符文锁链', priority: -1, effects: [{ id: 34, args: [2], info: '将所受的伤害2倍反馈给对手' }] }),
  world: skill({ id: 22194, name: '异域魔界', effects: [{ id: 452, args: [3], info: '3合内自身所有攻击造成的伤害都将为自己恢复体力' }] }),
  fire: skill({ id: 14109, name: '净火之炎', power: 90, category: { id: 2 }, effects: [{ id: 39, args: [100, 1], info: '100%降低对手所有技能1点PP值，然后若对手所选择的技能PP值为0则当回合对手无法行动' }] }),
  song: skill({ id: 22410, name: '灵魂之歌', accuracy: 60, effects: [{ id: 136, args: [4], info: '若Miss则自己恢复1/4体力' }, { id: 15, args: [100], info: '命中后100%令对方害怕' }] }),
  light: skill({ id: 14486, name: '神秘之光', power: 110, category: { id: 2 }, effects: [{ id: 500, args: [50], info: '若对手处于害怕状态则伤害翻倍' }] }),
  moon: skill({ id: 14482, name: '苍月之击', power: 120, category: { id: 1 }, effects: [{ id: 430, args: [0, 1], info: '消除对手能力提升状态，若消除状态成功，则自身攻击等级+1' }] }),
  zhao: skill({ id: 16961, name: '神照天殇', power: 50, category: { id: 1 }, effects: [{ id: 15, args: [80], info: '命中后80%令对方害怕' }, { id: 714, args: [3], info: '使用技能时若对手处于能力提升状态，则先制+3，同时消除对手能力提升状态' }] }),
  burn: skill({ id: 16963, name: '明王焚天照', power: 150, category: { id: 1 }, effects: [{ id: 181, args: [40, 2, 20, 100], info: '40%概率令对手烧伤，连续攻击每次提高20%概率，最多提高100%' }] }),
  heal: skill({ id: 23837, name: '天佑明尊', effects: [{ id: 48, args: [5], info: '5回合内免疫所有受到的异常状态' }, { id: 706, args: [2], info: '将自身的能力下降状态2倍返还给对手' }, { id: 707, args: [4, 3, 3], info: '4回合内每回合使用技能恢复自身最大体力的1/3，恢复体力时若自身体力低于最大体力的1/3则恢复效果翻倍' }] }),
  swap: skill({ id: 23836, name: '轮回天生', effects: [{ id: 705, args: [], info: '与对手互换当前体力' }, { id: 616, args: [3, 2], info: '当自身血量少于1/3时先制+2' }] }),
  break: skill({ id: 30132, name: '不破不立', power: 100, category: { id: 1 }, effects: [{ id: 590, args: [-1, -1, -1, -1, -1, -1, 50], info: '使对手攻击-1，防御-1，特攻-1，特防-1，速度-1，命中-1，50%弱化效果翻倍' }, { id: 1004, args: [3, 150], info: '3回合内使用技能附加150点固定伤害，若自身体力高于对手则效果翻倍' }] }),
  fan: skill({ id: 25172, name: '梵音无尽', effects: [{ id: 1014, args: [1, 2], info: '全属性+1，自身当前体力高于最大体力的1/2时强化效果翻倍' }, { id: 408, args: [3, 250], info: '3回合内每回合所受的伤害减少250' }, { id: 843, args: [2, 2], info: '下2回合令自身所有技能先制+2' }] }),
  rotate: skill({ id: 30131, name: '轮转五方', power: 85, category: { id: 1 }, effects: [{ id: 797, args: [2], info: '消除对手回合类效果，消除成功2回合内对手无法通过自身技能恢复体力' }, { id: 813, args: [], info: '将自身的能力下降状态双倍反馈给对手' }] }),
  gold: skill({ id: 30133, name: '金刚华台意', power: 85, category: { id: 1 }, effects: [{ id: 15, args: [80], info: '命中后80%令对方害怕，未触发则令对手下2回合先制-1' }] }),
  dao: skill({ id: 16960, name: '天道降魔阵', effects: [{ id: 590, args: [-1, -1, -1, -1, -1, -1], info: '使对手全属性-1' }, { id: 700, args: [3, 100], info: '3回合内每回合都能附加100点固定伤害' }] }),
  god: skill({ id: 23838, name: '神明之咒', effects: [{ id: 1014, args: [1], info: '全属性+1' }, { id: 408, args: [3, 200], info: '3回合内每回合所受的伤害减少200' }] }),
  wisdom: skill({ id: 30134, name: '大智善心明', power: 160, category: { id: 1 }, effects: [{ id: 779, args: [], info: '若对手处于能力提升状态则先制+2' }, { id: 660, args: [0, 100], info: '消除对手能力提升状态，消除成功恢复100%的体力' }, { id: 1066, args: [300, 300, 150], info: '造成的伤害低于300则附加300点固定伤害，若先出手则固定伤害提高150点' }] }),
};
const ALL = [S.chain, S.world, S.fire, S.song, S.light, S.moon, S.zhao, S.burn, S.heal, S.swap, S.break, S.fan, S.rotate, S.wisdom, S.gold, S.dao, S.god, ATK];
function battle(opts) {
  opts = opts || {};
  const meTeam = opts.meTeam || [{ pet: pet(3237, '大威势明王'), combo, skills: ALL, passives: B.parseSoulmark(SOUL) }];
  const foeTeam = opts.foeTeam || [{ pet: pet(2, '木桩'), combo, skills: [
    skill({ id: 21, name: '撞击', power: 35, category: { id: 1 } }),
    skill({ id: 22, name: '撞击2', power: 35, category: { id: 1 } }),
    skill({ id: 23, name: '撞击3', power: 35, category: { id: 1 } })] }];
  return new B.Battle({ chart, comboOf: () => combo, rng: opts.rng || (() => 0.99), level: 100, meTeam, foeTeam });
}
function idx(id) { for (let i = 0; i < ALL.length; i++) if (ALL[i].id === id) return i; return -1; }
function logHas(b, s) { return (b.log || []).some(function (x) { return String(x).indexOf(s) >= 0; }); }

console.log('— 大威势明王 3237：魂印 —');
{
  const sm = B.parseSoulmark(SOUL);
  eq(sm.length, 2, '魂印解析 2 条');
  eq(sm[0].kind, 'mwGuard', '受击 >300 → 下回合减伤');
  eq(sm[1].kind, 'mwDeath', '被击败后对手体力降为 1');
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  const hp0 = me.hp;
  b.turn = 1;
  b.applyDamage('me', 350, { attack: true });
  b.applyDamage('me', 200, { attack: true });
  eq(hp0 - me.hp, 550, '当回合不立即减伤');
  b.turn = 2;
  b.applyDamage('me', 200, { attack: true });
  eq(hp0 - me.hp, 650, '下回合攻击伤害减半');
}

console.log('— 魂印死亡：对手体力降为 1 / 清回合 / 反转强化 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 2;
  foe.guards.push({ turns: 3, mul: 0.5, scope: 'all' });
  me.hp = 0;
  b.checkFaints();
  eq(foe.hp, 1, '对手体力降为 1');
  eq(foe.stages.atk, -2, '反转对手能力提升');
  eq(foe.guards.length, 0, '清除对手回合类效果');
}

console.log('— 符文锁链 / 异域魔界 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  b.useSkill('me', idx(22193), { isFirst: true });
  eq(me.reflectNext, 200, '下次受击反馈 200%');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0], foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(22194), { isFirst: true });
  eq(me2.drainTurns && me2.drainTurns.turns, 3, '3 回合攻击吸血');
}

console.log('— 净火之炎：全技能 PP -1 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  foe.skills.forEach(sl => { sl.pp = 5; });
  b.useSkill('me', idx(14109), { isFirst: true });
  ok(foe.skills.every(sl => sl.pp === 4), '对手所有技能 PP 各 -1');
}

console.log('— 神秘之光：害怕时伤害翻倍 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  const before = B.calcDamage({ actor: me, target: foe, skill: S.light, rng: () => 0.99, turn: 1 }).damage;
  foe.status = { id: 'fear', turns: 2 };
  const after = B.calcDamage({ actor: me, target: foe, skill: S.light, rng: () => 0.99, turn: 1 }).damage;
  ok(Math.abs(after - before * 2) <= 2, '害怕时伤害翻倍 (' + before + '→' + after + ')');
  const b2 = battle({ rng: () => 0.99 });
  const foe2 = b2.foe.team[0];
  b2.useSkill('me', idx(14486), { isFirst: true });
  ok(!foe2.status, '使用神秘之光不会错误地附加害怕');
}

console.log('— 苍月之击：消强成功自身攻击 +1 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.atk = 1;
  b.useSkill('me', idx(14482), { isFirst: true });
  eq(foe.stages.atk, 0, '消除对手能力提升');
  eq(me.stages.atk, 1, '消除成功自身攻击 +1');
}

console.log('— 神照天殇：对手有强化则先制 +3 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  const p0 = b.actionPriority(b.me.team[0], { type: 'skill', index: idx(16961) });
  eq(p0, 0, '无强化时先制 0');
  foe.stages.spd = 1;
  const p1 = b.actionPriority(b.me.team[0], { type: 'skill', index: idx(16961) });
  eq(p1, 3, '对手有强化时先制 +3');
}

console.log('— 明王焚天照：连续使用概率递增 —');
{
  const b = battle({ rng: () => 0.5 });
  const foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  b.useSkill('me', idx(16963), { isFirst: true });
  ok(!foe.status, '第 1 次 40%：0.5 不触发');
  b.useSkill('me', idx(16963), { isFirst: true });
  ok(foe.status && foe.status.id === 'burn', '第 2 次 60%：0.5 触发烧伤');
}

console.log('— 轮回天生：换血 + 残血先制 +2 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.hp = 100; foe.hp = 1500;
  eq(b.actionPriority(me, { type: 'skill', index: idx(23836) }), 2, '血量低于 1/3 先制 +2');
  b.useSkill('me', idx(23836), { isFirst: true });
  eq(me.hp, 1500, '互换体力（自身）');
  eq(foe.hp, 100, '互换体力（对手）');
}

console.log('— 不破不立：50% 弱化翻倍 + 3 回合固伤 —');
{
  const b = battle({ rng: () => 0 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.maxHp = 99999; foe.hp = 1000;
  me.hp = me.maxHp;
  b.useSkill('me', idx(30132), { isFirst: true });
  eq(foe.stages.atk, -2, '50% 触发：全属性再 -1');
  ok(me.teFixedUse && me.teFixedUse.turns === 3, '3 回合使用技能附加固伤');
  const hp0 = foe.hp;
  b.useSkill('me', idx(900), { isFirst: true });
  ok(hp0 - foe.hp >= 300, '自身体力高于对手：150 固伤翻倍为 300');
}

console.log('— 梵音无尽：满血以上强化翻倍 / 减伤 250 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  b.useSkill('me', idx(25172), { isFirst: true });
  eq(me.stages.atk, 2, '体力高于 1/2：全属性 +2');
  ok(me.guardFlat && me.guardFlat.value === 250, '3 回合减伤 250');
  const b2 = battle({ rng: () => 0.99 });
  const me2 = b2.me.team[0];
  me2.hp = Math.floor(me2.maxHp / 3);
  b2.useSkill('me', idx(25172), { isFirst: true });
  eq(me2.stages.atk, 1, '体力低于 1/2：全属性 +1');
}

console.log('— 天佑明尊：低血量回血翻倍 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0];
  me.hp = 100;
  b.useSkill('me', idx(23837), { isFirst: true });
  ok(me.hp - 100 >= Math.floor(me.maxHp / 3) * 2 - 2, '低于 1/3：回血翻倍');
}

console.log('— 轮转五方：清回合封恢复 + 双倍反馈弱化 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  me.stages.atk = -2;
  foe.guards.push({ turns: 2, mul: 0.5, scope: 'all' });
  b.useSkill('me', idx(30131), { isFirst: true });
  eq(foe.healBlock, 2, '清回合成功：对手 2 回合无法回血');
  eq(me.stages.atk, 0, '自身弱化被清空');
  eq(foe.stages.atk, -4, '弱化双倍反馈给对手');
}

console.log('— 金刚华台意 / 天道降魔阵 / 神明之咒 —');
{
  const b = battle({ rng: () => 0.99 });
  const foe = b.foe.team[0];
  foe.hp = 99999; foe.maxHp = 99999;
  b.useSkill('me', idx(30133), { isFirst: true });
  ok(!foe.status, '80% 害怕未触发');
  eq(foe.priorityDown && foe.priorityDown.value, 1, '未触发害怕：对手下 2 回合先制 -1');
  const b2 = battle({ rng: () => 0.99 });
  const foe2 = b2.foe.team[0];
  foe2.hp = 5000; foe2.maxHp = 5000;
  b2.useSkill('me', idx(16960), { isFirst: true });
  ok(foe2.dot && foe2.dot.value === 100, '3 回合每回合 100 固伤');
  eq(foe2.stages.atk, -1, '对手全属性 -1');
  const b3 = battle({ rng: () => 0.99 });
  const me3 = b3.me.team[0];
  b3.useSkill('me', idx(23838), { isFirst: true });
  ok(me3.guardFlat && me3.guardFlat.value === 200, '3 回合减伤 200');
  const hp3 = me3.hp;
  b3.applyDamage('me', 500, { attack: true });
  eq(hp3 - me3.hp, 300, '受击伤害减少 200');
}

console.log('— 大智善心明：先制 / 消强回满 / 低伤固伤 —');
{
  const b = battle({ rng: () => 0.99 });
  const me = b.me.team[0], foe = b.foe.team[0];
  foe.stages.def = 1;
  eq(b.actionPriority(me, { type: 'skill', index: idx(30134) }), 2, '对手有强化先制 +2');
  me.hp = 100;
  foe.hp = 99999; foe.maxHp = 99999; foe.stats.def = 99999;
  b.useSkill('me', idx(30134), { isFirst: true });
  eq(foe.stages.def, 0, '消除对手能力提升');
  eq(me.hp, me.maxHp, '消除成功恢复全部体力');
  ok(logHas(b, '附加 300 点固定伤害') && logHas(b, '附加 150 点固定伤害'), '伤害低于 300：先手附加 300+150 固伤');
}

if (fails) { console.error('FAILED ' + fails); process.exit(1); } else { console.log('ALL PASS'); }
