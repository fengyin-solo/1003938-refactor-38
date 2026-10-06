/**
 * 验证内容：
 * 1. v1 裸数据按报名名单迁移缺参训人数的历史批次（含空名单）；
 * 2. 唯一动作链：列表/授课/考核/归档入口阶段一致，已结业不能重新授课，未考核不能归档；
 * 3. 空名单明确阻止后续授课；
 * 4. 人工考核裁决高于自动通过率；
 * 5. 冲突/失败时不允许只改一边（事务 + 整信封写入）；
 * 6. 防灾宣传待办与归档入口共用同一阶段结果。
 */

// ---- 内存 localStorage（可模拟落盘失败） ----
let storage = new Map<string, string>()
let failNextSet = false
;(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? (storage.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      if (failNextSet) {
        throw new Error('模拟磁盘故障')
      }
      storage.set(key, value)
    },
    removeItem: (key: string) => storage.delete(key),
  },
}

// ---- 构造一份 v1 老数据（无版本信封，参训人数是占位文本/空，无名单字段） ----
const v1 = {
  training: [
    { id: 1, status: '待开展', pending: true, abnormal: false, 培训编号: 'TRAI-0001', 参训人数: '群测群防培训样例1', 考核通过率: '群测群防培训样例1', 培训状态: '群测群防培训样例1' },
    { id: 2, status: '授课中', pending: true, abnormal: true, 培训编号: 'TRAI-0002', 参训人数: '', 考核通过率: '', 培训状态: '授课中' },
    { id: 3, status: '已完成', pending: false, abnormal: false, 培训编号: 'TRAI-0003', 参训人数: '群测群防培训样例3', 考核通过率: '群测群防培训样例3', 培训状态: '已完成' },
  ],
  propaganda: [
    { id: 1, status: '待开展', pending: true, abnormal: false, 活动编号: 'PROP-0001', 活动状态: '待开展' },
    { id: 2, status: '已完成', pending: false, abnormal: false, 活动编号: 'PROP-0002', 活动状态: '已完成' },
  ],
}
storage.set('geohazard-monitor-prevention:entries', JSON.stringify(v1))

const [{ allRows, listRows, saveRows, resetRows, storageKey }, localService, { judgeExam, resolveStage }, { migrate }] =
  await Promise.all([
    import('@/data/local-store'),
    import('@/api/local-service'),
    import('@/data/workflow'),
    import('@/data/migration'),
  ])
