/* P2 组合层：把复合句式拆成「主效果 / 条件效果」两段
 *
 * 覆盖度量显示，未命中的高频样本几乎都是复合句：
 *   「X，未触发则 Y」「X，则 Y」「X，消除成功则 Y」「若 C，则 Y」
 * 拆段是数据表化的前置步骤（旧解析器在 parseOneEffect 里做同样的事）。
 */

export type Branch = 'main' | 'else' | 'then' | 'cond';

export interface Segment {
  branch: Branch;
  text: string;
  /** 触发条件的原文（如「若对手中毒」「消除成功」） */
  cond?: string;
}

const ELSE_MARK = /^(.+?)[，,]\s*未触发则(.+)$/;
const CLEAR_MARK = /^(.+?)[，,]\s*消除成功则(.+)$/;
const IF_MARK = /^若(.+?)[，,]\s*(?:则)?\s*(.+)$/;

/** 只做结构拆分，不做语义解释（语义交给规则表逐段处理） */
export function splitCompound(text: string): Segment[] {
  const t = String(text || '').trim();
  if (!t) return [];

  let m = IF_MARK.exec(t);
  if (m) {
    return [
      { branch: 'cond', text: m[2].trim(), cond: m[1].trim() },
      // 「若…则…」没有主段，cond 段自带条件
    ];
  }

  m = ELSE_MARK.exec(t);
  if (m) {
    return [
      { branch: 'main', text: m[1].trim() },
      { branch: 'else', text: m[2].trim(), cond: '未触发' }
    ];
  }

  m = CLEAR_MARK.exec(t);
  if (m) {
    return [
      { branch: 'main', text: m[1].trim() },
      { branch: 'then', text: m[2].trim(), cond: '消除成功' }
    ];
  }

  return [{ branch: 'main', text: t }];
}
