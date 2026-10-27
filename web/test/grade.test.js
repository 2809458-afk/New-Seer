/* 数据分级工具测试：node test/grade.test.js */
const { gradePet } = require('../tools/grade-data.js');

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.error('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (期望 ' + b + '，实际 ' + a + ')');
}

const skillMap = new Map();
function addSkill(id, info) {
  skillMap.set(id, { id, name: '技能' + id, effects: info ? [{ id: 1, info }] : [] });
}
addSkill(100);                         // 纯伤害，无效果文本
addSkill(101, '完全无法解析的胡话');     // 解析失败
addSkill(102, '给予对方损伤的一半会恢复自己的体力'); // 可解析

const soulMap = new Map();
soulMap.set(1, { id: 1, desc: '自身受到的攻击伤害减少10%' });
soulMap.set(2, { id: 2, desc: '完全无法解析的胡话' });
soulMap.set(3, { id: 3, desc: '自身受到的攻击伤害减少10%|完全无法解析的胡话' });

function pet(id, soulmarks, skills) {
  return { id, name: '测试' + id, soulmarks, skills: skills.map(sid => ({ id: sid })) };
}

console.log('— 数据分级 —');

let g = gradePet(pet(1, [], [100]), skillMap, soulMap);
eq(g.grade, 'C', '无魂印 → C');
ok(g.reasons.indexOf('no_soulmark') >= 0, 'C 原因 no_soulmark');

g = gradePet(pet(2, [1], [100]), skillMap, soulMap);
eq(g.grade, 'A', '魂印可解析 + 纯伤害技能 → A');

g = gradePet(pet(3, [1], [102]), skillMap, soulMap);
eq(g.grade, 'A', '魂印 + 可解析效果技能 → A');

g = gradePet(pet(4, [2], [100]), skillMap, soulMap);
eq(g.grade, 'B', '魂印不可解析 → B');
ok(g.badSoulmarks.length > 0, 'B 记录坏魂印');

g = gradePet(pet(5, [1], [101]), skillMap, soulMap);
eq(g.grade, 'B', '技能不可解析 → B');
ok(g.badSkills.length > 0, 'B 记录坏技能');

g = gradePet(pet(6, [999], [100]), skillMap, soulMap);
eq(g.grade, 'C', '魂印引用悬空 → C');
ok(g.flags.some(f => f.indexOf('dangling_soulmark') === 0), '记录悬空魂印');

g = gradePet(pet(8, [3], [100]), skillMap, soulMap);
eq(g.grade, 'B', '魂印只有部分分段可解析 → B');
ok(g.badSoulmarks.length > 0, '记录半成品魂印分段');

g = gradePet(pet(7, [1], [999]), skillMap, soulMap);
eq(g.grade, 'B', '技能引用悬空 → B');
ok(g.badSkills.some(x => x.reason === 'missing'), '记录缺失技能');

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
