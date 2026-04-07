import { describe, it, expect } from 'vitest'
import { TransitionValidator } from '../src/engine/TransitionValidator.js'
import type { WorkflowDefinition, LLMDecision } from '../src/schema/types.js'

const minimal: WorkflowDefinition = {
  id: 'test',
  name: 'Test',
  initialState: 'NEW',
  states: {
    NEW:       { description: 'New',       nodeType: 'start', writeActions: ['send_message'] },
    GATHERING: { description: 'Gathering', nodeType: 'agent', readActions: ['get_info'], writeActions: ['send_message', 'send_nudge'] },
    QUALIFIED: { description: 'Qualified', nodeType: 'agent' },
    DONE:      { description: 'Done',      nodeType: 'end' },
  },
  transitions: [
    { id: 't1', from: 'NEW',       to: 'GATHERING', trigger: 'action_taken',  action: 'send_message' },
    { id: 't2', from: 'NEW',       to: 'QUALIFIED', trigger: 'llm_decision',  condition: 'All info present' },
    { id: 't3', from: 'GATHERING', to: 'QUALIFIED', trigger: 'llm_decision',  condition: 'All info present' },
    { id: 't4', from: 'QUALIFIED', to: 'DONE',      trigger: 'host_driven' },
  ],
}

describe('TransitionValidator', () => {
  const v = new TransitionValidator(minimal)

  describe('validateDefinition', () => {
    it('accepts a valid definition', () => {
      expect(v.validateDefinition().valid).toBe(true)
    })

    it('rejects missing initialState', () => {
      const bad: WorkflowDefinition = { ...minimal, initialState: 'MISSING' }
      expect(new TransitionValidator(bad).validateDefinition().valid).toBe(false)
    })

    it('rejects transitions referencing undefined states', () => {
      const bad: WorkflowDefinition = {
        ...minimal,
        transitions: [
          ...minimal.transitions,
          { id: 'bad', from: 'GATHERING', to: 'GHOST', trigger: 'llm_decision' },
        ],
      }
      const result = new TransitionValidator(bad).validateDefinition()
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toMatch(/GHOST/)
    })

    it('rejects definition with no start node', () => {
      const bad: WorkflowDefinition = {
        ...minimal,
        states: {
          ...minimal.states,
          NEW: { ...minimal.states.NEW, nodeType: 'agent' },
        },
      }
      expect(new TransitionValidator(bad).validateDefinition().valid).toBe(false)
    })
  })

  describe('isValidTransition', () => {
    it('returns true for defined transitions', () => {
      expect(v.isValidTransition('NEW', 'GATHERING')).toBe(true)
      expect(v.isValidTransition('NEW', 'QUALIFIED')).toBe(true)
    })

    it('returns false for undefined transitions', () => {
      expect(v.isValidTransition('NEW', 'DONE')).toBe(false)
      expect(v.isValidTransition('DONE', 'NEW')).toBe(false)
    })
  })

  describe('validTransitionsFrom', () => {
    it('returns all transitions from a state', () => {
      const ts = v.validTransitionsFrom('NEW')
      expect(ts.map(t => t.to)).toEqual(expect.arrayContaining(['GATHERING', 'QUALIFIED']))
      expect(ts).toHaveLength(2)
    })

    it('returns empty array for terminal state', () => {
      expect(v.validTransitionsFrom('DONE')).toHaveLength(0)
    })
  })

  describe('validateLLMDecision', () => {
    const goodDecision: LLMDecision = {
      reasoning: 'All info gathered',
      contextUpdates: { collection_ok: true },
      actions: [{ action: 'send_message', params: { content: 'Hi' } }],
      proposedTransition: 'QUALIFIED',
    }

    it('accepts a valid decision', () => {
      expect(v.validateLLMDecision(goodDecision, 'GATHERING').valid).toBe(true)
    })

    it('accepts null proposedTransition (stay in state)', () => {
      const d: LLMDecision = { ...goodDecision, proposedTransition: null, actions: [] }
      expect(v.validateLLMDecision(d, 'GATHERING').valid).toBe(true)
    })

    it('rejects an invalid target state', () => {
      const bad: LLMDecision = { ...goodDecision, proposedTransition: 'DONE' }
      const result = v.validateLLMDecision(bad, 'GATHERING')
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('proposedTransition')
    })

    it('rejects an action not in the allowed set', () => {
      const bad: LLMDecision = {
        ...goodDecision,
        proposedTransition: null,
        actions: [{ action: 'delete_everything', params: {} }],
      }
      const result = v.validateLLMDecision(bad, 'GATHERING')
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toMatch(/delete_everything/)
    })

    it('rejects write action not allowed in current state', () => {
      // send_nudge is allowed in GATHERING but not in NEW
      const bad: LLMDecision = {
        ...goodDecision,
        proposedTransition: null,
        actions: [{ action: 'send_nudge', params: {} }],
      }
      const result = v.validateLLMDecision(bad, 'NEW')
      expect(result.valid).toBe(false)
    })

    it('allows read actions from the allowed set', () => {
      const d: LLMDecision = {
        ...goodDecision,
        proposedTransition: null,
        actions: [{ action: 'get_info', params: {} }],
      }
      expect(v.validateLLMDecision(d, 'GATHERING').valid).toBe(true)
    })

    it('reports multiple errors at once', () => {
      const bad: LLMDecision = {
        reasoning: '',
        contextUpdates: {},
        actions: [{ action: 'forbidden', params: {} }],
        proposedTransition: 'DONE',
      }
      const result = v.validateLLMDecision(bad, 'GATHERING')
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('validateHostTransition', () => {
    it('accepts a valid host transition', () => {
      expect(v.validateHostTransition('QUALIFIED', 'DONE').valid).toBe(true)
    })

    it('rejects an undefined host transition', () => {
      const result = v.validateHostTransition('NEW', 'DONE')
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toMatch(/DONE/)
    })
  })
})
