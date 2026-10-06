import type { EntryRow } from './types'

/**
 * 唯一动作链：列表可执行动作、授课入口、考核入口、归档入口都从同一份链路推导，
 * 不再各自判断阶段。链路按 stages 顺序线性推进，每个阶段登记该阶段允许执行的动作。
 */
export type WorkflowDef = {
  /** 终态：到达后没有任何可执行动作，待办同时清零。 */
  terminal: string
  /** 与主链正交的其他终态（如宣传「已取消」）：无动作、无待办、无归档。 */
  extraTerminal: string[]
  /** 阶段顺序，前一个阶段的动作把记录推向下一个阶段。 */
  stages: { status: string; actions: string[] }[]
  /** 动作 -> 目标阶段，必须落在链路相邻的下一个阶段。 */
  nextByAction: Record<string, string>
}

/** 某条记录在唯一动作链上裁决出的阶段结果，待办与各入口共用它。 */
export type StageResult = {
  status: string
  /** 当前阶段允许执行的动作：列表、授课、考核、归档入口都以它为准。 */
  actions: string[]
  /** 是否终态（如已归档/已结业）：无后续动作。 */
  isTerminal: boolean
  /** 是否有待办：非终态即待办，防灾宣传待办与归档入口共用这一结果。 */
  pending: boolean
  /** 当前阶段是否开放归档入口。 */
  canArchive: boolean
}

// 群测群防培训：待开展 →（开始授课）→ 授课中 →（完成授课）→ 已完成
//           →（组织考核）→ 已考核 →（归档）→ 已归档
// 空名单不得开始授课（守卫在 local-service 的培训专属校验里）。
export const TRAINING_WORKFLOW: WorkflowDef = {
  terminal: '已归档',
  extraTerminal: [],
  stages: [
    { status: '待开展', actions: ['开始授课'] },
    { status: '授课中', actions: ['完成授课'] },
    { status: '已完成', actions: ['组织考核'] },
    { status: '已考核', actions: ['归档'] },
    { status: '已归档', actions: [] },
  ],
  nextByAction: {
    开始授课: '授课中',
    完成授课: '已完成',
    组织考核: '已考核',
    归档: '已归档',
  },
}

// 防灾宣传：待开展 →（开展活动）→ 进行中 →（确认完成）→ 已完成 →（归档）→ 已归档。
// 「取消活动」是与链路正交的人工裁决，落「已取消」终态。
export const PROPAGANDA_WORKFLOW: WorkflowDef = {
  terminal: '已归档',
  extraTerminal: ['已取消'],
  stages: [
    { status: '待开展', actions: ['开展活动', '取消活动'] },
    { status: '进行中', actions: ['确认完成', '取消活动'] },
    { status: '已完成', actions: ['归档'] },
    { status: '已归档', actions: [] },
  ],
  nextByAction: {
    开展活动: '进行中',
    确认完成: '已完成',
    归档: '已归档',
  },
}

/** 与唯一动作链正交的人工终止动作：宣传活动取消后不再有任何入口。 */
export const EXTRA_TRANSITIONS: Record<string, Record<string, string>> = {
  propaganda: { 取消活动: '已取消' },
}

export const WORKFLOWS: Record<string, WorkflowDef> = {
  training: TRAINING_WORKFLOW,
  propaganda: PROPAGANDA_WORKFLOW,
}

/** 培训考核：自动通过率与人工裁决的裁决结果。 */
export type ExamVerdict = {
  /** 自动裁决：通过率达到 60% 即合格。 */
  autoVerdict: '合格' | '不合格'
  /** 最终裁决：人工裁决优先于自动通过率；人工选择「不裁决」时回落到自动裁决。 */
  finalVerdict: '合格' | '不合格'
  /** 最终裁决是否来自人工覆盖。 */
  manualOverridden: boolean
}

export const PASS_LINE = 60

/**
 * 培训考核裁决：保留人工考核高于自动通过率的裁决权。
 * 只要人工明确给出「合格/不合格」，最终结果一律以人工为准，哪怕自动通过率达标也能判不合格。
 */
export function judgeExam(passRate: number, manualVerdict?: string): ExamVerdict {
  const autoVerdict = passRate >= PASS_LINE ? '合格' : '不合格'
  const manual = manualVerdict === '合格' || manualVerdict === '不合格' ? manualVerdict : null
  return {
    autoVerdict,
    finalVerdict: manual ?? autoVerdict,
    manualOverridden: manual !== null && manual !== autoVerdict,
  }
}

/**
 * 阶段裁决的唯一入口：列表动作、授课入口、考核入口、归档入口以及待办口径都调它，
 * 保证防灾宣传待办与归档入口拿到的是同一个阶段结果。
 */
export function resolveStage(key: string, row: Pick<EntryRow, 'status'>): StageResult {
  const workflow = WORKFLOWS[key]
  const status = String(row.status)
  if (!workflow) {
    // 未接入唯一动作链的模块保持「无动作」由通用流程处理，这里不拦截。
    return { status, actions: [], isTerminal: false, pending: true, canArchive: false }
  }

  // 正交终态（宣传「已取消」等）：所有入口关闭、待办清零。
  if (status !== workflow.terminal && !workflow.stages.some((stage) => stage.status === status)) {
    const isExtraTerminal = workflow.extraTerminal.includes(status)
    return { status, actions: [], isTerminal: isExtraTerminal, pending: !isExtraTerminal, canArchive: false }
  }

  const stage = workflow.stages.find((item) => item.status === status)
  const isTerminal = status === workflow.terminal
  const actions = stage ? stage.actions : []
  return {
    status,
    actions,
    isTerminal,
    pending: !isTerminal,
    canArchive: actions.includes('归档'),
  }
}

/** 返回动作在唯一动作链上的目标阶段；动作在当前阶段不开放时返回 null。 */
export function nextStage(key: string, row: Pick<EntryRow, 'status'>, action: string): string | null {
  const stage = resolveStage(key, row)
  if (!stage.actions.includes(action)) {
    return null
  }
  // 正交动作（如取消活动）登记在当前阶段但不在线性链路里，优先命中其专属目标。
  const extraTarget = (EXTRA_TRANSITIONS[key] ?? {})[action]
  if (extraTarget) {
    return extraTarget
  }
  return WORKFLOWS[key].nextByAction[action] ?? null
}
