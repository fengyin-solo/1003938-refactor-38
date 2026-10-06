/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 群测群防培训报名名单上的一名学员，成绩在考核阶段录入。 */
export type RosterMember = {
  key: string
  姓名: string
  单位: string
  出勤: boolean
  成绩: number | ''
}

/** 阶段动作链上的一条边：在某阶段执行动作后流转到目标阶段。 */
export type StageEdge = {
  action: string
  target: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 显式动作链：只有在链上登记的（阶段 × 动作）才允许流转。未配置时沿用 actionTargets 的通用逻辑。 */
  transitions?: Record<string, StageEdge[]>
  /** 终态：处于这些阶段的记录不再产生待办，也是待办与归档入口共同的阶段结果。 */
  terminalStatuses?: string[]
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 本地持久化的完整状态：登记数据与报名名单放在同一份状态里，保证跨集合修改一次提交。 */
export type AppState = {
  version: number
  entries: Record<string, EntryRow[]>
  trainingRosters: Record<number, RosterMember[]>
}
