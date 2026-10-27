/* P2 起点：JSON 数据表 → TS 类型（不依赖 DOM / Phaser / React）
 * 表放在仓库 data/ 与 web/data/，这里只做类型与校验，不内联硬编码。
 */

export interface Combo {
  id: number;
  name: string;
  primary: { id: number } | null;
  secondary: { id: number } | null;
}

export interface Mintmark {
  id: number;
  name: string;
  desc?: string;
  attr?: Record<string, number | string | null> | null;
  skill?: unknown;
}

export interface Grade {
  id: number;
  grade?: string;
  [k: string]: unknown;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 数据包信封：{schema, kind, count, items:[...]}；也接受裸数组 */
export function unwrapItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isObj(raw) && Array.isArray(raw.items)) return raw.items;
  return [];
}

/** primary/secondary 允许是数字 id 或 {id} */
const asId = (v: unknown): { id: number } | null => {
  if (typeof v === 'number') return { id: v };
  if (isObj(v) && typeof v.id === 'number') return { id: v.id };
  return null;
};

function collect<T>(rows: unknown[], label: string, build: (r: Record<string, unknown>, i: number, errs: string[]) => T | null): ValidationResult<T[]> {
  const value: T[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!isObj(r)) { errors.push(`${label}[${i}] 不是对象`); return; }
    const built = build(r, i, errors);
    if (built) value.push(built);
  });
  return { ok: errors.length === 0, value, errors };
}

export function parseCombos(raw: unknown): ValidationResult<Combo[]> {
  const rows = unwrapItems(raw);
  return collect<Combo>(rows, 'combo', (r, i, errs) => {
    if (typeof r.id !== 'number') { errs.push(`combo[${i}].id 缺失`); return null; }
    if (typeof r.name !== 'string') { errs.push(`combo[${i}].name 缺失`); return null; }
    return { id: r.id, name: r.name, primary: asId(r.primary), secondary: asId(r.secondary) };
  });
}

export function parseMintmarks(raw: unknown): ValidationResult<Mintmark[]> {
  const rows = unwrapItems(raw);
  return collect<Mintmark>(rows, 'mintmark', (r, i, errs) => {
    if (typeof r.id !== 'number') { errs.push(`mintmark[${i}].id 缺失`); return null; }
    if (typeof r.name !== 'string') { errs.push(`mintmark[${i}].name 缺失`); return null; }
    return {
      id: r.id,
      name: r.name,
      desc: typeof r.desc === 'string' ? r.desc : undefined,
      attr: isObj(r.attr) ? (r.attr as Mintmark['attr']) : null,
      skill: r.skill ?? undefined
    };
  });
}

export function parseGrades(raw: unknown): ValidationResult<Grade[]> {
  const rows = Array.isArray(raw) ? raw : isObj(raw) ? Object.values(raw) : [];
  return collect<Grade>(rows, 'grade', (r, i, errs) => {
    if (typeof r.id !== 'number' && typeof r.pet !== 'number') {
      errs.push(`grade[${i}] 缺少 id/pet`);
      return null;
    }
    const id = typeof r.id === 'number' ? r.id : (r.pet as number);
    return { ...(r as object), id } as Grade;
  });
}
