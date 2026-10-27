/* P1：从旧 web/js/battle.js 抽出的纯计算层（不依赖 DOM / Phaser / React）
 * 与旧实现的差值由 test/formula.compare.ts 逐项比对。
 */

export type StatKey = 'hp' | 'atk' | 'def' | 'spAtk' | 'spDef' | 'spd';

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spAtk: number;
  spDef: number;
  spd: number;
}

export interface Nature {
  attributes?: Record<string, number> & { percent?: boolean };
}

export interface StatOptions {
  level?: number;
  iv?: number;
  ev?: Partial<Record<string, number>>;
  nature?: Nature | null;
  bonus?: Partial<Stats>;
  bonusPct?: Partial<Stats>;
}

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const clampStage = (n: number): number => Math.max(-6, Math.min(6, n | 0));

/** 能力等级倍率（-6 ~ +6，与原作阶梯一致） */
export const stageMul = (stage: number): number => {
  const s = clampStage(stage);
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
};

/** 等级 / 天赋 / 学习力 / 性格 → 面板数值 */
export function computeStats(pet: { base_stats?: Record<string, number> }, opts: StatOptions = {}): Stats {
  const level = opts.level || 100;
  const iv = opts.iv == null ? 31 : opts.iv;
  const ev = opts.ev || {};
  const nature = opts.nature || null;
  const bonus = opts.bonus || {};
  const bonusPct = opts.bonusPct || {};
  const b = pet.base_stats || {};

  const baseOf = (k: string) => num(b[k]);
  const evOf = (k: string) => Math.max(0, Math.min(255, num((ev as Record<string, number>)[k])));
  const natureMul = (k: string) => {
    if (!nature || !nature.attributes) return 1;
    const attrs = nature.attributes as Record<string, unknown>;
    const raw = attrs[k];
    if (raw == null) return 1;
    if (attrs.percent) return 1 + num(raw) / 100;
    return 1 + num(raw);
  };

  let hp = Math.floor((2 * baseOf('hp') + iv + Math.floor(evOf('hp') / 4)) * level / 100) + level + 10;
  hp = Math.floor((hp + num(bonus.hp)) * (1 + num(bonusPct.hp) / 100));

  const other = (k: string): number => {
    let raw = Math.floor((2 * baseOf(k) + iv + Math.floor(evOf(k) / 4)) * level / 100) + 5;
    raw = Math.floor(raw * natureMul(k)) + num((bonus as Record<string, number>)[k]);
    return Math.max(1, Math.floor(raw * (1 + num((bonusPct as Record<string, number>)[k]) / 100)));
  };

  return {
    hp: Math.max(1, hp),
    atk: other('atk'),
    def: other('def'),
    spAtk: other('sp_atk'),
    spDef: other('sp_def'),
    spd: other('spd')
  };
}

/** 属性表 → chart[攻击属性 id][防御属性 id] = 倍率 */
export function buildChart(types: Array<{ id: number; relations?: Array<{ target_type?: { id?: number }; multiple?: number }> }>): Record<number, Record<number, number>> {
  const chart: Record<number, Record<number, number>> = {};
  for (const t of types || []) {
    const m: Record<number, number> = {};
    for (const r of t.relations || []) {
      if (r && r.target_type && r.target_type.id != null) m[r.target_type.id] = num(r.multiple);
    }
    chart[t.id] = m;
  }
  return chart;
}

export function comboElements(combo: { primary?: { id?: number }; secondary?: { id?: number } } | null | undefined): number[] {
  if (!combo) return [];
  const out: number[] = [];
  if (combo.primary && combo.primary.id != null) out.push(combo.primary.id);
  if (combo.secondary && combo.secondary.id != null) out.push(combo.secondary.id);
  return out;
}

/** 连乘口径（旧 Web 金标准） */
export function effectiveness(chart: Record<number, Record<number, number>>, atkElems: number[], defElems: number[]): number {
  if (!atkElems || !atkElems.length || !defElems || !defElems.length) return 1;
  let mul = 1;
  for (const a of atkElems) {
    const row = chart[a] || {};
    for (const d of defElems) {
      const v = row[d];
      mul *= v == null ? 1 : v;
    }
  }
  return mul;
}

