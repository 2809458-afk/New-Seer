/* P3 用例：队伍状态由 core 产生（§5.2 确定性用例）
 * 运行：cd app && npx tsx test/team.check.ts
 */
import { GameStore, emptyTeam, TEAM_SIZE } from '../src/core/store';
import type { GameState, TeamSlot } from '../src/core/store';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { fails++; console.error(`  FAIL ${msg}`); }
};

const mk = (id: number, name: string, hp: number): TeamSlot => ({
  id, name, comboName: '草', hp, maxHp: hp, atk: 100, spd: 100
});

function newStore(): GameStore {
  const init: GameState = {
    turn: 1,
    me: { name: '空队伍', hp: 0, maxHp: 1 },
    foe: { name: '对手', hp: 380, maxHp: 380 },
    team: emptyTeam()
  };
  return new GameStore(init);
}

// 1) 加入 → 出战位第 1 只同步为对战首发的名字与血量
{
  const s = newStore();
  s.selectPet(mk(1, '布布种子', 251));
  ok(s.get().team[0]?.name === '布布种子', '加入后占用第 1 格');
  ok(s.get().me.name === '布布种子' && s.get().me.maxHp === 251, 'core 把首发同步进对战状态');
}

// 2) 再次点击同一只 → 移除，并回退空队伍
{
  const s = newStore();
  s.selectPet(mk(1, '布布种子', 251));
  s.selectPet(mk(1, '布布种子', 251));
  ok(s.get().team.filter(Boolean).length === 0, '再次点击移除');
  ok(s.get().me.name === '空队伍', '移除后对战状态回退');
}

// 3) 最多 12 格，第 13 只被拒绝
{
  const s = newStore();
  for (let i = 1; i <= TEAM_SIZE; i++) s.selectPet(mk(i, '精灵' + i, 300));
  ok(s.get().team.filter(Boolean).length === TEAM_SIZE, `填满 ${TEAM_SIZE} 格`);
  ok(s.selectPet(mk(99, '溢出', 300)) === false, '第 13 只被拒绝');
}

// 4) 首发始终取第 1 格（换位语义后续再加）
{
  const s = newStore();
  s.selectPet(mk(7, '甲', 100));
  s.selectPet(mk(8, '乙', 200));
  ok(s.get().me.name === '甲', '首发取第 1 格');
  s.clearTeam();
  ok(s.get().team.filter(Boolean).length === 0 && s.get().me.name === '空队伍', '清空队伍');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 队伍 core 用例通过');
process.exit(fails ? 1 : 0);
