import { SEED_ROWS, SEED_TRAINING_ROSTERS } from './seed'
import type { AppState, EntryRow, RosterMember } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 沿用 v1 的存储键：读出来的旧结构由 migrateLegacy 迁移到 v2（含报名名单）。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const STATE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freshState(): AppState {
  return {
    version: STATE_VERSION,
    entries: clone(SEED_ROWS),
    trainingRosters: clone(SEED_TRAINING_ROSTERS),
  }
}

/**
 * 兼容旧版本（v1：只存了 entries）的数据迁移：
 * 旧数据原样保留，并按培训批次补齐报名名单；参训人数以报名名单为准重新对齐。
 */
function migrateLegacy(raw: unknown): AppState {
  if (raw && typeof raw === 'object' && 'entries' in raw) {
    const state = raw as Partial<AppState>
    return {
      version: STATE_VERSION,
      entries: clone(state.entries ?? SEED_ROWS),
      trainingRosters: clone(state.trainingRosters ?? SEED_TRAINING_ROSTERS),
    }
  }
  // v1 结构：Record<string, EntryRow[]>
  const legacyEntries = clone((raw as Record<string, EntryRow[]>) ?? SEED_ROWS)
  const state = freshState()
  state.entries = legacyEntries
  alignTrainingHeadcount(state)
  return state
}

/** 历史批次迁移：按报名名单回填参训人数；名单为空时参训人数只能是 0，并标记来源。 */
export function alignTrainingHeadcount(state: AppState): void {
  const rows = state.entries.training ?? []
  for (const row of rows) {
    const roster = state.trainingRosters[Number(row.id)] ?? []
    const headcount = roster.length
    row.参训人数 = headcount
    row.名单来源 = headcount === 0 ? '空名单' : '报名名单'
  }
}

function readStorage(): AppState {
  const fallback = freshState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    // v1 是扁平的「模块键 -> 记录数组」，v2 包了一层 entries/trainingRosters
    const isLegacy = !(parsed && typeof parsed === 'object' && 'entries' in parsed)
    const migrated = migrateLegacy(parsed)
    if (isLegacy) {
      // 旧结构只在读取时出现一次，立即回写 v2，避免后续读到半旧半新的数据
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: AppState | null = null

export function state(): AppState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return state().entries
}

export function listRows(key: string): EntryRow[] {
  return state().entries[key] ?? []
}

export function getRoster(trainingId: number): RosterMember[] {
  return state().trainingRosters[trainingId] ?? []
}

/**
 * 原子提交：登记数据与报名名单在同一份状态里一次性落盘。
 * 提交动作本身不做拆分写入，任何一步失败都不会只改一边。
 */
export function commitState(mutator: (draft: AppState) => void): AppState {
  const draft = clone(state())
  mutator(draft)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先序列化，序列化失败不会触碰现有数据
    const serialized = JSON.stringify(draft)
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = draft
  return draft
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitState((draft) => {
    draft.entries[key] = rows
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  commitState((draft) => {
    draft.entries[key] = rows
    if (key === 'training') {
      draft.trainingRosters = clone(SEED_TRAINING_ROSTERS)
    }
  })
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
