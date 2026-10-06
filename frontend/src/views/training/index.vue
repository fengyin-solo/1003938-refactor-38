<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>群测群防培训管理</h2>
        <p class="page-desc">列表、授课、考核、归档入口共用同一条阶段链：待开展 → 授课中 → 已完成 → 已考核 → 已归档，结业后不可重新授课。</p>
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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '报名名单'">
              <span v-if="rosterOf(row).length">{{ rosterOf(row).join('、') }}</span>
              <span v-else class="error-text">空名单（阻止授课）</span>
            </template>
            <template v-else-if="column === '考核通过率'">
              {{ row[column] === '' || row[column] === undefined ? '—' : `${row[column]}%` }}
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isManualOverridden(row)" class="verdict-tag" title="人工裁决高于自动通过率">人工改判</span>
          </td>
          <td class="row-actions">
            <template v-if="stageOf(row).actions.length">
              <button
                v-for="action in stageOf(row).actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">已结业，无入口</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无群测群防培训数据，可先登记培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条群测群防培训记录；空名单批次必须先补报名单才能授课</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="examTarget" class="modal-mask" @click.self="closeExam">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="组织考核裁决">
        <h3>组织考核 · {{ examTarget['培训编号'] }}</h3>
        <p class="page-desc">先录自动通过率，人工可直接改判；人工考核裁决高于自动通过率。</p>
        <label class="form-item">
          <span>考核通过率（0-100）</span>
          <input v-model.number="examPassRate" type="number" min="0" max="100" placeholder="例如 72" />
        </label>
        <label class="form-item">
          <span>人工考核裁决</span>
          <select v-model="examManualVerdict">
            <option value="">不裁决（按通过率自动判定，达标线 60%）</option>
            <option value="合格">合格（人工裁决）</option>
            <option value="不合格">不合格（人工裁决）</option>
          </select>
        </label>
        <p class="verdict-preview">
          自动判定：<strong>{{ autoVerdictText }}</strong>
          ；最终结论以人工裁决为准。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeExam">取消</button>
          <button class="btn primary" type="button" @click="submitExam">提交考核裁决</button>
        </div>
      </div>
    </div>
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
import { parseRoster } from '@/data/training-roster'
import type { EntryRow } from '@/data/types'
import { judgeExam, resolveStage } from '@/data/workflow'

const meta = moduleMeta('training')
const columns = ["培训编号", "培训主题", "培训对象", "培训日期", "授课人", "参训人数", "报名名单", "考核通过率", "考核结论"]
const statuses = ["待开展", "授课中", "已完成", "已考核", "已归档"]

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

const stats = computed(() => {
  const countOf = (row: EntryRow) => {
    const value = Number(row['参训人数'])
    return Number.isFinite(value) ? value : 0
  }
  const assessed = rows.value.filter((row) => Number.isFinite(Number(row['考核通过率'])) && row['考核通过率'] !== '')
  const avgRate = assessed.length
    ? Math.round(assessed.reduce((sum, row) => sum + Number(row['考核通过率']), 0) / assessed.length)
    : 0
  return [
    { label: '年度培训次数', value: rows.value.length },
    { label: '累计参训人数', value: rows.value.reduce((sum, row) => sum + countOf(row), 0) },
    { label: '平均考核通过率', value: `${avgRate}%` },
  ]
})

// 考核弹窗
const examTarget = ref<EntryRow | null>(null)
const examPassRate = ref<number | null>(null)
const examManualVerdict = ref('')

const autoVerdictText = computed(() => {
  if (examPassRate.value === null || !Number.isFinite(examPassRate.value)) {
    return '待录入通过率'
  }
  return judgeExam(examPassRate.value, examManualVerdict.value).autoVerdict
})

function stageOf(row: EntryRow) {
  return resolveStage(meta.key, row)
}

function rosterOf(row: EntryRow): string[] {
  return parseRoster(row['报名名单'])
}

function isManualOverridden(row: EntryRow): boolean {
  return String(row['人工裁决'] ?? '') !== '' && String(row['人工裁决']) !== String(row['自动裁决'])
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '组织考核') {
    examTarget.value = row
    examPassRate.value = null
    examManualVerdict.value = ''
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function closeExam() {
  examTarget.value = null
}

function submitExam() {
  if (!examTarget.value) {
    return
  }
  const result = applyAction(meta.key, Number(examTarget.value.id), '组织考核', {
    passRate: examPassRate.value ?? undefined,
    manualVerdict: examManualVerdict.value || undefined,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  examTarget.value = null
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
