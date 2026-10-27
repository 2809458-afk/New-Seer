/* P3 数据接入：从仓库 data/ 读真实数据包（pets / combos / types / suits）
 * 只用 Vite 的 JSON 导入，不引入运行时网络请求。
 */
import { unwrapItems, parseCombos, type Combo } from './tables';
import { computeStats, type Stats } from '../core/formula';
import type { EffectRule } from './effects';

export interface PackPet {
  id: number;
  name: string;
  /** 数据包字段名是 stats（不是 base_stats） */
  stats?: Record<string, number>;
  /** 数据包里 type 是属性组合 id（数字），不是 {id} 对象 */
  type?: number | null;
  skills?: Array<{ id: number; level: number }>;
  fifth?: number[];
  soulmarks?: number[];
}

export interface PackSkill {
  id: number; name: string; power: number; pp: number; accuracy?: number;
  crit_rate?: number; priority?: number; must_hit?: boolean; category: number;
  type: number; info?: string; effects?: unknown[];
}

export interface Pack {
  pets: PackPet[];
  combos: Combo[];
  types: Array<{ id: number; name: string; relations: Array<{ target: number; multiple: number }> }>;
  skills: PackSkill[];
  soulmarks: Array<{ id: number; name?: string; desc: string }>;
  skillEffects?: Record<string, EffectRule[]>;
}

/** 运行时外置数据，hash 作版本键，校验失败明确提示修复。 */
export async function loadPack(): Promise<Pack> {
  const response = await fetch('/data-manifest.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('数据清单加载失败');
  const manifest: { items: Record<string, { url: string; contentHash: string }> } = await response.json();
  const names = ['pets', 'combos', 'types', 'skills', 'soulmarks', 'skillEffects'];
  const raw = await Promise.all(names.map(async (name) => {
    const entry = manifest.items[name];
    if (!entry) throw new Error(`数据清单缺少 ${name}`);
    const response = await fetch(`${entry.url}?v=${entry.contentHash}`);
    if (!response.ok) throw new Error(`数据加载失败：${name}`);
    const buffer = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
      (b) => b.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.contentHash) throw new Error(`数据校验失败：${name}，请重新生成清单`);
    return JSON.parse(new TextDecoder().decode(buffer));
  }));
  return {
    pets: unwrapItems(raw[0]) as unknown as PackPet[],
    combos: parseCombos(raw[1]).value,
    types: unwrapItems(raw[2]) as unknown as Pack['types'],
    skills: unwrapItems(raw[3]) as unknown as PackSkill[],
    soulmarks: unwrapItems(raw[4]) as unknown as Pack['soulmarks'],
    skillEffects: raw[5].items as Pack['skillEffects']
  };
}

/** 某只精灵在 Lv100 / 天赋31 下的面板 */
export function statsOf(pet: PackPet): Stats {
  return computeStats(
    { base_stats: (pet.stats || {}) as Record<string, number> },
    { level: 100, iv: 31 }
  );
}

/** 组合名（单/双属性） */
export function comboNameOf(pack: Pack, comboId?: number | null): string {
  if (!comboId) return '';
  const c = pack.combos.find((x) => x.id === comboId);
  return c ? c.name : '';
}
