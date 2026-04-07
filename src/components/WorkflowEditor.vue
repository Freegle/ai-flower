<template>
  <div class="fsm-editor">
    <!-- Toolbar -->
    <div class="fsm-toolbar">
      <div class="fsm-toolbar__left">
        <button class="fsm-btn" @click="addState">+ State</button>
        <button class="fsm-btn fsm-btn--icon" @click="runAutoLayout" title="Auto layout (ELK)">⊞ Layout</button>
        <button class="fsm-btn fsm-btn--icon" @click="fitView()" title="Fit view">⤢</button>
      </div>
      <div class="fsm-toolbar__right">
        <span v-if="isDirty" class="fsm-dirty-badge">Unsaved</span>
        <button v-if="isDirty" class="fsm-btn fsm-btn--primary" @click="saveChanges">Save</button>
      </div>
    </div>

    <!-- Canvas -->
    <div class="fsm-canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
        :min-zoom="0.2"
        :max-zoom="2"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @connect="onConnect"
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        class="fsm-flow"
      >
        <Background />
        <Controls />
        <MiniMap />
      </VueFlow>
    </div>

    <!-- Sidebar -->
    <Transition name="fsm-slide">
      <div v-if="selectedNode || selectedEdge" class="fsm-sidebar">
        <!-- State editor -->
        <div v-if="selectedNode">
          <div class="fsm-sidebar__header">
            <span>Edit State</span>
            <button class="fsm-sidebar__close" @click="selectedNode = null">✕</button>
          </div>

          <label class="fsm-label">State ID</label>
          <input class="fsm-input" :value="selectedNode.id" disabled />

          <label class="fsm-label">Description</label>
          <input class="fsm-input" v-model="editingState.description" @input="markDirty" />

          <label class="fsm-label">Node Type</label>
          <select class="fsm-input" v-model="editingState.nodeType" @change="markDirty">
            <option value="start">Start</option>
            <option value="agent">Agent</option>
            <option value="tool">Tool</option>
            <option value="end">End</option>
          </select>

          <template v-if="editingState.nodeType === 'agent'">
            <label class="fsm-label">Prompt</label>
            <textarea class="fsm-input fsm-textarea" v-model="editingState.prompt" @input="markDirty" rows="5" />

            <label class="fsm-label">Read Actions (comma-separated)</label>
            <input class="fsm-input" :value="(editingState.readActions ?? []).join(', ')"
              @input="e => { editingState.readActions = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); markDirty() }" />

            <label class="fsm-label">Write Actions (comma-separated)</label>
            <input class="fsm-input" :value="(editingState.writeActions ?? []).join(', ')"
              @input="e => { editingState.writeActions = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); markDirty() }" />
          </template>

          <label class="fsm-label">Color (hex)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" :value="editingState.color ?? '#6366f1'" @input="e => { editingState.color = (e.target as HTMLInputElement).value; markDirty() }" style="width:36px;height:32px;padding:2px;border-radius:4px;border:1px solid #334155;background:transparent;cursor:pointer" />
            <input class="fsm-input" style="flex:1" :value="editingState.color ?? '#6366f1'" @input="e => { editingState.color = (e.target as HTMLInputElement).value; markDirty() }" />
          </div>

          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="fsm-btn fsm-btn--primary" @click="applyStateEdit">Apply</button>
            <button class="fsm-btn fsm-btn--danger" @click="deleteSelectedNode"
              :disabled="editingState.nodeType === 'start'">Delete</button>
          </div>
        </div>

        <!-- Edge editor -->
        <div v-if="selectedEdge">
          <div class="fsm-sidebar__header">
            <span>Edit Transition</span>
            <button class="fsm-sidebar__close" @click="selectedEdge = null">✕</button>
          </div>

          <label class="fsm-label">From → To</label>
          <input class="fsm-input" :value="`${selectedEdge.source} → ${selectedEdge.target}`" disabled />

          <label class="fsm-label">Trigger Type</label>
          <select class="fsm-input" v-model="editingEdge.trigger" @change="markDirty">
            <option value="llm_decision">LLM decision</option>
            <option value="action_taken">Action taken</option>
            <option value="timeout">Timeout</option>
            <option value="host_driven">Host-driven</option>
            <option value="unconditional">Unconditional</option>
          </select>

          <template v-if="editingEdge.trigger === 'llm_decision'">
            <label class="fsm-label">Condition (shown to LLM)</label>
            <textarea class="fsm-input fsm-textarea" v-model="editingEdge.condition" @input="markDirty" rows="3" />
          </template>

          <template v-if="editingEdge.trigger === 'action_taken'">
            <label class="fsm-label">Triggering Action</label>
            <input class="fsm-input" v-model="editingEdge.action" @input="markDirty" />
          </template>

          <label class="fsm-label">Label (optional)</label>
          <input class="fsm-input" v-model="editingEdge.label" @input="markDirty" />

          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="fsm-btn fsm-btn--primary" @click="applyEdgeEdit">Apply</button>
            <button class="fsm-btn fsm-btn--danger" @click="deleteSelectedEdge">Delete</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  VueFlow,
  useVueFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { WorkflowDefinition, StateDefinition, TransitionDefinition } from '../schema/types.js'
