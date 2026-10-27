/* 效果编号（id）直读：node test/effect-ids.test.js */
global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')'); }
function parse(id, args) { return B.parseSkillEffects({ id: 1, name: 't', power: 1, effects: [{ id: id, info: '', args: args || [] }] }); }

console.log('— 第二批效果编号 —');
eq(parse(843, [2, 2])[0].value, 2, '843：先制 +2');
eq(parse(843, [2, 2])[0].turns, 2, '843：持续 2 回合');
eq(parse(48, [1])[0].turns, 1, '48：免疫异常 1 回合');
{ const f = parse(585, [1, 0, 0, 0, 1, 0]); eq(f.length, 2, '585：攻击+1、速度+1 两条'); eq(f[0].stat, 'atk', '585：第一条攻击'); eq(f[1].stat, 'spd', '585：第二条速度'); }
eq(parse(47, [2])[0].turns, 2, '47：免疫能力下降 2 回合');
eq(parse(58, [2])[0].turns, 2, '58：必暴 2 回合');
eq(parse(15, [5])[0].chance, 5, '15：5% 害怕');
eq(parse(15, [5])[0].statusId, 'fear', '15：状态为害怕');
eq(parse(10, [25])[0].statusId, 'paralyze', '10：麻痹');
eq(parse(11, [100])[0].chance, 100, '11：100% 中毒');
eq(parse(14, [10])[0].statusId, 'frost', '14：冻伤');
eq(parse(16, [5])[0].statusId, 'sleep', '16：睡眠');
eq(parse(450, [1, 100])[0].max, 100, '450：随机回血上限取 args');
eq(parse(683, [80, 150])[0].min, 80, '683：随机固定伤害下限');
eq(parse(31, [2, 5])[0].max, 5, '31：2~5 连击');
eq(parse(693, [3, 50])[0].mul, 1.5, '693：增伤 50%');
eq(parse(776, [1])[0].mul, 2, '776：伤害翻倍');
eq(parse(77, [3, 30])[0].value, 30, '77：用技能回 30 点');
eq(parse(43, [10])[0].den, 10, '43：回复 1/10');
eq(parse(532, [2, 5])[0].den, 5, '532：用技能回 1/5');
eq(parse(597, [5, 8])[0].den, 8, '597：吸取 1/8');
eq(parse(60, [5, 50])[0].value, 50, '60：每回合 50 固伤');
eq(parse(93, [25, 100])[0].value, 100, '93：100 点固伤');
eq(parse(433, [3, 1, 0, 0, 0, 0, 0]).length, 1, '433：每回合攻击+1');
eq(parse(447, [150])[0].value, 150, '447：伤害不少于 150');
eq(parse(37, [])[0].cond, 'selfLow', '37：自身低血威力翻倍');
eq(parse(408, [2, 150])[0].value, 150, '408：每回合减伤 150');

console.log('— 第三批（32 只主流精灵用到的 id）—');
eq(parse(1065, [4, 3, 2])[0].den, 3, '1065：用技能回血 1/3');
ok(parse(736, [2]).some(f => f.kind === 'clear') && parse(736, [2]).some(f => f.kind === 'skillBlock' && f.turns === 2), '736：清强化 + 属性技封锁 2 回合');
eq(parse(971, [4, 3, 2])[0].kind, 'drainMax', '971：吸取最大体力');
eq(parse(679, [3])[0].turns, 3, '679：禁疗 3 回合');
eq(parse(852, [25, 3])[0].pct, 25, '852：按最大体力 25% 固伤');
eq(parse(885, [1]).length, 5, '885：全属性 +1');
{ const f = parse(901, [2, 0, 0, 0, 2, 0]); ok(f[0].kind === 'clearFoe' && f.length === 3, '901：断回合 + 攻击/速度各 +2'); }
ok(parse(928, [2]).some(f => f.kind === 'immuneStatus' && f.turns === 2 && f.req.type === 'clearSuccess'), '928：断回合成功免疫 2 次异常');
ok(parse(1224, [2]).some(f => f.kind === 'critBuff' && f.turns === 2 && f.req.type === 'clearSuccess'), '1224：断回合成功必暴 2 回合');
eq(parse(88, [10, 4])[0].mul, 4, '88：10% 概率 4 倍伤害');
eq(parse(481, [1, 1])[0].value, 1, '481：先制 +1');
eq(parse(523, [1, 0, 0, 0, 1, 0]).length, 2, '523：攻击结束攻速各 +1');
eq(parse(583, [1])[0].count, 1, '583：随机 1 项 PP 归零');
eq(parse(645, [3, 3])[0].mul, 3, '645：低血 3 倍威力');
eq(parse(717, [4, 4, 2])[0].den, 4, '717：吸取 1/4');
eq(parse(837, [150, 100, 350])[0].cap, 350, '837：吸取上限 350');
ok(parse(942, [3]).some(f => f.kind === 'drainMax' && f.den === 3 && f.req.type === 'clearSuccess'), '942：断回合成功吸 1/3');
eq(parse(1005, [2])[0].den, 2, '1005：回血 1/2');
eq(parse(1285, [2])[0].amount, 2, '1285：未击败则扣对手 2 点 PP');
ok(parse(1355, [1]).some(f => f.kind === 'immuneStatus' && f.req.type === 'crit'), '1355：暴击后免疫异常');
eq(parse(1684, [4])[0].turns, 4, '1684：锁能力下降 4 回合');
eq(parse(125, [2, 250])[0].value, 250, '125：受伤上限 250');
eq(parse(76, [100, 5, 100])[0].value, 100, '76：每回合 100 固伤');
ok(parse(681, [2]).length === 2, '681：必暴 + 必中');
eq(parse(984, [2])[0].value, 2, '984：未击败则先制 +2');
eq(parse(1021, [100])[0].mul, 2, '1021：对手无强化时伤害翻倍');
console.log(fails ? '\n' + fails + ' 项失败' : '\n全部通过');
process.exit(fails ? 1 : 0);