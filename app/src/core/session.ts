import engine from './engine';
import type { Pack, PackPet } from '../data/pack';
import { GameStore, ACTIVE_SIZE, type GameState } from './store';

export type BattleAction = { type: 'skill' | 'switch'; index: number } | { type: 'pass' };
export interface CombatantView {
  id: number; name: string; hp: number; maxHp: number; alive: boolean; exiled: boolean;
  status: { id: string; name: string; turns: number } | null;
  skills: Array<{ id: number; name: string; pp: number; maxPp: number; power: number }>;
}
export interface BattleView {
  turn: number; over: boolean; winner: string | null; needPlayerSwitch: boolean;
  me: { active: number; team: CombatantView[] };
  foe: { active: number; team: CombatantView[] };
}
export interface BattleEvent { type: 'log'; text: string }

export function seededRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function battleConfig(pack: Pack, mePets: PackPet[], foePets: PackPet[], rng: () => number) {
  const skills = new Map(pack.skills.map((s) => [s.id, s]));
  const marks = new Map(pack.soulmarks.map((m) => [m.id, m]));
  const comboOf = (id: number) => pack.combos.find((c) => c.id === id) || null;
  const entry = (pet: PackPet) => {
    const chosen = [...new Set([...(pet.skills || []).map((s) => s.id), ...(pet.fifth || [])])]
      .map((id) => skills.get(id)).filter((s) => s != null).slice(-5);
    if (!chosen.length) throw new Error(`${pet.name} 没有可用技能`);
    const soulmarks = (pet.soulmarks || []).filter((id) => !engine.soulmarkDisabled(pet.id, id))
      .map((id) => marks.get(id)).filter((m) => m != null);
    return {
      pet: { id: pet.id, name: pet.name, base_stats: { ...pet.stats } },
      combo: comboOf(pet.type || 0),
      skills: chosen.map((s) => {
        const skill = { ...s, max_pp: s.pp, category: { id: s.category }, type: { id: s.type } };
        const compiled = pack.skillEffects;
        return { ...skill, _fx: structuredClone(compiled?.[String(s.id)] ?? engine.parseSkillEffects(skill)) };
      }),
      soulmarks, passives: soulmarks.flatMap((m) => engine.parseSoulmark(m.desc || ''))
    };
  };
  return {
    rng, level: 100, comboOf, typeByName: Object.fromEntries(pack.types.map((t) => [t.name, t.id])),
    chart: engine.buildChart(pack.types.map((t) => ({ ...t,
      relations: t.relations.map((r) => ({ target_type: { id: r.target }, multiple: r.multiple }))
    }))),
    meTeam: mePets.map(entry), foeTeam: foePets.map(entry)
  };
}

/** 结算同步完成，UI/Phaser 只消费快照与事件。所有随机性由种子注入。 */
export class BattleSession {
  private battle: any;
  constructor(private pack: Pack, private store: GameStore) {}

  start(seed = 7919): BattleView {
    const selected = this.store.get().team.slice(0, ACTIVE_SIZE).filter((s) => s != null);
    if (!selected.length) throw new Error('请先选择至少一只出战精灵');
    const pets = selected.map((s) => this.pack.pets.find((p) => p.id === s.id)!);
    const foePets = this.pack.pets.filter((p) => !selected.some((s) => s.id === p.id) && p.skills?.length)
      .slice(0, pets.length);
    this.battle = new engine.Battle(battleConfig(this.pack, pets, foePets, seededRng(seed)));
    this.publish();
    return this.snapshot();
  }

  settle(action: BattleAction): BattleEvent[] {
    if (!this.battle || this.battle.over) return [];
    const before = this.battle.log.length;
    if (this.battle.needPlayerSwitch && action.type === 'switch') this.battle.playerSwitch(action.index);
    else this.battle.step(action);
    this.publish();
    return this.battle.log.slice(before).map((text: string) => ({ type: 'log', text }));
  }

  snapshot(): BattleView { return this.battle.snapshot(); }
  logs(): string[] { return this.battle ? [...this.battle.log] : []; }

  private publish() {
    const view = this.snapshot();
    const current = this.store.get() as GameState;
    const side = (key: 'me' | 'foe') => {
      const pet = view[key].team[view[key].active];
      return { name: pet.name, hp: pet.hp, maxHp: pet.maxHp };
    };
    this.store.publishBattle({ ...current, turn: view.turn, me: side('me'), foe: side('foe') });
  }
}
