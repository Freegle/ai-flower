import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkflowEngine } from '../src/engine/WorkflowEngine.js'
import { MemoryStorage } from '../src/adapters/json-file.js'
import type { WorkflowDefinition, LLMAdapter, LLMDecision } from '../src/schema/types.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const freegleHelperWorkflow: WorkflowDefinition = {
  id: 'freegle-helper',
  name: 'Freegle Helper',
  initialState: 'NEW',
  guardrails: 'Never promise items to a replier.',
  states: {
    NEW:       { description: 'Reply received',    nodeType: 'start', writeActions: ['send_message'] },
    GATHERING: { description: 'Gathering info',    nodeType: 'agent', readActions: ['get_user_info'], writeActions: ['send_message', 'send_nudge'] },
    QUALIFIED: { description: 'Info gathered',     nodeType: 'agent' },
    ESCALATED: { description: 'Needs human input', nodeType: 'agent' },
    // GATHERING has a 1ms timeout → TIMED_OUT (used in timeout tests)
    TIMED_OUT: { description: 'No response',       nodeType: 'agent' },
    DONE:      { description: 'Complete',          nodeType: 'end' },
  },
  transitions: [
    { id: 't1', from: 'NEW',       to: 'GATHERING', trigger: 'llm_decision',  condition: 'Not all info present' },
    { id: 't2', from: 'NEW',       to: 'QUALIFIED', trigger: 'llm_decision',  condition: 'All info present' },
    { id: 't3', from: 'GATHERING', to: 'QUALIFIED', trigger: 'llm_decision',  condition: 'All info present' },
    { id: 't4', from: 'GATHERING', to: 'ESCALATED', trigger: 'llm_decision',  condition: 'Unanswerable question' },
    { id: 't5', from: 'GATHERING', to: 'TIMED_OUT', trigger: 'timeout' },
    { id: 't6', from: 'QUALIFIED', to: 'DONE',      trigger: 'host_driven' },
    { id: 't7', from: 'ESCALATED', to: 'GATHERING', trigger: 'host_driven' },
  ],
}

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