export interface DamageActor {
  level?: number;
  stats: Stats;
  stages: Record<string, number>;
  status?: { id: string } | null;
  critBonus?: number;
  critBuffTurns?: number;
  critTimed?: { turns: number; add: number } | null;
  dealtMul?: number;
  critDamage?: number;
  firstDealt?: number;
  takenMul?: number;
}

export interface DamageInput {
  actor: DamageActor;
  target: DamageActor;
  skill: { power?: number; category?: { id?: number }; crit_rate?: number };
  skillCombo?: { primary?: { id?: number }; secondary?: { id?: number } } | null;
  actorCombo?: { primary?: { id?: number }; secondary?: { id?: number } } | null;
  targetCombo?: { primary?: { id?: number }; secondary?: { id?: number } } | null;
  chart: Record<number, Record<number, number>>;
  rng?: () => number;
  level?: number;
  powerOverride?: number;
  powerMul?: number;
  forceCrit?: boolean;
  critAdd?: number;
  isFirst?: boolean;
  minDamage?: number;
  ignoreDefPct?: number;
  ignoreDefUp?: boolean;
}

export interface DamageResult {
  damage: number;
  effectiveness: number;
  crit: boolean;
  stab: boolean;
}

/** 伤害公式（对齐旧实现的主路径；未接的魂印/套装钩子以可选字段参与） */
export function calcDamage(o: DamageInput): DamageResult {
  const { actor, target, skill } = o;
  const level = o.level || actor.level || 100;
  const power = o.powerOverride != null ? num(o.powerOverride) : num(skill.power);
  if (power <= 0) return { damage: 0, effectiveness: 1, crit: false, stab: false };

  const special = (skill.category ? skill.category.id : 1) === 2;
  const atkKey = special ? 'spAtk' : 'atk';
  const defKey = special ? 'spDef' : 'def';

  const A = actor.stats[atkKey] * stageMul(actor.stages[atkKey]);
  let defStage = target.stages[defKey] || 0;
  if (o.ignoreDefUp && defStage > 0) defStage = 0;
  let D = target.stats[defKey] * stageMul(defStage);
  if (o.ignoreDefPct) D *= 1 - o.ignoreDefPct / 100;
  if (D <= 0) D = 1;

  const baseDmg = Math.floor(Math.floor(Math.floor((2 * level) / 5 + 2) * power * A / D) / 50) + 2;

  const skillElems = comboElements(o.skillCombo);
  const actorElems = comboElements(o.actorCombo);
  const targetElems = comboElements(o.targetCombo);

  let stab = 1;
  for (const e of skillElems) {
    if (actorElems.indexOf(e) >= 0) { stab = 1.5; break; }
  }

  const eff = effectiveness(o.chart, skillElems, targetElems);

  let critRate = skill.crit_rate == null ? 6.25 : num(skill.crit_rate);
  critRate += actor.critBonus || 0;
  critRate += o.critAdd || 0;
  if ((actor.critBuffTurns || 0) > 0) critRate = 100;
  if (actor.critTimed && actor.critTimed.turns > 0) critRate += actor.critTimed.add;
  const crit = !!o.forceCrit || (o.rng ? o.rng() : Math.random()) * 100 < critRate;

  const rand = 0.85 + (o.rng ? o.rng() : Math.random()) * 0.15;

  let dmg = baseDmg * stab * eff * (crit ? 1.5 : 1) * rand * (o.powerMul || 1);
  if (actor.dealtMul) dmg *= actor.dealtMul;
  if (crit && actor.critDamage) dmg *= actor.critDamage;
  if (o.isFirst && actor.firstDealt) dmg *= actor.firstDealt;
  if (target.takenMul) dmg *= target.takenMul;
  if (actor.status && actor.status.id === 'burn' && !special) dmg *= 0.5;

  if (eff === 0) dmg = 0;
  dmg = Math.max(eff === 0 ? 0 : 1, Math.floor(dmg));
  if (o.minDamage && dmg > 0) dmg = Math.max(dmg, o.minDamage);

  return { damage: dmg, effectiveness: eff, crit, stab: stab > 1 };
}
