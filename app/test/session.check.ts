import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BattleSession, battleConfig, seededRng } from '../src/core/session';
import { GameStore, emptyTeam } from '../src/core/store';
import { parseCombos } from '../src/data/tables';
import { statsOf, type Pack } from '../src/data/pack';
import { parseRuleList, RULES } from '../src/data/rules';

const legacy = createRequire(import.meta.url)('../../web/js/battle.js');
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8')).items;
const pack: Pack = { pets: read('pets'), skills: read('skills'), types: read('types'), soulmarks: read('soulmarks'), combos: parseCombos({ items: read('combos') }).value };
const store = new GameStore({ turn: 0, me: { name: '', hp: 0, maxHp: 1 }, foe: { name: '', hp: 0, maxHp: 1 }, team: emptyTeam() });
const session = new BattleSession(pack, store);
assert.throws(() => session.start(), /至少一只/);
for (const pet of pack.pets.slice(0, 2)) {
  const stats = statsOf(pet);
  store.selectPet({ id: pet.id, name: pet.name, hp: stats.hp, maxHp: stats.hp, atk: stats.atk, spd: stats.spd });
}
const oracle = new legacy.Battle(battleConfig(pack, pack.pets.slice(0, 2), pack.pets.slice(2, 4), seededRng(7919)));
session.start(7919);
assert.deepEqual(session.snapshot(), oracle.snapshot());
let swaps = 0, actions = 0;
while (!session.snapshot().over && actions < 100) {
  const view = session.snapshot();
  const me = view.me.team[view.me.active];
  const next = view.me.team.findIndex((p, i) => p.alive && !p.exiled && i !== view.me.active);
  const index = me.skills.findIndex((s) => s.pp > 0);
  const action = view.needPlayerSwitch ? { type: 'switch' as const, index: next } : index >= 0 ? { type: 'skill' as const, index } : { type: 'pass' as const };
  const before = oracle.log.length;
  if (view.needPlayerSwitch) { oracle.playerSwitch(next); swaps++; } else oracle.step(action);
  const events = session.settle(action);
  assert.deepEqual(events.map((e) => e.text), oracle.log.slice(before));
  assert.deepEqual(session.snapshot(), oracle.snapshot());
  const current = session.snapshot().me;
  assert.equal(store.get().me.hp, current.team[current.active].hp);
  actions++;
}
assert(session.snapshot().over);
assert(swaps > 0, 'forced switch was exercised');
assert.deepEqual(session.settle({ type: 'pass' }), []);
session.start(7919); assert.equal(session.snapshot().turn, 0);

// 每条规则至少一个固定队伍+固定动作序列对拍，包含概率与随机效果。
const texts = [...readFileSync(new URL('rules.compare.ts', import.meta.url), 'utf8').matchAll(/cmp\('([^']+)'/g)].map((m) => m[1]);
texts.push('全属性+1', '自身全属性+1', '令对手全属性-1');
const tested = new Set<string>();
for (const text of texts) {
  const fx = parseRuleList(text)!;
  assert(fx, text);
  const rule = RULES.find((r) => r.pattern.test(text))!;
  tested.add(rule.name);
  const expected: unknown[] = []; legacy.parseOneEffect(text, expected);
  assert.deepEqual(fx, expected, text);
  const make = (effects: unknown[]) => {
    const cfg = battleConfig(pack, [pack.pets[0]], [pack.pets[2]], seededRng(7919));
    cfg.meTeam[0].skills[0] = { ...cfg.meTeam[0].skills[0], _fx: structuredClone(effects), info: text };
    return new legacy.Battle(cfg);
  };
  const a = make(fx), b = make(expected);
  for (let turn = 0; turn < 4 && !a.over; turn++) {
    a.step({ type: 'skill', index: 0 }); b.step({ type: 'skill', index: 0 });
    assert.deepEqual(a.log, b.log, text); assert.deepEqual(a.snapshot(), b.snapshot(), text);
  }
}
assert.equal(tested.size, RULES.length, 'all rules need a deterministic combat case');
console.log(`session ${actions} actions / ${swaps} forced switches / ${tested.size} rules with seeded combat parity PASS`);