import { applyElkLayout } from '../layout/elk-layout.js'
import BaseNode from './nodes/BaseNode.vue'
import LabelledEdge from './edges/LabelledEdge.vue'
import { v4 as uuidv4 } from 'uuid'

const props = defineProps<{
  modelValue: WorkflowDefinition
}>()

const emit = defineEmits<{
  'update:modelValue': [definition: WorkflowDefinition]
}>()

const { fitView } = useVueFlow()

const nodeTypes = { default: BaseNode }
const edgeTypes = { default: LabelledEdge }

// Internal mutable copy of the definition
const definition = ref<WorkflowDefinition>(structuredClone(props.modelValue))
const isDirty = ref(false)

// Vue Flow nodes/edges (derived from definition, kept in sync)
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])

// Selection state
const selectedNode = ref<Node | null>(null)
const selectedEdge = ref<Edge | null>(null)
const editingState = ref<Partial<StateDefinition>>({})
const editingEdge = ref<Partial<TransitionDefinition>>({})

function definitionToFlow() {
  nodes.value = Object.entries(definition.value.states).map(([id, state]) => ({
    id,
    type: 'default',
    position: state.position ?? { x: 0, y: 0 },
    data: {
      label: id,
      description: state.description,
      nodeType: state.nodeType,
      color: state.color,
      actionsCount: (state.readActions?.length ?? 0) + (state.writeActions?.length ?? 0),
    },
  }))

  edges.value = definition.value.transitions.map(t => ({
    id: t.id,
    source: t.from,
    target: t.to,
    type: 'default',
    data: { label: t.label, condition: t.condition, trigger: t.trigger, action: t.action },
  }))
}

function flowToDefinition() {
  // Sync positions back
  for (const node of nodes.value) {
    if (definition.value.states[node.id]) {
      definition.value.states[node.id].position = { ...node.position }
    }
  }
}

watch(() => props.modelValue, (val) => {
  definition.value = structuredClone(val)
  isDirty.value = false
  definitionToFlow()
}, { immediate: true })

function markDirty() { isDirty.value = true }

async function runAutoLayout() {
  nodes.value = await applyElkLayout(nodes.value, edges.value)
  // Persist new positions
  for (const n of nodes.value) {
    if (definition.value.states[n.id]) {
      definition.value.states[n.id].position = { ...n.position }
    }
  }
  markDirty()
}

function saveChanges() {
  flowToDefinition()
  emit('update:modelValue', structuredClone(definition.value))
  isDirty.value = false
}

function addState() {
  const id = `STATE_${Date.now()}`
  definition.value.states[id] = {
    description: 'New state',
    nodeType: 'agent',
    position: { x: 200, y: 200 },
  }
  definitionToFlow()
  markDirty()
}

function onNodeClick(_: unknown, node: Node) {
  selectedEdge.value = null
  selectedNode.value = node
  editingState.value = { ...definition.value.states[node.id] }
}

