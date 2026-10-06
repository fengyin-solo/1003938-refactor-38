import type { ModuleMeta, StageEdge } from './types'

/**
 * 阶段动作机：模块列表、授课、考核、归档入口共用同一份阶段结果，
 * 阶段允许执行哪些动作完全由 ModuleMeta.transitions 决定。
 */

/** 返回某阶段允许执行的全部动作边；未配置显式动作链的模块回退到通用动作表。 */
export function edgesAt(meta: ModuleMeta, status: string): StageEdge[] {
  const chain = meta.transitions
  if (chain) {
    return chain[status] ?? []
  }
  // 旧模块没有显式动作链：任何非目标态都可执行登记动作，保持原行为
  return meta.actions
    .map((action) => ({ action, target: meta.actionTargets[action] }))
    .filter((edge): edge is StageEdge => Boolean(edge.target))
}

export function allowedActions(meta: ModuleMeta, status: string): string[] {
  return edgesAt(meta, status).map((edge) => edge.action)
}

export function findTransition(meta: ModuleMeta, status: string, action: string): StageEdge | undefined {
  return edgesAt(meta, status).find((edge) => edge.action === action)
}

/** 终态判定：待办与归档入口共用——处于终态的记录不再产生待办。 */
export function isTerminal(meta: ModuleMeta, status: string): boolean {
  const terminals = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return terminals.includes(status)
}
