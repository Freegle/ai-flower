<template>
  <div
    class="fsm-node"
    :class="[`fsm-node--${nodeType}`, { 'fsm-node--active': isActive, 'fsm-node--selected': selected }]"
    :style="nodeStyle"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="fsm-node__header">
      <span class="fsm-node__icon">{{ nodeIcon }}</span>
      <span class="fsm-node__label">{{ data.label }}</span>
    </div>
    <div v-if="data.description" class="fsm-node__description">
      {{ data.description }}
    </div>
    <div v-if="data.actionsCount" class="fsm-node__actions">
      {{ data.actionsCount }} action{{ data.actionsCount !== 1 ? 's' : '' }}
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  id: string
  data: {
    label: string
    description?: string
    nodeType: string
    color?: string
    actionsCount?: number
    isActive?: boolean
  }
  selected?: boolean
}>()

const nodeType = computed(() => props.data.nodeType ?? 'agent')
const isActive = computed(() => props.data.isActive ?? false)

const nodeIcon = computed(() => {
  switch (nodeType.value) {
    case 'start': return '▶'
    case 'end': return '⏹'
    case 'tool': return '⚙'
    default: return '◈'
  }
})

const nodeStyle = computed(() => ({
  borderColor: props.data.color ?? nodeColors[nodeType.value as keyof typeof nodeColors] ?? '#6366f1',
  '--node-accent': props.data.color ?? nodeColors[nodeType.value as keyof typeof nodeColors] ?? '#6366f1',
}))

const nodeColors = {
  start: '#22c55e',
  end: '#ef4444',
  tool: '#f59e0b',
  agent: '#6366f1',
} as const
</script>

<style scoped>
.fsm-node {
  background: var(--vf-node-bg, #1e1e2e);
  border: 2px solid var(--node-accent, #6366f1);
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 160px;
  max-width: 220px;
  font-family: inherit;
  transition: box-shadow 0.15s, border-color 0.15s;
  cursor: pointer;
}

.fsm-node--active {
  box-shadow: 0 0 0 3px var(--node-accent, #6366f1), 0 0 12px var(--node-accent, #6366f1);
}

.fsm-node--selected {
  box-shadow: 0 0 0 2px #fff;
}

.fsm-node__header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  color: #e2e8f0;
}

.fsm-node__icon {
  font-size: 12px;
  opacity: 0.8;
}

.fsm-node__description {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fsm-node__actions {
  font-size: 10px;
  color: #64748b;
  margin-top: 2px;
}
</style>
