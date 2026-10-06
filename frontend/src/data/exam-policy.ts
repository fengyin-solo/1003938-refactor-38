import type { RosterMember } from './types'

/** 自动考核规则：个人成绩达到该分数线视为及格。 */
export const EXAM_PASS_SCORE = 60
/** 自动考核规则：整体通过率达到该比例（含）自动判定合格。 */
export const AUTO_PASS_RATE = 80

export type ExamVerdict = {
  /** 自动通过率：及格人数 / 应考人数，取值 0~100，保留整数。 */
  passRate: number
  /** 自动考核结论。 */
  automatic: '合格' | '不合格'
  /** 最终结论。 */
  final: '合格' | '不合格'
  /** 最终结论的裁决来源：人工裁决优先于自动通过率。 */
  source: '自动通过率' | '人工裁决'
}

/**
 * 依据报名名单成绩与人工意见计算考核结论。
 *
 * 裁决顺序：只要给出了人工裁决意见，最终结论以人工裁决为准；
 * 未给出人工意见时，才按自动通过率（个人及格线 60 分、批次合格率 80%）判定。
 */
export function settleExam(
  roster: RosterMember[],
  manual: '合格' | '不合格' | undefined,
): ExamVerdict {
  const total = roster.length
  const passed = roster.filter((member) => typeof member.成绩 === 'number' && member.成绩 >= EXAM_PASS_SCORE).length
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 100)
  const automatic: ExamVerdict['automatic'] = passRate >= AUTO_PASS_RATE ? '合格' : '不合格'
  if (manual) {
    return { passRate, automatic, final: manual, source: '人工裁决' }
  }
  return { passRate, automatic, final: automatic, source: '自动通过率' }
}
