<template>
  <section class="page" data-module="propaganda">
    <header class="page-head">
      <div>
        <h2>防灾宣传管理</h2>
        <p class="page-desc">维护宣传活动，待办入口与归档入口共用同一份阶段结果；只有完成或取消的活动才能归档。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记宣传活动</button>
        <button class="btn" type="button" @click="exportRows">导出防灾宣传清单</button>
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
          <th>可执行动作（待办/归档共用阶段结果）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span :class="['stage-tag', stageClass(row.status)]">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted">已归档，无待办</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防灾宣传数据，可先登记宣传活动</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防灾宣传记录｜其中待办 {{ pendingCount }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
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
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('propaganda')
const columns = ['活动编号', '宣传主题', '宣传方式', '覆盖村组', '活动日期', '参与人数', '组织人']

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

const pendingCount = computed(() => rows.value.filter((row) => row.pending).length)

const stats = computed(() => {
  const monthPrefix = new Date().toISOString().slice(0, 7)
  const monthly = rows.value.filter((row) => String(row.活动日期 ?? '').startsWith(monthPrefix)).length
  const done = rows.value.filter((row) => ['已完成', '已归档'].includes(String(row.status))).length
  const coverage = rows.value.reduce((sum, row) => sum + (Number(row.参与人数 ?? 0) || 0), 0)
  return [
    { label: '本月活动数', value: monthly },
    { label: '已完成数', value: done },
    { label: '覆盖人次', value: coverage },
  ]
})

/** 待办与归档入口取同一条动作链：阶段不允许的动作一律不出现。 */
function actionsFor(row: EntryRow): string[] {
  return availableActionsFor(meta.key, String(row.status))
}

function stageClass(status: string | number | boolean): string {
  return `stage-${String(status)}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '宣传活动登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '归档' && !window.confirm(`确认归档宣传活动「${row.活动编号}」？`)) {
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
    errorMessage.value = error instanceof Error ? error.message : '防灾宣传列表读取失败'
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
.stage-已完成 {
  background: #e8f1ff;
  color: #1f6feb;
}
.stage-已取消 {
  background: #fdecec;
  color: #b42318;
}
.muted {
  color: var(--muted);
}
</style>
