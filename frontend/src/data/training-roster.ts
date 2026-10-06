/**
 * 历史批次报名名单：迁移缺参训人数的历史批次时按这份名单补齐。
 * key 为培训编号；名单为空数组表示该批次没有任何报名（空名单必须明确阻止后续授课）。
 */
export const HISTORICAL_ROSTERS: Record<string, string[]> = {
  'TRAI-0001': ['张守山', '李桂芳', '王长顺', '赵秀莲', '陈德海'],
  'TRAI-0002': ['周明远', '吴玉梅', '郑福来', '孙丽华'],
  // TRAI-0003：历史批次迁移后仍为空名单，授课入口必须被阻止。
  'TRAI-0003': [],
}

/** 顿号/逗号/分号/换行分隔的名单串解析，过滤空白项。 */
export function parseRoster(text: unknown): string[] {
  if (typeof text !== 'string') {
    return []
  }
  return text
    .split(/[、,，;；\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

/** 名单序列化为存储串。 */
export function stringifyRoster(roster: string[]): string {
  return roster.join('、')
}
