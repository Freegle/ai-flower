import { describe, it, expect, vi } from 'vitest'
import { WorkflowEngine } from '../src/engine/WorkflowEngine.js'
import type { WorkflowHooks } from '../src/engine/WorkflowEngine.js'
import { MemoryStorage } from '../src/adapters/json-file.js'
import type { WorkflowDefinition, LLMAdapter, LLMDecision } from '../src/schema/types.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeLLMAdapter(response: Partial<LLMDecision> = {}): LLMAdapter {
  const decision: LLMDecision = {
    reasoning: 'Test reasoning',
    contextUpdates: {},
    actions: [],
    proposedTransition: null,
    ...response,
  }
  return {
    call: vi.fn().mockResolvedValue(JSON.stringify(decision)),
  }
}

const basicWorkflow: WorkflowDefinition = {
  id: 'test-hooks',
  name: 'Test Hooks',
  initialState: 'START',
  states: {
    START:   { description: 'Start', nodeType: 'start' },
    MIDDLE:  { description: 'Middle', nodeType: 'agent' },
    END:     { description: 'End', nodeType: 'end' },
  },
  transitions: [
    { id: 't1', from: 'START', to: 'MIDDLE', trigger: 'host_driven', metadata: { type: 'begin' } },
    { id: 't2', from: 'MIDDLE', to: 'END', trigger: 'host_driven', metadata: { type: 'finish' } },
    { id: 't3', from: 'MIDDLE', to: 'MIDDLE', trigger: 'host_driven', label: 'self-loop' },
    { id: 't4', from: 'START', to: 'MIDDLE', trigger: 'llm_decision', condition: 'Ready to proceed' },
  ],
}

// ─── 1. Event hooks / lifecycle callbacks ────────────────────────────────────

describe('Event hooks', () => {
  it('fires onInstanceCreated when creating an instance', async () => {
    const onInstanceCreated = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onInstanceCreated },
    })
    const instance = await engine.createInstance()
    expect(onInstanceCreated).toHaveBeenCalledOnce()
    expect(onInstanceCreated.mock.calls[0][0].id).toBe(instance.id)
  })

  it('fires onExitState, onTransition, onEnterState on host-driven transition', async () => {
    const calls: string[] = []
    const hooks: WorkflowHooks = {
      onExitState: vi.fn().mockImplementation(async () => { calls.push('exit') }),
      onTransition: vi.fn().mockImplementation(async () => { calls.push('transition') }),
      onEnterState: vi.fn().mockImplementation(async () => { calls.push('enter') }),
    }
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks,
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')

    expect(calls).toEqual(['exit', 'transition', 'enter'])
    expect(hooks.onExitState).toHaveBeenCalledWith(expect.anything(), 'START')
    expect(hooks.onEnterState).toHaveBeenCalledWith(
      expect.anything(),
      'MIDDLE',
      expect.objectContaining({ description: 'Middle' })
    )
  })

  it('fires onInstanceCompleted when reaching an end state', async () => {
    const onInstanceCompleted = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onInstanceCompleted },
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')
    await engine.triggerTransition(instance.id, 'END')
    expect(onInstanceCompleted).toHaveBeenCalledOnce()
    expect(onInstanceCompleted.mock.calls[0][0].status).toBe('completed')
  })

  it('fires hooks on forceTransition', async () => {
    const onEnterState = vi.fn().mockResolvedValue(undefined)
    const onExitState = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onEnterState, onExitState },
    })
    const instance = await engine.createInstance()
    await engine.forceTransition(instance.id, 'MIDDLE', 'admin')
    expect(onExitState).toHaveBeenCalledWith(expect.anything(), 'START')
    expect(onEnterState).toHaveBeenCalledWith(expect.anything(), 'MIDDLE', expect.anything())
  })

  it('fires hooks on LLM-driven transition', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined)
    const llm = makeLLMAdapter({ proposedTransition: 'MIDDLE' })
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      llmAdapter: llm,
      hooks: { onTransition },
    })
    const instance = await engine.createInstance()
    await engine.processInput(instance.id, { type: 'msg', data: {} })
    expect(onTransition).toHaveBeenCalledOnce()
  })

  it('hook errors do not prevent the transition', async () => {
    const onEnterState = vi.fn().mockRejectedValue(new Error('hook exploded'))
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onEnterState },
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'MIDDLE')
    // Transition still completed despite hook error
    expect(result.instance.currentState).toBe('MIDDLE')
  })
})

// ─── 2. Transition metadata ─────────────────────────────────────────────────

