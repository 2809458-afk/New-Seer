import { BattleSession } from '../src/core/session';
import { GameStore, emptyTeam } from '../src/core/store';
import { loadPack, statsOf } from '../src/data/pack';

// 只由 CDP 测试注入，不进入产品构建。
Object.assign(globalThis, { seerSoakReady: (async () => {
  const pack = await loadPack();
  let expected = '';
  return () => {
    const store = new GameStore({ turn: 0, me: { name: '', hp: 0, maxHp: 1 }, foe: { name: '', hp: 0, maxHp: 1 }, team: emptyTeam() });
    for (const p of pack.pets.slice(0, 2)) {
      const s = statsOf(p); store.selectPet({ id: p.id, name: p.name, hp: s.hp, maxHp: s.hp, atk: s.atk, spd: s.spd });
    }
    const session = new BattleSession(pack, store);
    session.start(7919);
    const durations: number[] = [];
    let count = 0;
    while (!session.snapshot().over && count < 100) {
      const view = session.snapshot(), me = view.me.team[view.me.active];
      const skill = me.skills.findIndex((s) => s.pp > 0);
      const action = view.needPlayerSwitch ? { type: 'switch' as const, index: view.me.team.findIndex((p, i) => p.alive && !p.exiled && i !== view.me.active) }
        : skill >= 0 ? { type: 'skill' as const, index: skill } : { type: 'pass' as const };
      const start = performance.now(); session.settle(action); durations.push(performance.now() - start); count++;
    }
    if (!session.snapshot().over) throw new Error('soak battle did not finish');
    const trace = JSON.stringify({ view: session.snapshot(), logs: session.logs() });
    if (expected && trace !== expected) throw new Error('determinism drift');
    expected = trace;
    return durations;
  };
})() });
