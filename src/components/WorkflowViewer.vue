<template>
  <div class="fsm-viewer" :style="{ height: height ?? '400px' }">
    <ClientOnly>
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        fit-view-on-init
        :nodes-draggable="false"
        :nodes-connectable="false"
        :zoom-on-scroll="true"
        :min-zoom="0.3"
        :max-zoom="2"
        class="fsm-flow"
      >
        <Background />
        <Controls />
        <MiniMap v-if="showMinimap" />
      </VueFlow>
    </ClientOnly>

    <!-- Legend -->
    <div class="fsm-legend">
      <span v-for="item in legend" :key="item.label" class="fsm-legend__item">
        <span class="fsm-legend__dot" :style="{ background: item.color }" />
        {{ item.label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { WorkflowDefinition, WorkflowInstance } from '../schema/types.js'
import { applyElkLayout } from '../layout/elk-layout.js'
import BaseNode from './nodes/BaseNode.vue'
import LabelledEdge from './edges/LabelledEdge.vue'

const props = defineProps<{
  definition: WorkflowDefinition
  /** If provided, highlights the active state */
  activeInstance?: WorkflowInstance | null
  height?: string
  showMinimap?: boolean
}>()

const nodeTypes = { default: BaseNode }
const edgeTypes = { default: LabelledEdge }

const laidOutNodes = ref<ReturnType<typeof buildBaseNodes>>([])

function buildBaseNodes() {
  return Object.entries(props.definition.states).map(([id, state]) => ({
    id,
    type: 'default',
    position: state.position ?? { x: 0, y: 0 },
    data: {
      label: id,
      description: state.description,
      nodeType: state.nodeType,
      color: state.color,
      actionsCount: (state.readActions?.length ?? 0) + (state.writeActions?.length ?? 0),
      isActive: props.activeInstance?.currentState === id,
    },
  }))
}

const flowEdges = computed(() =>
  props.definition.transitions.map(t => ({
    id: t.id,
    source: t.from,
    target: t.to,
    type: 'default',
    data: {
      label: t.label,
      condition: t.condition,
      trigger: t.trigger,
    },
  }))
)

const flowNodes = computed(() => laidOutNodes.value)

async function runLayout() {
  const baseNodes = buildBaseNodes()
  const hasPositions = baseNodes.every(n => n.position.x !== 0 || n.position.y !== 0)
  if (hasPositions) {
    laidOutNodes.value = baseNodes
  } else {
    laidOutNodes.value = await applyElkLayout(baseNodes, flowEdges.value)
  }
}

watch(() => props.definition, runLayout, { immediate: true, deep: true })

// Update isActive without re-running layout
watch(() => props.activeInstance?.currentState, (activeState) => {
  laidOutNodes.value = laidOutNodes.value.map(n => ({
    ...n,
    data: { ...n.data, isActive: n.id === activeState },
  }))
})

const legend = [
  { label: 'LLM decision', color: '#818cf8' },
  { label: 'Action taken', color: '#34d399' },
  { label: 'Timeout', color: '#fb923c' },
  { label: 'Host-driven', color: '#60a5fa' },
  { label: 'Unconditional', color: '#94a3b8' },
]
</script>

<style scoped>
.fsm-viewer {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: #0f0f17;
}

.fsm-flow {
  width: 100%;
  height: 100%;
}

.fsm-legend {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  background: rgba(15, 15, 23, 0.85);
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid #334155;
  pointer-events: none;
}

.fsm-legend__item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
}

.fsm-legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