function onEdgeClick(_: unknown, edge: Edge) {
  selectedNode.value = null
  selectedEdge.value = edge
  const trans = definition.value.transitions.find(t => t.id === edge.id)
  editingEdge.value = trans ? { ...trans } : {}
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return
  const id = `t_${uuidv4().slice(0, 8)}`
  const newTransition: TransitionDefinition = {
    id,
    from: connection.source,
    to: connection.target,
    trigger: 'unconditional',
  }
  definition.value.transitions.push(newTransition)
  definitionToFlow()
  markDirty()
}

function onNodesChange(changes: NodeChange[]) {
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      if (definition.value.states[change.id]) {
        definition.value.states[change.id].position = { ...change.position }
        markDirty()
      }
    }
  }
}

function onEdgesChange(changes: EdgeChange[]) {
  for (const change of changes) {
    if (change.type === 'remove') {
      definition.value.transitions = definition.value.transitions.filter(t => t.id !== change.id)
      markDirty()
    }
  }
}

function applyStateEdit() {
  if (!selectedNode.value) return
  definition.value.states[selectedNode.value.id] = {
    ...definition.value.states[selectedNode.value.id],
    ...editingState.value,
  }
  definitionToFlow()
  markDirty()
}

function applyEdgeEdit() {
  if (!selectedEdge.value) return
  const idx = definition.value.transitions.findIndex(t => t.id === selectedEdge.value!.id)
  if (idx !== -1) {
    definition.value.transitions[idx] = {
      ...definition.value.transitions[idx],
      ...editingEdge.value,
    }
    definitionToFlow()
    markDirty()
  }
}

function deleteSelectedNode() {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  if (definition.value.states[id]?.nodeType === 'start') return
  delete definition.value.states[id]
  definition.value.transitions = definition.value.transitions.filter(
    t => t.from !== id && t.to !== id
  )
  selectedNode.value = null
  definitionToFlow()
  markDirty()
}

function deleteSelectedEdge() {
  if (!selectedEdge.value) return
  definition.value.transitions = definition.value.transitions.filter(
    t => t.id !== selectedEdge.value!.id
  )
  selectedEdge.value = null
  definitionToFlow()
  markDirty()
}
</script>

<style scoped>
.fsm-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0f0f17;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.fsm-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #1a1a2e;
  border-bottom: 1px solid #2d2d44;
  gap: 8px;
  flex-shrink: 0;
}

.fsm-toolbar__left, .fsm-toolbar__right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fsm-btn {
  padding: 5px 12px;
  border: 1px solid #334155;
  background: #1e1e2e;
  color: #e2e8f0;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.fsm-btn:hover { background: #2d2d44; }
.fsm-btn--primary { background: #4f46e5; border-color: #4f46e5; color: white; }
.fsm-btn--primary:hover { background: #4338ca; }
.fsm-btn--danger { background: transparent; border-color: #ef4444; color: #ef4444; }
.fsm-btn--danger:hover { background: rgba(239,68,68,0.1); }
.fsm-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.fsm-dirty-badge {
  font-size: 11px;
  color: #f59e0b;
  padding: 2px 8px;
  background: rgba(245,158,11,0.1);
  border-radius: 10px;
  border: 1px solid rgba(245,158,11,0.3);
}

.fsm-canvas {
  flex: 1;
  position: relative;
}

.fsm-flow {
  width: 100%;
  height: 100%;
}

/* Sidebar */
.fsm-sidebar {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 280px;
  background: #1a1a2e;
  border-left: 1px solid #2d2d44;
  padding: 16px;
  overflow-y: auto;
  z-index: 10;
}

.fsm-sidebar__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 14px;
  color: #e2e8f0;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #2d2d44;
}

.fsm-sidebar__close {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
}
.fsm-sidebar__close:hover { color: #e2e8f0; }

.fsm-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
  margin-top: 12px;
}

.fsm-input {
  width: 100%;
  background: #0f0f17;
  border: 1px solid #334155;
  color: #e2e8f0;
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
}
.fsm-input:focus { outline: none; border-color: #4f46e5; }
.fsm-input:disabled { opacity: 0.5; cursor: not-allowed; }

.fsm-textarea { resize: vertical; min-height: 80px; }

/* Transition animation for sidebar */
.fsm-slide-enter-active,
.fsm-slide-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.fsm-slide-enter-from,
.fsm-slide-leave-to { transform: translateX(100%); opacity: 0; }
</style>
