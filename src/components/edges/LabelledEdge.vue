<template>
  <BaseEdge :path="edgePath" :marker-end="markerEnd" :style="edgeStyle" />
  <EdgeLabelRenderer>
    <div
      v-if="data?.label || data?.condition"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      class="fsm-edge-label nodrag nopan"
      :class="`fsm-edge-label--${data?.trigger ?? 'unconditional'}`"
    >
      {{ data?.label ?? data?.condition }}
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  data?: {
    label?: string
    condition?: string
    trigger?: string
    color?: string
  }
  markerEnd?: string
}>()

const [edgePath, labelX, labelY] = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition as never,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition as never,
  })
).value

const triggerColors: Record<string, string> = {
  llm_decision: '#818cf8',
  action_taken: '#34d399',
  timeout: '#fb923c',
  host_driven: '#60a5fa',
  unconditional: '#94a3b8',
}

const edgeStyle = computed(() => ({
  stroke: props.data?.color ?? triggerColors[props.data?.trigger ?? 'unconditional'],
  strokeWidth: 2,
}))
</script>

<style scoped>
.fsm-edge-label {
  position: absolute;
  pointer-events: all;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background: #1e1e2e;
  border: 1px solid #334155;
  color: #94a3b8;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fsm-edge-label--llm_decision  { border-color: #818cf8; color: #818cf8; }
.fsm-edge-label--action_taken  { border-color: #34d399; color: #34d399; }
.fsm-edge-label--timeout       { border-color: #fb923c; color: #fb923c; }
.fsm-edge-label--host_driven   { border-color: #60a5fa; color: #60a5fa; }
</style>
