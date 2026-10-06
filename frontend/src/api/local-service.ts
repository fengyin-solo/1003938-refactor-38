import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionInput, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { judgeExam, nextStage, resolveStage, WORKFLOWS } from '@/data/workflow'
import { parseRoster } from '@/data/training-roster'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

/** 业务状态列名：培训/宣传的页面字段里各有一个与链路状态同步的状态列，写入时同一次事务一起改。 */
const STATUS_FIELD: Record<string, string> = {
  training: '培训状态',
  propaganda: '活动状态',
}

/**
 * 培训专属守卫：
 * - 开始授课前必须有报名名单，空名单明确阻止后续授课；
 * - 组织考核必须给出可信通过率，并保留人工考核高于自动通过率的裁决。
 * 返回 null 表示通过；返回 ActionResult 表示拦截。
 */
function validateTrainingAction(
  action: string,
  row: EntryRow,
  input: ActionInput,
): { patch?: Partial<EntryRow>; result?: ActionResult } | null {
  if (action === '开始授课') {
    const roster = parseRoster(row['报名名单'])
    if (roster.length === 0) {
      return {
        result: {
          ok: false,
          message: '报名名单为空，不能开始授课；请先补登参训人员名单',
        },
      }
    }
    return null
  }

  if (action === '组织考核') {
    const passRate = Number(input.passRate)
    if (!Number.isFinite(passRate) || passRate < 0 || passRate > 100) {
      return { result: { ok: false, message: '请先录入 0-100 之间的考核通过率，再提交考核裁决' } }
    }
    const verdict = judgeExam(passRate, input.manualVerdict)
    return {
      patch: {
        考核通过率: Math.round(passRate * 100) / 100,
        考核结论: verdict.finalVerdict,
        自动裁决: verdict.autoVerdict,
        人工裁决: input.manualVerdict === '合格' || input.manualVerdict === '不合格' ? input.manualVerdict : '',
      },
    }
  }

  // 完成授课、归档等动作没有额外入参，阶段校验通过即可。
  return null
}

export function runAction(key: string, id: number, action: string, input: ActionInput = {}): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)

  let target: string | null = null
  let patch: Partial<EntryRow> = {}

  if (WORKFLOWS[key]) {
    // 唯一动作链：列表、授课、考核、归档入口共用的阶段裁决。
    const stage = resolveStage(key, row)
    if (stage.isTerminal) {
      return {
        ok: false,
        message: `${meta.entity}已「${current}」（终态），不能重新授课或执行其他动作`,
      }
    }
    target = nextStage(key, row, action)
    if (target === null) {
      const reason = stage.actions.length
        ? `当前阶段「${current}」只能执行：${stage.actions.join('、')}`
        : `当前阶段「${current}」不开放任何动作`
      return { ok: false, message: `${meta.entity}${reason}，不能「${action}」` }
    }

    // 动作确属当前阶段后，再做该动作的专属守卫（空名单、考核入参等），避免守卫越权拦截其他阶段。
    if (key === 'training') {
      const guard = validateTrainingAction(action, row, input)
      if (guard?.result) {
        return guard.result
      }
      if (guard?.patch) {
        patch = guard.patch
      }
    }
  } else {
    target = meta.actionTargets[action] ?? null
    if (!target) {
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
    }
    if (current === target) {
      return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
    }
  }

  // 先在快照上完成全部字段变更，最后只调用一次 saveRows：任一步校验失败都不会落盘，
  // 冲突或失败时不可能只改一边（状态/待办/业务状态列始终同一次事务提交）。
  const workflow = WORKFLOWS[key]
  const isNegative = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  // 「取消」等正交终态动作同样视为异常办结，需要在看板上看出来。
  const isExtraTerminal = workflow ? workflow.extraTerminal.includes(target) : false
  const stageAfter = workflow ? resolveStage(key, { status: target }) : null
  const updated: EntryRow = {
    ...row,
    ...patch,
    status: target,
    pending: stageAfter ? stageAfter.pending : target !== meta.statuses[meta.statuses.length - 1],
    abnormal: isNegative || isExtraTerminal ? true : row.abnormal,
  }
  const statusField = STATUS_FIELD[key]
  if (statusField) {
    updated[statusField] = target
  }

  try {
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
  } catch (error) {
    // 落盘失败：内存缓存由 saveRows 保证未改，这里显式返回失败，调用方不得当作成功。
    return {
      ok: false,
      message: `「${action}」提交失败，状态未变更：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }

  return { ok: true, message: `${meta.entity}已${action}，当前阶段「${target}」` }
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
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
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
