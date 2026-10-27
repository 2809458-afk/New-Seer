global.window = global;
global.self = global;
const B = require('../js/battle.js');
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok  ' + msg); else { fails++; console.error('  FAIL ' + msg); } }

// ---- 极简 DOM 桩：只为跑通 skilltest.js 的开局流程 ----
function makeEl(id) {
  const el = {
    id, value: '', checked: false, textContent: '', title: '', _html: '',
    style: {}, dataset: {}, children: [], options: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(x) { this.children.push(x); return x; },
    addEventListener() {}, querySelectorAll() { return []; },
    closest() { return null; }
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); el.children = []; } });
  return el;
}
const els = Object.create(null);
function byId(id) { return (els[id] = els[id] || makeEl(id)); }
global.document = {
  readyState: 'complete',
  querySelector(sel) { return sel && sel[0] === '#' ? byId(sel.slice(1)) : makeEl(sel); },
  createElement(tag) { return makeEl('<' + tag + '>'); },
  addEventListener() {}
};

function pet(id, name, skills, extra) {
  return Object.assign({
    id, name, type: { id: 1 },
    base_stats: { hp: 1000, atk: 140, def: 100, sp_atk: 100, sp_def: 100, spd: 100 },
    skill: skills.map(s => ({ skill: { id: s } })), fifth: []
  }, extra || {});
}
function sk(id, name, power, cat) {
  return { id, name, power: power || 0, max_pp: 10, accuracy: 100, crit_rate: 0, priority: 0,
    must_hit: true, category: { id: cat || 1 }, type: { id: 1 }, info: '', effects: [] };
}
const P3311 = pet(3311, '圣光灵神', [1001, 1002]);
const BUBU = pet(1, '布布种子', []);
const skills = { 1001: sk(1001, '光之闪', 85), 1002: sk(1002, '属性技', 0, 4), 3001: sk(3001, '指定属性技', 0, 4) };

const marks = { 1: [{ id: 88, desc: '测试魂印', pets: [1] }] };
global.SeerDb = {
  getAll(store) {
    if (store === 'pets') return [P3311, BUBU];
    if (store === 'soulmarks') return [];
    if (store === 'combos') return [];
    if (store === 'types') return [{ id: 1, name: '草' }];
    if (store === 'skills') return Object.keys(skills).map(k => skills[k]);
    return [];
  },
  get(store, id) { return store === 'skills' ? skills[id] : undefined; }
};
global.SeerApi = { getOne() { return Promise.resolve(null); } };
global.SeerApp = { state: { team: [3311], petById: { 3311: P3311 }, loadouts: {} }, showSkill() {}, onTip() {} };
global.SeerBattle = B;
require('../js/skilltest.js');

byId('stFoeSoul').checked = true;
byId('stFoeSkillMode').value = 'pound';
const ST = window.SeerSkillTest;

(async function () {
  console.log('— 技能测试页：对手可配置 —');
  ST.start();
  await new Promise(r => setTimeout(r, 30));
  let b = ST.battle();
  ok(!!b, '默认配置能开局');
  ok(b.foe.team.length === 6 && b.foe.team[0].pet.id === 1, '默认对手是 6 只 1 号布布种子');
  ok(b.foe.team[0].maxHp === 10000, '默认木桩体力 10000（' + b.foe.team[0].maxHp + '）');
  ok(b.foe.team[0].skills[0].skill.name === '撞击', '默认对手技能「撞击」');
  ok(b.foe.team[0].soulmarks.length === 0, '未勾选「对手带魂印」时不挂魂印');
  ok(b.me.team[0].pet.id === 3311, '我方仍用出战格精灵');

  // 对手换成 3311 + 体力 5000 + 初始 50%
  byId('stFoePet').value = '3311';
  byId('stFoeHp').value = '5000';
  byId('stFoeHpPct').value = '50';
  byId('stFoeSoul').checked = true;
  ST.start();
  await new Promise(r => setTimeout(r, 30));
  b = ST.battle();
  ok(b.foe.team[0].pet.id === 3311, '对手可换成自选精灵（3311）');
  ok(b.foe.team[0].maxHp === 5000, '木桩体力可改（5000）');
  ok(b.foe.team[0].hp === 2500, '初始体力% 生效（2500/5000）');

  // 待机模式
  byId('stFoeSkillMode').value = 'none';
  ST.start();
  await new Promise(r => setTimeout(r, 30));
  b = ST.battle();
  ok(b.foe.team[0].skills.length === 1 && b.foe.team[0].skills[0].skill.name === '待机', '「待机」模式给 0 威力空技能');
  ok(b.foe.team[0].skills[0].skill.power === 0, '待机技能威力为 0');

  // 指定技能（按编号）
  byId('stFoeSkillMode').value = 'pick';
  byId('stFoeSkill').value = '3001';
  ST.start();
  await new Promise(r => setTimeout(r, 30));
  b = ST.battle();
  ok(b.foe.team[0].skills[0].skill.id === 3001, '按编号指定对手技能生效');

  // 前置状态：异常 / 护盾 / 体力 / PP / 场下
  console.log('— 技能测试页：前置状态 —');
  const foe = b.foe.active;
  b.applyStatus(b.foe.team[foe], 'paralyze', 3, '对手');
  ok(!!b.foe.team[foe].status && b.foe.team[foe].status.id === 'paralyze', '异常可手动施加');
  b.foe.team[foe].shield = 500;
  b.foe.team[foe].ward = 300;
  ok(b.foe.team[foe].shield === 500 && b.foe.team[foe].ward === 300, '护盾/护罩可直接设置');
  const benchHtml = ST.benchHtml('foe');
  ok(/data-bench="foe:/.test(benchHtml), '场下体力编辑框已生成（' + (benchHtml.match(/data-bench="foe:\d+"/g) || []).length + ' 个）');
  b.foe.team[1].hp = 1;
  const snap = b.snapshot();
  ok(snap.foe.team[1].hp === 1, '场下体力可改并进快照');

  if (fails) { console.error('FAILED=' + fails); process.exit(1); }
  console.log('ALL PASS');
})();
