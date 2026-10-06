import type { EntryRow } from './types'
import { HISTORICAL_ROSTERS, parseRoster, stringifyRoster } from './training-roster'
import { resolveStage } from './workflow'

/**
 * 本地数据带版本号，结构变更靠迁移函数把老批次带到最新版本，
 * 而不是直接丢掉浏览器里的历史数据。
 */
export type StoreEnvelope = {
  version: number
  entries: Record<string, EntryRow[]>
}

export const CURRENT_VERSION = 2

/** 参训人数是否缺失或无法采信：非有限数字（占位文本、空串）都算缺。 */
function isInvalidCount(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value)
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return !Number.isFinite(Number(value.trim()))
  }
  return true
}

/** 考核通过率串是否是可信数值；占位文本视为尚未考核。 */
function numericOrEmpty(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim())
  }
  return ''
}

/**
 * v1 -> v2：
 * 1. 群测群防培训按报名名单迁移缺参训人数的历史批次（含空名单批次，名单保持为空以阻止授课）；
 * 2. 补齐报名名单、考核结论字段，清理占位通过率；
 * 3. 培训状态/活动状态与链路状态对齐；
 * 4. 培训与防灾宣传的待办位改由唯一动作链的阶段结果推导。
 */
export function migrateV1ToV2(entries: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = structuredCloneSafe(entries)

  if (Array.isArray(next.training)) {
    next.training = next.training.map((row) => {
      const code = String(row['培训编号'] ?? '')
      const migrated: EntryRow = { ...row }

      // 报名名单：历史批次一律从登记表补齐（含空名单批次）。
      const existingRoster = parseRoster(migrated['报名名单'])
      const historical = HISTORICAL_ROSTERS[code]
      let roster = existingRoster
      if (existingRoster.length === 0 && Array.isArray(historical)) {
        roster = historical
      }
      migrated['报名名单'] = stringifyRoster(roster)

      // 缺参训人数：按报名名单迁移，人数取名单人数；空名单迁移为 0。
      if (isInvalidCount(migrated['参训人数'])) {
        migrated['参训人数'] = roster.length
      }

      // 通过率占位文本视为未考核；考核结论列补齐。
      migrated['考核通过率'] = numericOrEmpty(migrated['考核通过率'])
      if (migrated['考核结论'] === undefined) {
        migrated['考核结论'] = ''
      }

      // 业务状态列与唯一状态对齐。
      migrated['培训状态'] = String(migrated.status)

      // 待办位改由阶段结果统一裁决。
      migrated.pending = resolveStage('training', migrated).pending
      return migrated
    })
  }

  if (Array.isArray(next.propaganda)) {
    next.propaganda = next.propaganda.map((row) => {
      const migrated: EntryRow = { ...row, '活动状态': String(row.status) }
      migrated.pending = resolveStage('propaganda', migrated).pending
      return migrated
    })
  }

  return next
}

/** v2 种子数据兜底：保证字段完整（新种子本身已是 v2，这里只做幂等修补）。 */
function normalizeV2(entries: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = structuredCloneSafe(entries)
  if (Array.isArray(next.training)) {
    next.training = next.training.map((row) => {
      const migrated: EntryRow = { ...row }
      if (migrated['报名名单'] === undefined) {
        const historical = HISTORICAL_ROSTERS[String(migrated['培训编号'] ?? '')] ?? []
        migrated['报名名单'] = stringifyRoster(historical)
      }
      if (migrated['考核结论'] === undefined) {
        migrated['考核结论'] = ''
      }
      migrated['培训状态'] = String(migrated.status)
      migrated.pending = resolveStage('training', migrated).pending
      return migrated
    })
  }
  if (Array.isArray(next.propaganda)) {
    next.propaganda = next.propaganda.map((row) => ({
      ...row,
      '活动状态': String(row.status),
      pending: resolveStage('propaganda', { status: String(row.status) }).pending,
    }))
  }
  return next
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 迁移入口：老结构（裸 Record，v1）与各版本信封都收敛到最新版本。
 * 任何一步失败都抛出，由存储层决定回退，绝不能只迁一半。
 */
export function migrate(raw: unknown, seed: Record<string, EntryRow[]>): StoreEnvelope {
  // 裸数据：首批版本未带版本号，按 v1 处理。
  const envelope: StoreEnvelope =
    raw && typeof raw === 'object' && 'version' in raw && 'entries' in raw
      ? {
          version: Number((raw as StoreEnvelope).version) || 1,
          entries: structuredCloneSafe((raw as StoreEnvelope).entries),
        }
      : { version: 1, entries: structuredCloneSafe((raw as Record<string, EntryRow[]>) ?? {}) }

  if (envelope.version > CURRENT_VERSION) {
    throw new Error(`本地数据版本 ${envelope.version} 高于当前版本 ${CURRENT_VERSION}，拒绝处理以免只改一边`)
  }

  if (envelope.version < 2) {
    envelope.entries = migrateV1ToV2(envelope.entries)
    envelope.version = 2
  }
  envelope.entries = normalizeV2(envelope.entries)

  // 任何未登记模块缺失时用种子补齐，保证迁移结果完整。
  for (const key of Object.keys(seed)) {
    if (!Array.isArray(envelope.entries[key])) {
      envelope.entries[key] = structuredCloneSafe(seed[key])
    }
  }
  return envelope
}
