<template>
  <div v-if="open && row" class="modal-mask" @click.self="close">
    <div class="modal">
      <header class="modal-head">
        <h3>{{ dialogTitle }} · {{ row.培训编号 }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <div class="modal-body">
        <p class="modal-desc">
          {{ row.培训主题 }}｜当前阶段：{{ row.status }}｜报名名单 {{ roster.length }} 人
          <span v-if="mode === 'edit-roster'" class="modal-hint">（名单为空时开始授课会被明确阻止）</span>
        </p>

        <div v-if="mode === 'edit-roster'" class="roster-edit">
          <div class="roster-add">
            <input v-model="newName" placeholder="学员姓名" />
            <input v-model="newOrg" placeholder="所属单位" />
            <button class="btn" type="button" :disabled="!newName.trim()" @click="addMember">加入名单</button>
          </div>
        </div>

        <table class="data-table roster-table">
          <thead>
            <tr>
              <th>序号</th><th>姓名</th><th>所属单位</th>
              <th v-if="mode !== 'edit-roster'">考核成绩</th>
              <th v-if="mode !== 'edit-roster'">是否及格</th>
              <th v-if="mode === 'edit-roster'">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(member, index) in roster" :key="member.key">
              <td>{{ index + 1 }}</td>
              <td>{{ member.姓名 }}</td>
              <td>{{ member.单位 }}</td>
              <template v-if="mode !== 'edit-roster'">
                <td>
                  <input
                    v-if="mode === 'exam'"
                    class="score-input"
                    type="number"
                    min="0"
                    max="100"
                    :value="member.成绩"
                    @input="updateScore(index, ($event.target as HTMLInputElement).value)"
                  />
                  <span v-else>{{ member.成绩 === '' ? '未考核' : member.成绩 }}</span>
                </td>
                <td>
                  <span :class="scoreClass(member.成绩)">{{ scoreLabel(member.成绩) }}</span>
                </td>
              </template>
              <td v-if="mode === 'edit-roster'">
                <button class="link" type="button" @click="removeMember(index)">移出名单</button>
              </td>
            </tr>
            <tr v-if="!roster.length">
              <td :colspan="mode === 'edit-roster' ? 4 : 5" class="empty-state">
                报名名单为空{{ mode === 'edit-roster' ? '，请先补录参训人员' : '，授课与考核入口均被阻止' }}
              </td>
            </tr>
          </tbody>
        </table>

        <section v-if="mode === 'exam'" class="verdict-box">
          <div class="verdict-line">
            <span>自动通过率：<strong>{{ preview.passRate }}%</strong></span>
            <span>自动考核结论（个人及格线 60 分、批次合格率 80%）：<strong>{{ preview.automatic }}</strong></span>
          </div>
          <fieldset class="manual-box">
            <legend>人工裁决（裁决一旦给出，高于自动通过率）</legend>
            <label><input type="radio" value="" v-model="manualVerdict" /> 不干预，按自动通过率</label>
            <label><input type="radio" value="合格" v-model="manualVerdict" /> 人工判定合格</label>
            <label><input type="radio" value="不合格" v-model="manualVerdict" /> 人工判定不合格</label>
          </fieldset>
          <p class="verdict-final">
            最终结论：<strong :class="preview.final === '合格' ? 'pass' : 'fail'">{{ preview.final }}</strong>
            （{{ preview.source }}）
          </p>
        </section>

        <section v-else-if="mode === 'view'" class="verdict-box">
          <p class="verdict-final">
            考核通过率：<strong>{{ typeof row.考核通过率 === 'number' ? `${row.考核通过率}%` : '未组织考核' }}</strong>
            ｜ 考核结论：{{ row.考核结论 || '—' }}
          </p>
        </section>
      </div>

      <footer class="modal-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span class="modal-spacer"></span>
        <button class="btn" type="button" @click="close">{{ mode === 'view' ? '关闭' : '取消' }}</button>
        <button v-if="mode === 'edit-roster'" class="btn" type="button" @click="saveRosterOnly">保存名单</button>
        <button v-if="mode === 'exam'" class="btn primary" type="button" @click="submitExam">提交考核</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getTrainingRoster, saveTrainingRoster, submitTrainingExam } from '@/api/local-service'
import { EXAM_PASS_SCORE, settleExam } from '@/data/exam-policy'
import type { EntryRow, RosterMember } from '@/data/types'

const props = defineProps<{ open: boolean; row: EntryRow | null }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submitted', message: string): void
}>()

const roster = ref<RosterMember[]>([])
const manualVerdict = ref<'' | '合格' | '不合格'>('')
const newName = ref('')
const newOrg = ref('')
const errorMessage = ref('')

type DialogMode = 'edit-roster' | 'exam' | 'view'

const mode = computed<DialogMode>(() => {
  const status = String(props.row?.status ?? '')
  if (status === '已完成') {
    return 'exam'
  }
  if (status === '待开展' || status === '授课中') {
    return 'edit-roster'
  }
  return 'view'
})

const dialogTitle = computed(() => {
  if (mode.value === 'exam') {
    return '组织考核'
  }
  if (mode.value === 'edit-roster') {
    return '维护报名名单'
  }
  return '查看名单与考核'
})

const preview = computed(() =>
  settleExam(roster.value, manualVerdict.value === '' ? undefined : manualVerdict.value),
)

watch(
  () => [props.open, props.row?.id] as const,
  ([open]) => {
    if (!open || !props.row) {
      return
    }
    roster.value = getTrainingRoster(Number(props.row.id))
    manualVerdict.value = ''
    newName.value = ''
    newOrg.value = ''
    errorMessage.value = ''
  },
  { immediate: true },
)

function updateScore(index: number, raw: string) {
  const member = roster.value[index]
  if (!member) {
    return
  }
  if (raw.trim() === '') {
    member.成绩 = ''
    return
  }
  const value = Number(raw)
  member.成绩 = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : ''
}

function scoreLabel(score: number | '') {
  if (typeof score !== 'number') {
    return '未考核'
  }
  return score >= EXAM_PASS_SCORE ? '及格' : '不及格'
}

function scoreClass(score: number | '') {
  if (typeof score !== 'number') {
    return 'muted'
  }
  return score >= EXAM_PASS_SCORE ? 'pass' : 'fail'
}

function addMember() {
  const name = newName.value.trim()
  if (!name) {
    return
  }
  roster.value.push({
    key: `M-${Date.now()}-${roster.value.length}`,
    姓名: name,
    单位: newOrg.value.trim() || '未填写',
    出勤: true,
    成绩: '',
  })
  newName.value = ''
  newOrg.value = ''
}

function removeMember(index: number) {
  roster.value.splice(index, 1)
}

function close() {
  emit('close')
}

function saveRosterOnly() {
  if (!props.row) {
    return
  }
  const result = saveTrainingRoster(Number(props.row.id), roster.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('submitted', result.message)
}

function submitExam() {
  if (!props.row) {
    return
  }
  const result = submitTrainingExam(
    Number(props.row.id),
    roster.value,
    manualVerdict.value === '' ? undefined : manualVerdict.value,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('submitted', result.message)
}
</script>
