import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitState, getRoster, listRows, resetRows } from '@/data/local-store'
import { settleExam } from '@/data/exam-policy'
import { allowedActions, findTransition, isTerminal } from '@/data/stage-machine'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, RosterMember } from '@/data/types'

// 会写进数据的「取消/驳回」类动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '取消']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 页面按阶段渲染动作按钮时统一从这里取，列表与各业务入口共用同一条动作链。 */
export function availableActionsFor(key: string, status: string): string[] {
  return allowedActions(moduleMeta(key), status)
}

export type TrainingActionPayload = {
  manualVerdict?: '合格' | '不合格'
}

/** 群测群防培训的动作链规则：名单校验、考核裁决、归档与重新授课都在这里收口。 */
function runTrainingAction(id: number, action: string, payload?: TrainingActionPayload): ActionResult {
  const meta = moduleMeta('training')
  let result: ActionResult = { ok: false, message: '' }
  commitState((draft) => {
    const rows = draft.entries.training ?? []
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      result = { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
      return
    }
    const row = rows[index]
    const status = String(row.status)
    const edge = findTransition(meta, status, action)
    if (!edge) {
      if (status === '已归档') {
        result = { ok: false, message: '培训批次已归档，只能通过「重新授课」开启新一轮培训' }
        return
      }
      result = { ok: false, message: `培训记录当前处于「${status}」，不能执行「${action}」` }
      return
    }

    const roster = draft.trainingRosters[id] ?? []

    if (action === '开始授课' || action === '重新授课') {
      // 空名单必须明确阻止后续授课
      if (roster.length === 0) {
        result = { ok: false, message: '报名名单为空，不能开始授课：请先按报名名单补录参训人员' }
        return
      }
    }

    if (action === '组织考核') {
      if (roster.length === 0) {
        result = { ok: false, message: '报名名单为空，不能组织考核' }
        return
      }
      const unscored = roster.filter((member) => typeof member.成绩 !== 'number')
      if (unscored.length > 0) {
        result = { ok: false, message: `还有 ${unscored.length} 名学员未录入考核成绩，不能提交考核` }
        return
      }
      // 人工裁决一旦给出就高于自动通过率
      const verdict = settleExam(roster, payload?.manualVerdict)
      row.考核通过率 = verdict.passRate
      row.考核结论 = `${verdict.final}（${verdict.source}）`
    }

    if (action === '归档' && status === '已完成' && !row.考核结论) {
      // 未考核也允许归档：阶段不回退，只如实记录未考核
      row.考核结论 = '未组织考核（归档）'
    }

    if (action === '重新授课') {
      // 重新开始一轮授课与考核：清空上轮考核结果与成绩，报名名单与参训人数保留
      row.考核通过率 = ''
      row.考核结论 = ''
      draft.trainingRosters[id] = roster.map((member) => ({ ...member, 成绩: '' }))
    }

    row.status = edge.target
    row.培训状态 = edge.target
    row.pending = !isTerminal(meta, edge.target)
    row.abnormal = false
    result = { ok: true, message: `培训记录已${action}，当前阶段「${edge.target}」` }
  })
  return result
}

export function runAction(
  key: string,
  id: number,
  action: string,
  payload?: TrainingActionPayload,
): ActionResult {
  if (key === 'training') {
    return runTrainingAction(id, action, payload)
  }

  const meta = moduleMeta(key)
  const rows = listRows(key)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(row.status)
  const edge = findTransition(meta, current, action)
  if (!edge) {
    if (current === meta.actionTargets[action]) {
      return { ok: false, message: `${meta.entity}已经是「${current}」，不用重复操作` }
    }
    return { ok: false, message: `${meta.entity}当前处于「${current}」，不能执行「${action}」` }
  }

  let outcome: ActionResult = { ok: false, message: '状态提交失败' }
  commitState((draft) => {
    const targetRows = draft.entries[key] ?? []
    const target = targetRows.find((item) => Number(item.id) === id)
    if (!target) {
      return
    }
    target.status = edge.target
    target.pending = !isTerminal(meta, edge.target)
    target.abnormal = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
    outcome = { ok: true, message: `${meta.entity}已${action}，当前状态「${edge.target}」` }
  })
  return outcome
}

export function getTrainingRoster(id: number): RosterMember[] {
  return getRoster(id).map((member) => ({ ...member }))
}

/** 保存报名名单（含成绩录入）：与培训登记数据走同一次原子提交，不会只改一边。 */
export function saveTrainingRoster(id: number, roster: RosterMember[]): ActionResult {
  if (!listRows('training').some((row) => Number(row.id) === id)) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  commitState((draft) => {
    draft.trainingRosters[id] = roster.map((member) => ({ ...member }))
    // 参训人数始终以报名名单为准，两边一次提交
    const row = draft.entries.training.find((item) => Number(item.id) === id)
    if (row) {
      row.参训人数 = roster.length
      row.名单来源 = roster.length === 0 ? '空名单' : '报名名单'
    }
  })
  return { ok: true, message: `报名名单已保存（${roster.length} 人）` }
}

/**
 * 提交考核：成绩保存、裁决落定、阶段推进在同一次提交里完成。
 * 任何校验失败都不会写入，杜绝「成绩改了、阶段没动」的半成品状态。
 */
export function submitTrainingExam(
  id: number,
  roster: RosterMember[],
  manualVerdict?: '合格' | '不合格',
): ActionResult {
  const meta = moduleMeta('training')
  let result: ActionResult = { ok: false, message: '' }
  commitState((draft) => {
    const row = draft.entries.training.find((item) => Number(item.id) === id)
    if (!row) {
      result = { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
      return
    }
    const status = String(row.status)
    const edge = findTransition(meta, status, '组织考核')
    if (!edge) {
      result = { ok: false, message: `培训记录当前处于「${status}」，不能组织考核` }
      return
    }
    if (roster.length === 0) {
      result = { ok: false, message: '报名名单为空，不能组织考核' }
      return
    }
    const unscored = roster.filter((member) => typeof member.成绩 !== 'number')
    if (unscored.length > 0) {
      result = { ok: false, message: `还有 ${unscored.length} 名学员未录入考核成绩，不能提交考核` }
      return
    }
    // 人工裁决一旦给出就高于自动通过率
    const verdict = settleExam(roster, manualVerdict)
    draft.trainingRosters[id] = roster.map((member) => ({ ...member }))
    row.参训人数 = roster.length
    row.名单来源 = '报名名单'
    row.考核通过率 = verdict.passRate
    row.考核结论 = `${verdict.final}（${verdict.source}）`
    row.status = edge.target
    row.pending = !isTerminal(meta, edge.target)
    row.abnormal = false
    result = {
      ok: true,
      message: `考核已提交：自动通过率 ${verdict.passRate}%，最终结论「${verdict.final}」（${verdict.source}）`,
    }
  })
  return result
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((entry) => entry.pending).length,
      abnormal: entries.filter((entry) => entry.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