const { runAction, listEntries } = localService

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    console.error(`✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}
function rowOf(rows: { id: number }[], id: number) {
  const row = rows.find((item) => item.id === id)
  if (!row) throw new Error(`缺少 id=${id} 的记录`)
  return row
}

// ---------- 1. 历史迁移 ----------
{
  const rows = allRows()
  const t1 = rowOf(rows.training, 1)
  const t2 = rowOf(rows.training, 2)
  const t3 = rowOf(rows.training, 3)
  const p2 = rowOf(rows.propaganda, 2)

  check('迁移: 缺参训人数按报名名单补齐(5)', t1['参训人数'] === 5, String(t1['参训人数']))
  check('迁移: 名单写入5人', String(t1['报名名单']).split('、').length === 5)
  check('迁移: 空串参训人数按名单补齐(4)', t2['参训人数'] === 4, String(t2['参训人数']))
  check('迁移: 无名单历史批次迁移为0人', t3['参训人数'] === 0, String(t3['参训人数']))
  check('迁移: 空名单批次名单保持为空', t3['报名名单'] === '', String(t3['报名名单']))
  check('迁移: 占位通过率清空视为未考核', t1['考核通过率'] === '', String(t1['考核通过率']))
  check('迁移: 考核结论列补齐', t1['考核结论'] === '')
  check('迁移: 培训状态列与阶段对齐', t1['培训状态'] === '待开展' && t2['培训状态'] === '授课中')
  check('迁移: 未考核的已完成批次仍为待办(不能直接归档)', t3.pending === true, String(t3.pending))
  check('迁移: 宣传已完成待办由阶段结果重新判定为true', p2.pending === true, String(p2.pending))

  const persisted = JSON.parse(storage.get(storageKey()) as string)
  check('迁移: 落盘版本号=2', persisted.version === 2, String(persisted.version))

  // 高版本数据必须拒绝，不能半迁移
  let threw = false
  try {
    migrate({ version: 99, entries: {} }, {})
  } catch {
    threw = true
  }
  check('迁移: 更高版本数据拒绝处理', threw)
}

// ---------- 2/3/4. 培训唯一动作链 ----------
{
  const make = (id: number, status: string, roster: string) => ({
    id,
    status,
    pending: resolveStage('training', { status }).pending,
    abnormal: false,
    培训编号: `T-${id}`,
    报名名单: roster,
    参训人数: roster ? roster.split('、').length : 0,
    考核通过率: '',
    考核结论: '',
    培训状态: status,
  })
  saveRows('training', [
    make(1, '待开展', '甲、乙、丙'),
    make(2, '待开展', ''), // 空名单
    make(3, '已归档', '甲、乙'),
    make(4, '已完成', '甲、乙、丙、丁'), // 已授课未考核
  ])

  // 已结业不能重新授课
  let r = runAction('training', 3, '开始授课')
  check('链路: 已归档不能重新授课', !r.ok && r.message.includes('终态'))

  // 未考核不能归档（已完成阶段只开放组织考核）
  r = runAction('training', 4, '归档')
  check('链路: 未考核记录不能归档', !r.ok && r.message.includes('组织考核'))

  // 阶段必须相邻：待开展不能直接考核/归档
  r = runAction('training', 1, '组织考核')
  check('链路: 待开展不能跳到考核', !r.ok && r.message.includes('只能执行'))
  r = runAction('training', 1, '归档')
  check('链路: 待开展不能跳到归档', !r.ok)

  // 空名单阻止授课
  const before = JSON.stringify(rowOf(listRows('training'), 2))
  r = runAction('training', 2, '开始授课')
  check('空名单: 明确阻止开始授课', !r.ok && r.message.includes('报名名单为空'))
  const after = rowOf(listRows('training'), 2)
  check('空名单: 被阻止后状态仍是待开展', after.status === '待开展')
  check('空名单: 被阻止后数据完全未变', JSON.stringify(after) === before)

  // 正常链路推进
  r = runAction('training', 1, '开始授课')
  check('链路: 开始授课成功', r.ok && rowOf(listRows('training'), 1).status === '授课中')
  r = runAction('training', 1, '开始授课')
  check('链路: 授课中不能重复开始授课', !r.ok)
  r = runAction('training', 1, '归档')
  check('链路: 授课中不能归档', !r.ok)
  r = runAction('training', 1, '完成授课')
  check('链路: 授课中→已完成', r.ok && rowOf(listRows('training'), 1).status === '已完成')

  // 考核入参校验（当前阶段已是已完成，开放组织考核）
  r = runAction('training', 1, '组织考核', {})
  check('考核: 缺通过率被阻止', !r.ok && r.message.includes('通过率'))
  r = runAction('training', 1, '组织考核', { passRate: 101 })
  check('考核: 超范围通过率被阻止', !r.ok)
  r = runAction('training', 1, '组织考核', { passRate: 72 })
  let row1 = rowOf(listRows('training'), 1)
  check('考核: 自动通过率72%判合格并入考核阶段', r.ok && row1.status === '已考核' && row1['考核结论'] === '合格' && row1['考核通过率'] === 72)
  check('考核: 已考核仍待办(待归档)', row1.pending === true)
  check('考核: 培训状态列同步为已考核', row1['培训状态'] === '已考核')

  // 考核后归档
  r = runAction('training', 1, '归档')
  row1 = rowOf(listRows('training'), 1)
  check('归档: 已考核才能归档且待办清零', r.ok && row1.status === '已归档' && row1.pending === false)
  r = runAction('training', 1, '完成授课')
  check('链路: 归档后任何动作都拒绝', !r.ok)

  // 人工裁决高于自动通过率：通过率达标但人工判不合格
  r = runAction('training', 4, '组织考核', { passRate: 90, manualVerdict: '不合格' })
  const row4 = rowOf(listRows('training'), 4)
  check('裁决: 人工不合格覆盖自动合格', r.ok && row4['考核结论'] === '不合格' && row4['自动裁决'] === '合格' && row4['人工裁决'] === '不合格')

  // 反向覆盖：通过率不达标，人工判合格
  saveRows('training', [make(5, '已完成', '子、丑')])
  r = runAction('training', 5, '组织考核', { passRate: 10, manualVerdict: '合格' })
  const row5 = rowOf(listRows('training'), 5)
  check('裁决: 人工合格覆盖自动不合格', r.ok && row5['考核结论'] === '合格' && row5['自动裁决'] === '不合格')

  // 裁决单元
  check('裁决单元: 59%自动不合格', judgeExam(59).finalVerdict === '不合格')
  check('裁决单元: 60%自动合格', judgeExam(60).finalVerdict === '合格')
  check('裁决单元: 不裁决时回落自动', judgeExam(90, '').finalVerdict === '合格' && judgeExam(90).manualOverridden === false)
  check('裁决单元: 人工改判标记', judgeExam(90, '不合格').manualOverridden === true)
}

// ---------- 5. 冲突/失败原子性 ----------
{
  const make = (id: number, status: string, roster: string) => ({
    id,
    status,
    pending: true,
    abnormal: false,
    培训编号: `ATOM-${id}`,
    报名名单: roster,
    参训人数: 3,
    考核通过率: '',
    考核结论: '',
    培训状态: status,
  })
  saveRows('training', [make(1, '待开展', '一、二、三')])
  const persistedBefore = storage.get(storageKey()) as string

  // 校验失败：内存与磁盘都不变
  runAction('training', 1, '组织考核', { passRate: 50 })
  check('原子: 校验失败内存不变', rowOf(listRows('training'), 1).status === '待开展')
  check('原子: 校验失败磁盘不变', storage.get(storageKey()) === persistedBefore)

  // 落盘失败：返回失败且内存缓存不推进
  failNextSet = true
  const r = runAction('training', 1, '开始授课')
  failNextSet = false
  check('原子: 落盘失败返回失败', !r.ok && r.message.includes('状态未变更'))
  check('原子: 落盘失败内存不推进', rowOf(listRows('training'), 1).status === '待开展')
  check('原子: 落盘失败磁盘保留旧值', (JSON.parse(storage.get(storageKey()) as string).entries.training[0].status) === '待开展')

  // 整信封写入：改培训不能抹掉宣传
  saveRows('propaganda', [{ id: 9, status: '已完成', pending: true, abnormal: false, 活动编号: 'KEEP', 活动状态: '已完成' }])
  runAction('training', 1, '开始授课')
  check('原子: 单模块写入不影响其他模块', rowOf(listRows('propaganda'), 9)['活动编号'] === 'KEEP')
}

// ---------- 6. 防灾宣传：待办与归档入口共用阶段结果 ----------
{
  const make = (id: number, status: string, abnormal = false) => ({
    id,
    status,
    pending: resolveStage('propaganda', { status }).pending,
    abnormal,
    活动编号: `P-${id}`,
    活动状态: status,
  })
  saveRows('propaganda', [
    make(1, '待开展'),
    make(2, '已完成'),
    make(3, '已取消', true),
    make(4, '已归档'),
    make(5, '进行中'),
  ])

  const p1 = rowOf(listRows('propaganda'), 1)
  const p2 = rowOf(listRows('propaganda'), 2)
  const p3 = rowOf(listRows('propaganda'), 3)
  const p4 = rowOf(listRows('propaganda'), 4)
  const p5 = rowOf(listRows('propaganda'), 5)

  const s1 = resolveStage('propaganda', p1)
  const s2 = resolveStage('propaganda', p2)
  const s3 = resolveStage('propaganda', p3)
  const s4 = resolveStage('propaganda', p4)

  check('宣传: 待开展开放开展/取消', s1.actions.join(',') === '开展活动,取消活动' && s1.pending === true)
  check('宣传: 已完成阶段唯一开放归档入口', s2.actions.join(',') === '归档' && s2.canArchive === true && s2.pending === true)
  check('宣传: 已取消无动作、无待办、无归档', s3.actions.length === 0 && s3.pending === false && s3.canArchive === false && s3.isTerminal)
  check('宣传: 已归档无动作、无待办', s4.actions.length === 0 && s4.pending === false)

  // 待办(row.pending)与 canArchive 同源：断言存储值与阶段结果一致
  check('宣传: 存储待办位与阶段结果一致', p2.pending === s2.pending && p3.pending === s3.pending && p4.pending === s4.pending)

  let r = runAction('propaganda', 2, '开展活动')
  check('宣传: 已完成不能回退开展', !r.ok)
  r = runAction('propaganda', 2, '归档')
  const p2after = rowOf(listRows('propaganda'), 2)
  check('宣传: 归档后待办与入口同时关闭', r.ok && p2after.status === '已归档' && p2after.pending === false)
  check('宣传: 归档后活动状态列同事务更新', p2after['活动状态'] === '已归档')

  r = runAction('propaganda', 3, '归档')
  check('宣传: 已取消不能再归档', !r.ok)
  r = runAction('propaganda', 4, '取消活动')
  check('宣传: 已归档不能取消', !r.ok)

  r = runAction('propaganda', 1, '开展活动')
  check('宣传: 待开展→进行中', r.ok && rowOf(listRows('propaganda'), 1).status === '进行中')
  r = runAction('propaganda', 5, '取消活动')
  const p5after = rowOf(listRows('propaganda'), 5)
  check('宣传: 进行中取消→已取消且待办清零、标异常', r.ok && p5after.status === '已取消' && p5after.pending === false && p5after.abnormal === true)
  const s5 = resolveStage('propaganda', p5after)
  check('宣传: 取消后归档入口也关闭', s5.canArchive === false && s5.actions.length === 0)
}

// ---------- 列表口径：listEntries 与阶段结果一致 ----------
{
  resetRows('training')
  const items = listEntries('training').items
  const archived = items.filter((row) => String(row.status) === '已归档')
  check('列表: 已结业批次无任何动作入口', archived.every((row) => resolveStage('training', row).actions.length === 0))
  const teachable = items.filter((row) => String(row.status) === '待开展')
  check('列表: 空名单批次在开始授课阶段但会被守卫拦截', teachable.some((row) => String(row['报名名单']) === ''))
}

console.log(`\n验证结果：通过 ${passed} 条，失败 ${failed} 条`)
if (failed > 0) {
  process.exit(1)
}