function makeEngine(llmResponse?: Partial<LLMDecision>) {
  const storage = new MemoryStorage()
  const llm = makeLLMAdapter(llmResponse)
  const engine = new WorkflowEngine({
    workflow: freegleHelperWorkflow,
    storageAdapter: storage,
    llmAdapter: llm,
  })
  engine.registerAction({
    name: 'send_message',
    description: 'Send a chat message',
    handler: vi.fn().mockResolvedValue({ sent: true }),
  })
  engine.registerAction({
    name: 'get_user_info',
    description: 'Fetch user data',
    handler: vi.fn().mockResolvedValue({ name: 'Alice', reputation: 10 }),
  })
  engine.registerAction({
    name: 'send_nudge',
    description: 'Send a nudge',
    handler: vi.fn().mockResolvedValue({ sent: true }),
  })
  return { engine, storage, llm }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  describe('constructor', () => {
    it('rejects an invalid workflow definition', () => {
      expect(() => new WorkflowEngine({
        workflow: { ...freegleHelperWorkflow, initialState: 'MISSING' },
        storageAdapter: new MemoryStorage(),
      })).toThrow(/Invalid workflow definition/)
    })

    it('accepts a valid definition', () => {
      expect(() => makeEngine()).not.toThrow()
    })
  })

  describe('createInstance', () => {
    it('creates an instance in the initial state', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance({ userId: '42' })
      expect(instance.currentState).toBe('NEW')
      expect(instance.context.userId).toBe('42')
      expect(instance.status).toBe('active')
      expect(instance.history).toHaveLength(0)
    })

    it('persists the instance', async () => {
      const { engine, storage } = makeEngine()
      const instance = await engine.createInstance()
      const loaded = await storage.loadInstance(instance.id)
      expect(loaded?.id).toBe(instance.id)
    })

    it('stores a label when provided', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance({}, 'chat-123')
      expect(instance.label).toBe('chat-123')
    })
  })

  describe('processInput — LLM-driven mode', () => {
    it('throws if no llmAdapter configured', async () => {
      const engine = new WorkflowEngine({
        workflow: freegleHelperWorkflow,
        storageAdapter: new MemoryStorage(),
        // no llmAdapter
      })
      const instance = await engine.createInstance()
      await expect(engine.processInput(instance.id, { type: 'msg', data: {} }))
        .rejects.toThrow(/llmAdapter is required/)
    })

    it('calls the LLM with system + user prompts', async () => {
      const { engine, llm } = makeEngine({ proposedTransition: null })
      const instance = await engine.createInstance()
      await engine.processInput(instance.id, { type: 'message', data: { text: 'Hi' } })
      expect(llm.call).toHaveBeenCalledOnce()
      const [system, user] = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(system).toContain('NEW')
      expect(system).toContain('Never promise items')  // guardrails
      expect(system).toContain('send_message')         // allowed write action
      expect(user).toContain('message')                // input type
    })

    it('transitions state when LLM proposes valid transition', async () => {
      const { engine } = makeEngine({ proposedTransition: 'GATHERING' })
      const instance = await engine.createInstance()
      const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
      expect(result.transitioned).toBe(true)
      expect(result.newState).toBe('GATHERING')
      expect(result.instance.currentState).toBe('GATHERING')
    })

    it('stays in state when LLM returns null transition', async () => {
      const { engine } = makeEngine({ proposedTransition: null })
      const instance = await engine.createInstance()
      const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
      expect(result.transitioned).toBe(false)
      expect(result.instance.currentState).toBe('NEW')
    })

    it('executes allowed actions and includes results in context', async () => {
      const { engine } = makeEngine({
        proposedTransition: 'GATHERING',
        actions: [{ action: 'send_message', params: { content: 'Hello!' } }],
        contextUpdates: { message_sent: true },
      })
      const instance = await engine.createInstance()
      const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
      expect(result.actionsExecuted).toHaveLength(1)
      expect(result.actionsExecuted[0].action).toBe('send_message')
      expect(result.instance.context.message_sent).toBe(true)
    })

    it('records transition in history', async () => {
      const { engine } = makeEngine({ proposedTransition: 'GATHERING' })
      const instance = await engine.createInstance()
      await engine.processInput(instance.id, { type: 'msg', data: {} })
      const updated = await engine.getInstance(instance.id)
      expect(updated.history).toHaveLength(1)
      expect(updated.history[0].fromState).toBe('NEW')
      expect(updated.history[0].toState).toBe('GATHERING')
      expect(updated.history[0].trigger).toBe('llm_decision')
    })

    it('rejects invalid LLM transition and marks instance as error', async () => {
      const { engine } = makeEngine({ proposedTransition: 'DONE' }) // DONE not reachable from NEW
      const instance = await engine.createInstance()
      await expect(engine.processInput(instance.id, { type: 'msg', data: {} }))
        .rejects.toThrow()
      const errored = await engine.getInstance(instance.id)
      expect(errored.status).toBe('error')
    })

    it('retries once on invalid LLM response then fails', async () => {
      const storage = new MemoryStorage()
      const callCount = { n: 0 }
      const llm: LLMAdapter = {
        call: vi.fn().mockImplementation(async () => {
          callCount.n++
          return 'not json at all }'
        }),
      }
      const engine = new WorkflowEngine({
        workflow: freegleHelperWorkflow,
        storageAdapter: storage,
        llmAdapter: llm,
        maxLLMRetries: 1,
      })
      const instance = await engine.createInstance()
      await expect(engine.processInput(instance.id, { type: 'msg', data: {} })).rejects.toThrow()
      expect(callCount.n).toBe(2) // initial + 1 retry
    })

    it('marks instance as completed when transitioning to end state', async () => {
      // Need a workflow where we can reach DONE from initial
      const simpleWf: WorkflowDefinition = {
        id: 'simple',
        name: 'Simple',
        initialState: 'START',
        states: {
          START: { description: 'Start', nodeType: 'start' },
          DONE:  { description: 'Done',  nodeType: 'end' },
        },
        transitions: [{ id: 't1', from: 'START', to: 'DONE', trigger: 'llm_decision' }],
      }
      const storage = new MemoryStorage()
      const llm = makeLLMAdapter({ proposedTransition: 'DONE' })
      const engine = new WorkflowEngine({ workflow: simpleWf, storageAdapter: storage, llmAdapter: llm })
      const instance = await engine.createInstance()
      const result = await engine.processInput(instance.id, { type: 'msg', data: {} })
      expect(result.instance.status).toBe('completed')
    })
  })

  describe('triggerTransition — host-driven mode', () => {
    it('transitions to a valid target state', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      // Move to QUALIFIED first via force
      await engine.forceTransition(instance.id, 'QUALIFIED', 'test setup')
      const result = await engine.triggerTransition(instance.id, 'DONE')
      expect(result.instance.currentState).toBe('DONE')
      expect(result.instance.status).toBe('completed')
    })

    it('rejects undefined transitions', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      await expect(engine.triggerTransition(instance.id, 'DONE'))
        .rejects.toThrow(/not defined/)
    })

    it('records trigger metadata in history', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      await engine.forceTransition(instance.id, 'QUALIFIED', 'setup')
      const result = await engine.triggerTransition(instance.id, 'DONE', { confidence: 0.92, classifier: 'vector' })
      const lastEvent = result.instance.history[result.instance.history.length - 1]
      expect(lastEvent.trigger).toBe('host_driven')
      expect(lastEvent.metadata?.confidence).toBe(0.92)
    })

    it('throws if instance is not active', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      await engine.setStatus(instance.id, 'paused')
      await expect(engine.triggerTransition(instance.id, 'GATHERING'))
        .rejects.toThrow(/not active/)
    })
  })

  describe('forceTransition', () => {
    it('transitions to any defined state regardless of FSM rules', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      // NEW → DONE is not a defined transition, but force allows it
      const updated = await engine.forceTransition(instance.id, 'DONE', 'admin override')
      expect(updated.currentState).toBe('DONE')
      expect(updated.status).toBe('completed')
    })

    it('records the override in history', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      await engine.forceTransition(instance.id, 'QUALIFIED', 'admin skip')
      const updated = await engine.getInstance(instance.id)
      expect(updated.history[0].metadata?.forced).toBe(true)
      expect(updated.history[0].metadata?.reason).toBe('admin skip')
    })

    it('rejects undefined states', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance()
      await expect(engine.forceTransition(instance.id, 'GHOST', 'test'))
        .rejects.toThrow(/not defined/)
    })
  })

  describe('processTimeouts', () => {
    it('transitions instances whose timeout has elapsed', async () => {
      // Build a workflow where GATHERING has a 1ms timeout → TIMED_OUT
      const wf: WorkflowDefinition = {
        ...freegleHelperWorkflow,
        states: {
          ...freegleHelperWorkflow.states,
          GATHERING: { ...freegleHelperWorkflow.states.GATHERING, timeout: { duration: 1, toState: 'TIMED_OUT' } },
        },
      }
      const storage = new MemoryStorage()
      const engine = new WorkflowEngine({ workflow: wf, storageAdapter: storage })
      const instance = await engine.createInstance()
      await engine.forceTransition(instance.id, 'GATHERING', 'setup')
      // Wait for the 1ms timeout to expire
      await new Promise(r => setTimeout(r, 10))
      const processed = await engine.processTimeouts()
      expect(processed).toHaveLength(1)
      expect(processed[0].currentState).toBe('TIMED_OUT')
    })

    it('does not touch instances whose timeout has not elapsed', async () => {
      const wf: WorkflowDefinition = {
        ...freegleHelperWorkflow,
        states: {
          ...freegleHelperWorkflow.states,
          GATHERING: {
            ...freegleHelperWorkflow.states.GATHERING,
            timeout: { duration: 9_999_999, toState: 'TIMED_OUT' },
          },
        },
      }
      const storage = new MemoryStorage()
      const engine = new WorkflowEngine({ workflow: wf, storageAdapter: storage })
      const instance = await engine.createInstance()
      await engine.forceTransition(instance.id, 'GATHERING', 'setup')
      const processed = await engine.processTimeouts()
      expect(processed.find(i => i.id === instance.id)).toBeUndefined()
    })
  })

  describe('updateContext', () => {
    it('merges updates into existing context', async () => {
      const { engine } = makeEngine()
      const instance = await engine.createInstance({ a: 1, b: 2 })
      const updated = await engine.updateContext(instance.id, { b: 99, c: 3 })
      expect(updated.context).toMatchObject({ a: 1, b: 99, c: 3 })
    })
  })

  describe('listInstances', () => {
    it('returns instances for this workflow only', async () => {
      const { engine } = makeEngine()
      await engine.createInstance({}, 'i1')
      await engine.createInstance({}, 'i2')
      const all = await engine.listInstances()
      expect(all).toHaveLength(2)
    })

    it('filters by state', async () => {
      const { engine } = makeEngine()
      const i1 = await engine.createInstance()
      await engine.createInstance()
      await engine.forceTransition(i1.id, 'GATHERING', 'test')
      const gathering = await engine.listInstances({ state: 'GATHERING' })
      expect(gathering).toHaveLength(1)
      expect(gathering[0].id).toBe(i1.id)
    })
  })
})
