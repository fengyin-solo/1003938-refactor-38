<template>
  <section class="page" data-module="propaganda">
    <header class="page-head">
      <div>
        <h2>防灾宣传管理</h2>
        <p class="page-desc">待办与归档入口共用同一阶段结果：待开展 → 进行中 → 已完成 → 归档；取消后活动不再出现在任何待办里。</p>
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
          <th>可执行动作（待办/归档共用）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.pending" class="todo-tag">待办</span>
            <span v-else-if="stageOf(row).canArchive === false && stageOf(row).isTerminal" class="done-tag">已办结</span>
          </td>
          <td class="row-actions">
            <template v-if="stageOf(row).actions.length">
              <button
                v-for="action in stageOf(row).actions"
                :key="action"
                class="link"
                :class="{ 'link-danger': action === '取消活动' }"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">无待办、无归档入口</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防灾宣传数据，可先登记宣传活动</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防灾宣传记录；待办数 {{ pendingCount }}，归档入口仅在「已完成」阶段开放</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { resolveStage } from '@/data/workflow'

const meta = moduleMeta('propaganda')
const columns = ["活动编号", "宣传主题", "宣传方式", "覆盖村组", "活动日期", "参与人数", "组织人"]
const statuses = ["待开展", "进行中", "已完成", "已归档", "已取消"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const pendingCount = computed(() => rows.value.filter((row) => row.pending).length)

const stats = computed(() => {
  const countOf = (row: EntryRow) => {
    const value = Number(row['参与人数'])
    return Number.isFinite(value) ? value : 0
  }
  return [
    { label: '本月活动数', value: rows.value.length },
    { label: '已完成（含归档）', value: rows.value.filter((row) => ['已完成', '已归档'].includes(String(row.status))).length },
    { label: '覆盖人次', value: rows.value.reduce((sum, row) => sum + countOf(row), 0) },
  ]
})

function stageOf(row: EntryRow) {
  // 待办标记（row.pending）与归档入口（canArchive）都来自同一个阶段结果，不会各算各的。
  return resolveStage(meta.key, row)
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
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
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
