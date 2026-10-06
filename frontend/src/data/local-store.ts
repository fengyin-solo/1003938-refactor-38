import { CURRENT_VERSION, migrate, type StoreEnvelope } from './migration'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在；结构变更走版本迁移。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 迁移失败时的兜底：播种最新版本的示例数据，避免半迁移数据继续被写入。 */
function seedEnvelope(): StoreEnvelope {
  return { version: CURRENT_VERSION, entries: clone(SEED_ROWS) }
}

function readStorage(): StoreEnvelope {
  const fallback = seedEnvelope()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const migrated = migrate(parsed, SEED_ROWS)
    // 迁移产生结构变化时落盘固化；写失败也返回内存结果，下次还会重试迁移。
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch (error) {
    // 迁移冲突/失败：不接受只迁一半的状态，直接回到示例数据并提示。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    console.error('本地数据迁移失败，已回到示例数据：', error)
    return fallback
  }
}

let cache: StoreEnvelope | null = null

function store(): StoreEnvelope {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return store().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 唯一写入口：整张信封一次性序列化、一次性落盘。
 * 调用方在内存快照上完成全部校验后才调本函数，杜绝冲突或失败时只改一边。
 */
export function saveRows(key: string, rows: EntryRow[]): void {
  const current = store()
  const next: StoreEnvelope = {
    version: current.version,
    entries: { ...current.entries, [key]: rows },
  }
  const payload = JSON.stringify(next)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先持久化成功，再更新内存缓存：落盘失败时内存也不变，两边保持一致。
    window.localStorage.setItem(STORAGE_KEY, payload)
  }
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
