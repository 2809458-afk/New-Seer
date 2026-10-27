/* P2 组合解析：结构拆分（compose.ts）+ 规则表逐段解析 + 条件标记
 * 只在所有段都能被规则表解析时返回结果，避免「解析一半」产生错误效果。
 */
import { splitCompound, type Segment } from './compose';
import { parseRuleList } from './rules';
import type { EffectRule } from './effects';

export interface CondTag {
  type: 'targetStatus' | 'clearSuccess' | 'elseBranch';
  status?: string;
}

const STATUS_WORD: Record<string, string> = {
  中毒: 'poison', 烧伤: 'burn', 冻伤: 'frost', 麻痹: 'paralyze',
  睡眠: 'sleep', 害怕: 'fear', 疲惫: 'tired'
};

/** 「对手中毒」这类条件原文 → 结构化条件 */
export function parseCondText(cond?: string): CondTag | null {
  if (!cond) return null;
  if (cond === '未触发') return { type: 'elseBranch' };
  if (cond === '消除成功') return { type: 'clearSuccess' };
  const m = /^(?:对手|对方)(中毒|烧伤|冻伤|麻痹|睡眠|害怕|疲惫)$/.exec(cond.trim());
  if (m) return { type: 'targetStatus', status: STATUS_WORD[m[1]] };
  return null;
}

function tagOf(seg: Segment): CondTag | null {
  return parseCondText(seg.cond);
}

/** 解析一条复合句；任一段无法解析则整体返回 null（交回旧解析器） */
export function parseComposite(text: string): EffectRule[] | null {
  const segs = splitCompound(text);
  if (!segs.length) return null;

  const out: EffectRule[] = [];
  for (const seg of segs) {
    const fx = parseRuleList(seg.text);
    if (!fx) return null; // 有段未覆盖 → 整体不接管
    const tag = tagOf(seg);
    if (seg.branch === 'main') {
      out.push(...fx);
    } else if (tag?.type === 'clearSuccess') {
      out.push(...fx.map((entry) => ({ ...entry, req: tag } as EffectRule)));
    } else {
      return null; // 有条件但条件不认识 → 不接管
    }
  }
  return out;
}
