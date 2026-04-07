# ai-flower

Constrained AI workflow engine with FSM-enforced state transitions and a Vue Flow visual editor.

## What it does

ai-flower lets you define a workflow as a state machine — nodes, edges, allowed actions, and prompts. An LLM (or your own classifier) operates within that workflow, but **cannot break its rules**:

- The LLM may only propose transitions that are defined in the workflow
- The LLM may only call actions that are listed for the current state
- All decisions are validated before any action executes or state changes

Multiple workflow instances can run concurrently (one per conversation, call, or triage item).

## Two execution modes

**LLM-driven** — the engine calls Claude with a constrained system prompt. Claude proposes actions and a transition; the engine validates and executes.

```ts
await engine.processInput(instanceId, { type: 'new_message', data: { text: 'Hi!' } })
```

**Host-driven** — your own classifier (e.g. vector embeddings) decides the transition. The engine validates it is defined in the workflow and records it.

```ts
await engine.triggerTransition(instanceId, 'SCHEDULE_INFO', { confidence: 0.92 })
```

## Install

```bash
npm install github:freegle/ai-flower
```

## Quick start

```ts
import { WorkflowEngine, MemoryStorage } from 'ai-flower'
import { ClaudeAdapter } from 'ai-flower/adapters/claude'

const workflow = {
  id: 'my-workflow',
  name: 'My Workflow',
  initialState: 'START',
  states: {
    START:  { nodeType: 'start', description: 'Initial state', writeActions: ['greet'] },
    ACTIVE: { nodeType: 'agent', description: 'Active', prompt: 'Help the user.', readActions: ['lookup'] },
    DONE:   { nodeType: 'end',   description: 'Complete' },
  },
  transitions: [
    { id: 't1', from: 'START',  to: 'ACTIVE', trigger: 'llm_decision', condition: 'User greeted' },
    { id: 't2', from: 'ACTIVE', to: 'DONE',   trigger: 'llm_decision', condition: 'Task complete' },
  ],
}

const engine = new WorkflowEngine({
  workflow,
  storageAdapter: new MemoryStorage(),
  llmAdapter: new ClaudeAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }),
  actions: [
    { name: 'greet', description: 'Send greeting', handler: async (params) => { /* ... */ } },
    { name: 'lookup', description: 'Look up data', handler: async (params) => { /* ... */ } },
  ],
})

const instance = await engine.createInstance({ userId: '42' })
const result = await engine.processInput(instance.id, { type: 'message', data: { text: 'Hello' } })
```

## Vue editor

```vue
<script setup>
import { WorkflowEditor, WorkflowViewer } from 'ai-flower/vue'
</script>

<template>
  <!-- Full editable editor (saves positions, prompts, actions, transitions) -->
  <WorkflowEditor v-model="workflowDefinition" />

  <!-- Read-only viewer — highlights the active instance's current state -->
  <WorkflowViewer :definition="workflowDefinition" :active-instance="instance" />
</template>
```

Peer dependencies: `vue`, `@vue-flow/core`, `elkjs` (for auto-layout).

## Storage adapters

| Adapter | Import |
|---------|--------|
| In-memory (testing) | `import { MemoryStorage } from 'ai-flower'` |
| JSON file | `import { JSONFileStorage } from 'ai-flower'` |
| SQLite | `import { SQLiteStorage } from 'ai-flower/adapters/sqlite'` |

## Projects using ai-flower

- **Freegle Helper** — manages bulk Freegle posting conversations (LLM-driven)
- **Biznik** — AI triage dashboard (LLM-driven)
- **Answerbot** — AI phone answering service (host-driven with vector classifier)

## Workflow definition format

```json
{
  "id": "my-workflow",
  "name": "My Workflow",
  "initialState": "NEW",
  "guardrails": "Never make promises. Always be polite.",
  "states": {
    "NEW": {
      "nodeType": "start",
      "description": "Initial state",
      "writeActions": ["send_message"]
    },
    "GATHERING": {
      "nodeType": "agent",
      "description": "Gathering information",
      "prompt": "Ask the user for missing information in one message.",
      "readActions": ["get_user_info"],
      "writeActions": ["send_message"],
      "timeout": { "duration": 86400000, "toState": "TIMED_OUT" }
    }
  },
  "transitions": [
    { "id": "t1", "from": "NEW", "to": "GATHERING", "trigger": "llm_decision", "condition": "More info needed" }
  ]
}
```

## Lifecycle hooks

React to state changes without modifying the engine. All hooks are async and awaited. Errors in hooks are logged but never prevent transitions.

```ts
const engine = new WorkflowEngine({
  workflow,
  storageAdapter: new MemoryStorage(),
  hooks: {
    onInstanceCreated: async (instance) => { /* ... */ },
    onEnterState: async (instance, state, stateDef) => { /* ... */ },
    onExitState: async (instance, state) => { /* ... */ },
    onTransition: async (instance, event) => { /* ... */ },
    onInstanceCompleted: async (instance) => { /* ... */ },
  },
})
```

Hooks fire at the appropriate points in `processInput()`, `triggerTransition()`, and `forceTransition()`.

## Transition metadata

Attach domain-specific data to transitions without modifying the core schema:

```json
{
  "id": "t1",
  "from": "GREETING",
  "to": "SCHEDULE",
  "trigger": "host_driven",
  "metadata": { "type": "affirm", "priority": 1 }
}
```

Metadata flows through to `TransitionEvent` and is available in hooks and return values. `triggerTransition()` returns a `TriggerTransitionResult` with the matched `TransitionDefinition`, `TransitionEvent`, and updated instance.

## Self-transitions

Stay in the current state while recording the event and tracking how many times in a row:

```ts
// MIDDLE -> MIDDLE self-transition (defined in workflow)
const result = await engine.triggerTransition(instanceId, 'MIDDLE', { reason: 'rambling' })
console.log(result.instance.stayCount) // 1, 2, 3, ...
```

`stayCount` increments on each self-transition and resets to 0 on any real state change. Useful for retry counting, rambling detection, or any "stay here but note what happened" pattern. Self-transitions fire `onTransition` but not `onEnterState`/`onExitState`.

## Unconditional transitions

States that have only `unconditional` transitions are automatically traversed:

```json
{
  "id": "route1",
  "from": "ROUTER",
  "to": "KNOWN_CALLER",
  "trigger": "unconditional"
}
```

When an instance enters a state with unconditional transitions, the engine automatically follows the first one. This chains (up to a configurable depth limit, default 10) to support pass-through routing nodes.

## Tests

```bash
npm test
npm run test:coverage
```