describe('Transition metadata', () => {
  it('includes transition definition metadata in TriggerTransitionResult', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'MIDDLE')
    expect(result.transition.metadata).toEqual({ type: 'begin' })
  })

  it('merges caller metadata with transition definition metadata in events', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'MIDDLE', { confidence: 0.95 })
    const lastEvent = result.instance.history[result.instance.history.length - 1]
    expect(lastEvent.metadata).toEqual({ type: 'begin', confidence: 0.95 })
  })

  it('returns matched transition in ProcessResult for LLM-driven transitions', async () => {
    const llm = makeLLMAdapter({ proposedTransition: 'MIDDLE' })
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      llmAdapter: llm,
    })
    const instance = await engine.createInstance()
    const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
    expect(result.transition).toBeDefined()
    expect(result.transition?.from).toBe('START')
    expect(result.transition?.to).toBe('MIDDLE')
  })

  it('returns event in TriggerTransitionResult', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'MIDDLE')
    expect(result.event.fromState).toBe('START')
    expect(result.event.toState).toBe('MIDDLE')
    expect(result.event.trigger).toBe('host_driven')
  })
})

// ─── 3. Self-transitions ────────────────────────────────────────────────────

describe('Self-transitions', () => {
  it('records self-transition event in history', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')
    const result = await engine.triggerTransition(instance.id, 'MIDDLE')
    // Should stay in MIDDLE
    expect(result.instance.currentState).toBe('MIDDLE')
    // History should include: forceTransition to START (none), trigger to MIDDLE, self to MIDDLE
    const selfEvent = result.instance.history[result.instance.history.length - 1]
    expect(selfEvent.fromState).toBe('MIDDLE')
    expect(selfEvent.toState).toBe('MIDDLE')
  })

  it('increments stayCount on self-transitions', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')
    const r1 = await engine.triggerTransition(instance.id, 'MIDDLE')
    expect(r1.instance.stayCount).toBe(1)
    const r2 = await engine.triggerTransition(instance.id, 'MIDDLE')
    expect(r2.instance.stayCount).toBe(2)
  })

  it('resets stayCount on real transitions', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')
    await engine.triggerTransition(instance.id, 'MIDDLE') // stayCount=1
    const result = await engine.triggerTransition(instance.id, 'END')
    expect(result.instance.stayCount).toBe(0)
  })

  it('fires onTransition hook on self-transitions but not onEnterState/onExitState', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined)
    const onEnterState = vi.fn().mockResolvedValue(undefined)
    const onExitState = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onTransition, onEnterState, onExitState },
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'MIDDLE')

    // Reset mock counts after the real transition
    onTransition.mockClear()
    onEnterState.mockClear()
    onExitState.mockClear()

    // Now do a self-transition
    await engine.triggerTransition(instance.id, 'MIDDLE')
    expect(onTransition).toHaveBeenCalledOnce()
    expect(onEnterState).not.toHaveBeenCalled()
    expect(onExitState).not.toHaveBeenCalled()
  })

  it('initializes stayCount to 0 on new instances', async () => {
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    expect(instance.stayCount).toBe(0)
  })
})

// ─── 4. Unconditional transition processing ─────────────────────────────────

