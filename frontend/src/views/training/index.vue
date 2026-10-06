<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>群测群防培训管理</h2>
        <p class="page-desc">维护培训批次，围绕报名名单、授课、考核、归档走同一条阶段动作链；人工考核裁决高于自动通过率。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
        <button class="btn" type="button" @click="exportRows">导出群测群防培训清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前阶段</th>
          <th>可执行动作（按阶段唯一）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
          <td><span :class="['stage-tag', stageClass(row.status)]">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              :class="{ primary: action === '组织考核' }"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted">无后续动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无群测群防培训数据，可先登记培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条群测群防培训记录｜参训人数以报名名单为准</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <TrainingExamDialog
      :open="examOpen"
      :row="examRow"
      @close="closeExam"
      @submitted="onExamSubmitted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableActionsFor,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import TrainingExamDialog from './exam-dialog.vue'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('training')
// 培训状态由独立的「当前阶段」列展示，数据列不再重复
const columns = ['培训编号', '培训主题', '培训对象', '培训日期', '授课人', '参训人数', '名单来源', '考核通过率', '考核结论']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const year = new Date().getFullYear()
  const yearly = rows.value.filter((row) => String(row.培训日期 ?? '').startsWith(String(year))).length
  const headcount = rows.value.reduce((sum, row) => sum + Number(row.参训人数 ?? 0) || 0, 0)
  const rated = rows.value.filter((row) => typeof row.考核通过率 === 'number')
  const avgRate = rated.length
    ? Math.round(rated.reduce((sum, row) => sum + Number(row.考核通过率), 0) / rated.length)
    : 0
  return [
    { label: `${year}年度培训次数`, value: yearly },
    { label: '累计参训人数', value: headcount },
    { label: '平均考核通过率', value: `${avgRate}%` },
  ]
})

/** 列表、授课、考核、归档入口共用同一份阶段结果：动作只从动作机取。 */
function actionsFor(row: EntryRow): string[] {
  const actions = availableActionsFor(meta.key, String(row.status))
  // 授课前两个阶段允许维护报名名单；空名单批次也从这里补录后才能授课
  if (row.status === '待开展' || row.status === '授课中') {
    return ['维护名单', ...actions]
  }
  // 结业批次可查看名单与考核结论
  if (row.status === '已考核' || row.status === '已归档') {
    return ['查看名单', ...actions]
  }
  return actions
}

function stageClass(status: string | number | boolean): string {
  return `stage-${String(status)}`
}

function formatCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (column === '考核通过率') {
    return typeof value === 'number' ? `${value}%` : '—'
  }
  return value === '' || value === undefined || value === null ? '—' : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '培训记录登记入口尚未接入审批流'
}

const examOpen = ref(false)
const examRow = ref<EntryRow | null>(null)

function closeExam() {
  examOpen.value = false
  examRow.value = null
}

function onExamSubmitted(message: string) {
  closeExam()
  errorMessage.value = message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '组织考核' || action === '维护名单' || action === '查看名单') {
    examRow.value = row
    examOpen.value = true
    return
  }
  if (action === '归档' && !window.confirm(`确认归档培训批次「${row.培训编号}」？归档后仍可重新授课。`)) {
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '群测群防培训列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.stage-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.stage-已归档 {
  background: #e7f6ec;
  color: #1a7f37;
}
.stage-已考核 {
  background: #e8f1ff;
  color: #1f6feb;
}
.link.primary {
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
</style>
