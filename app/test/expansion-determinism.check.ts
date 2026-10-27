import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
// @ts-ignore Node-only source loader
import { readEffectiveOracle } from '../config/oracle.mjs';

const load = (source: string) => { const context: Record<string, any> = {}; runInNewContext(source, context); return context.SeerBattle; };
const frozen = load(readFileSync(new URL('../../web/js/battle.js', import.meta.url), 'utf8'));
const expanded = load(readEffectiveOracle());
const combo = { id: 1, name: '草', primary: { id: 1 }, secondary: null };
for (const info of ['100%改变自身攻击等级+1', '消除对手能力提升状态', '命中后100%令对方中毒', '随机附加100~200点固定伤害']) {
  const run = (B: any) => {
    let calls = 0;
    const entry = (id: number) => ({ pet: { id, name: '测试' + id, base_stats: { hp: 1000, atk: 100, def: 100, sp_atk: 100, sp_def: 100, spd: 100 } },
      combo, skills: [{ id: 1, name: '测试技能', power: 0, max_pp: 20, accuracy: 100, crit_rate: 0, category: { id: 4 }, type: { id: 1 }, info, effects: [] }] });
    const battle = new B.Battle({ rng: () => { calls++; return .5; }, comboOf: () => combo, chart: { 1: { 1: 1 } }, meTeam: [entry(1)], foeTeam: [entry(2)] });
    battle.foe.team[0].stages.atk = 2;
    for (let i = 0; i < 3; i++) battle.step({ type: 'skill', index: 0 });
    return JSON.stringify({ calls, log: battle.log, snapshot: battle.snapshot() });
  };
  assert.equal(run(expanded), run(frozen), info + ': frozen random/event/state stream');
}
console.log('four unrelated effect families retain frozen RNG calls / events / state PASS');