describe('Unconditional transitions', () => {
  const routingWorkflow: WorkflowDefinition = {
    id: 'routing-test',
    name: 'Routing Test',
    initialState: 'START',
    states: {
      START:   { description: 'Start', nodeType: 'start' },
      ROUTER:  { description: 'Routing node', nodeType: 'agent' },
      TARGET:  { description: 'Target state', nodeType: 'agent' },
      END:     { description: 'End', nodeType: 'end' },
    },
    transitions: [
      { id: 't1', from: 'START', to: 'ROUTER', trigger: 'host_driven' },
      { id: 't2', from: 'ROUTER', to: 'TARGET', trigger: 'unconditional', metadata: { routing: true } },
      { id: 't3', from: 'TARGET', to: 'END', trigger: 'host_driven' },
    ],
  }

  it('automatically follows unconditional transitions', async () => {
    const engine = new WorkflowEngine({
      workflow: routingWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'ROUTER')
    // Should have auto-advanced through ROUTER to TARGET
    expect(result.instance.currentState).toBe('TARGET')
  })

  it('records unconditional transitions in history', async () => {
    const engine = new WorkflowEngine({
      workflow: routingWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'ROUTER')
    // Should have two events: START->ROUTER (host_driven) and ROUTER->TARGET (unconditional)
    expect(result.instance.history).toHaveLength(2)
    expect(result.instance.history[1].trigger).toBe('unconditional')
    expect(result.instance.history[1].fromState).toBe('ROUTER')
    expect(result.instance.history[1].toState).toBe('TARGET')
  })

  it('chains multiple unconditional transitions', async () => {
    const chainWorkflow: WorkflowDefinition = {
      id: 'chain-test',
      name: 'Chain Test',
      initialState: 'START',
      states: {
        START:  { description: 'Start', nodeType: 'start' },
        PASS_A: { description: 'Pass A', nodeType: 'agent' },
        PASS_B: { description: 'Pass B', nodeType: 'agent' },
        DEST:   { description: 'Destination', nodeType: 'agent' },
        END:    { description: 'End', nodeType: 'end' },
      },
      transitions: [
        { id: 't1', from: 'START', to: 'PASS_A', trigger: 'host_driven' },
        { id: 't2', from: 'PASS_A', to: 'PASS_B', trigger: 'unconditional' },
        { id: 't3', from: 'PASS_B', to: 'DEST', trigger: 'unconditional' },
        { id: 't4', from: 'DEST', to: 'END', trigger: 'host_driven' },
      ],
    }
    const engine = new WorkflowEngine({
      workflow: chainWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'PASS_A')
    expect(result.instance.currentState).toBe('DEST')
    expect(result.instance.history).toHaveLength(3) // START->PASS_A, PASS_A->PASS_B, PASS_B->DEST
  })

  it('stops at depth limit to prevent infinite loops', async () => {
    // Create a workflow with an unconditional loop (A->B->A->B->...)
    const loopWorkflow: WorkflowDefinition = {
      id: 'loop-test',
      name: 'Loop Test',
      initialState: 'START',
      states: {
        START: { description: 'Start', nodeType: 'start' },
        LOOP_A: { description: 'Loop A', nodeType: 'agent' },
        LOOP_B: { description: 'Loop B', nodeType: 'agent' },
      },
      transitions: [
        { id: 't1', from: 'START', to: 'LOOP_A', trigger: 'host_driven' },
        { id: 't2', from: 'LOOP_A', to: 'LOOP_B', trigger: 'unconditional' },
        { id: 't3', from: 'LOOP_B', to: 'LOOP_A', trigger: 'unconditional' },
      ],
    }
    const engine = new WorkflowEngine({
      workflow: loopWorkflow,
      storageAdapter: new MemoryStorage(),
      maxUnconditionalDepth: 5,
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'LOOP_A')
    // Should stop after 5 unconditional hops, not hang
    expect(result.instance.history.length).toBeLessThanOrEqual(6) // 1 host + up to 5 unconditional
  })

  it('fires hooks for each unconditional transition', async () => {
    const onEnterState = vi.fn().mockResolvedValue(undefined)
    const onExitState = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: routingWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onEnterState, onExitState },
    })
    const instance = await engine.createInstance()
    await engine.triggerTransition(instance.id, 'ROUTER')
    // Should have been called for: enter ROUTER, exit ROUTER, enter TARGET
    // Plus exit START
    expect(onExitState).toHaveBeenCalledTimes(2) // exit START, exit ROUTER
    expect(onEnterState).toHaveBeenCalledTimes(2) // enter ROUTER, enter TARGET
  })

  it('stops at end state during unconditional chain', async () => {
    const endChainWorkflow: WorkflowDefinition = {
      id: 'end-chain',
      name: 'End Chain',
      initialState: 'START',
      states: {
        START:  { description: 'Start', nodeType: 'start' },
        PASS:   { description: 'Pass', nodeType: 'agent' },
        END:    { description: 'End', nodeType: 'end' },
      },
      transitions: [
        { id: 't1', from: 'START', to: 'PASS', trigger: 'host_driven' },
        { id: 't2', from: 'PASS', to: 'END', trigger: 'unconditional' },
      ],
    }
    const onInstanceCompleted = vi.fn().mockResolvedValue(undefined)
    const engine = new WorkflowEngine({
      workflow: endChainWorkflow,
      storageAdapter: new MemoryStorage(),
      hooks: { onInstanceCompleted },
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'PASS')
    expect(result.instance.currentState).toBe('END')
    expect(result.instance.status).toBe('completed')
    expect(onInstanceCompleted).toHaveBeenCalledOnce()
  })

  it('includes transition metadata in unconditional transition events', async () => {
    const engine = new WorkflowEngine({
      workflow: routingWorkflow,
      storageAdapter: new MemoryStorage(),
    })
    const instance = await engine.createInstance()
    const result = await engine.triggerTransition(instance.id, 'ROUTER')
    const unconditionalEvent = result.instance.history[1]
    expect(unconditionalEvent.metadata).toEqual({ routing: true })
  })
})

// ─── 5. ProcessResult transition field ──────────────────────────────────────

describe('ProcessResult.transition', () => {
  it('is undefined when LLM stays in current state', async () => {
    const llm = makeLLMAdapter({ proposedTransition: null })
    const engine = new WorkflowEngine({
      workflow: basicWorkflow,
      storageAdapter: new MemoryStorage(),
      llmAdapter: llm,
    })
    const instance = await engine.createInstance()
    const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
    expect(result.transition).toBeUndefined()
  })

  it('includes the matched transition definition with metadata', async () => {
    // Use a workflow where the LLM transition has metadata
    const wfWithMeta: WorkflowDefinition = {
      id: 'meta-llm',
      name: 'Meta LLM',
      initialState: 'A',
      states: {
        A: { description: 'A', nodeType: 'start' },
        B: { description: 'B', nodeType: 'agent' },
      },
      transitions: [
        { id: 't1', from: 'A', to: 'B', trigger: 'llm_decision', condition: 'Go', metadata: { priority: 1 } },
      ],
    }
    const llm = makeLLMAdapter({ proposedTransition: 'B' })
    const engine = new WorkflowEngine({
      workflow: wfWithMeta,
      storageAdapter: new MemoryStorage(),
      llmAdapter: llm,
    })
    const instance = await engine.createInstance()
    const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
    expect(result.transition?.id).toBe('t1')
    expect(result.transition?.metadata).toEqual({ priority: 1 })
  })
})
