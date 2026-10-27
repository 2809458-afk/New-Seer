/* core 层：单一事实源的最小骨架
 * 只放状态与规则，不引用 DOM / Phaser / React。
 */
export type Side = 'me' | 'foe';

export interface SideState {
  name: string;
  hp: number;
  maxHp: number;
}

export interface GameState {
  turn: number;
  me: SideState;
  foe: SideState;
  /** 12 格队伍（前 6 出战 / 后 6 备战）；null 为空位 —— 单一事实源在 core */
  team: Array<TeamSlot | null>;
}

export interface TeamSlot {
  id: number;
  name: string;
  comboName?: string;
  hp: number;
  maxHp: number;
  atk: number;
  spd: number;
}

export const TEAM_SIZE = 12;
export const ACTIVE_SIZE = 6;
export const emptyTeam = (): Array<TeamSlot | null> =>
  Array.from({ length: TEAM_SIZE }, () => null);

export type Listener = (s: Readonly<GameState>) => void;

/** 事件总线 + 状态容器：UI 与游戏层都只通过它读写 */
export class GameStore {
  private state: GameState;
  private listeners = new Set<Listener>();

  constructor(init: GameState) {
    this.state = init;
  }

  get(): Readonly<GameState> {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  /** 示例规则：扣血（真实规则后续从数据表驱动） */
  damage(side: Side, amount: number) {
    const s = this.state[side];
    s.hp = Math.max(0, s.hp - Math.max(0, Math.round(amount)));
    this.emit();
  }

  nextTurn() {
    this.state.turn += 1;
    this.emit();
  }

  // ===== 本机追加 2026-10-27 BEGIN =====
  /** 队伍操作：已在队伍则移除，否则填入第一个空位（纯状态变更） */
  selectPet(slot: TeamSlot): boolean {
    const team = this.state.team;
    const existing = team.findIndex((t) => t && t.id === slot.id);
    if (existing >= 0) {
      team[existing] = null;
      this.syncActiveFromTeam();
      this.emit();
      return true;
    }
    const free = team.findIndex((t) => !t);
    if (free < 0) return false;
    team[free] = slot;
    this.syncActiveFromTeam();
    this.emit();
    return true;
  }

  clearTeam() {
    this.state.team = emptyTeam();
    this.syncActiveFromTeam();
    this.emit();
  }

  /** 出战位第 1 只同步为对战首发（表现层只读） */
  private syncActiveFromTeam() {
    const first = this.state.team[0];
    this.state.me = first
      ? { name: first.name, hp: first.hp, maxHp: first.maxHp }
      : { name: '空队伍', hp: 0, maxHp: 1 };
  }
  // ===== 本机追加 2026-10-27 END =====
  // ===== 本机追加 2026-10-27 战斗快照 BEGIN =====
  publishBattle(state: GameState) {
    this.state = state;
    this.emit();
  }
  // ===== 本机追加 2026-10-27 战斗快照 END =====
}
