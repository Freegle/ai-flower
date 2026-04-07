import { describe, it, expect, vi } from 'vitest'
import { ActionRegistry } from '../src/engine/ActionRegistry.js'
import type { ActionDefinition } from '../src/schema/types.js'

function makeAction(name: string, result: unknown = 'ok'): ActionDefinition {
  return {
    name,
    description: `${name} action`,
    handler: vi.fn().mockResolvedValue(result),
  }
}

describe('ActionRegistry', () => {
  describe('register', () => {
    it('registers an action', () => {
      const r = new ActionRegistry()
      r.register(makeAction('foo'))
      expect(r.has('foo')).toBe(true)
    })

    it('throws on duplicate registration', () => {
      const r = new ActionRegistry()
      r.register(makeAction('foo'))
      expect(() => r.register(makeAction('foo'))).toThrow(/already registered/)
    })

    it('registerAll registers multiple actions', () => {
      const r = new ActionRegistry()
      r.registerAll([makeAction('a'), makeAction('b'), makeAction('c')])
      expect(r.has('a')).toBe(true)
      expect(r.has('b')).toBe(true)
      expect(r.has('c')).toBe(true)
    })
  })

  describe('execute', () => {
    it('calls handler with params and context', async () => {
      const handler = vi.fn().mockResolvedValue(42)
      const r = new ActionRegistry()
      r.register({ name: 'compute', description: '', handler })

      const ctx = { userId: 'abc' }
      const result = await r.execute('compute', { x: 1 }, ctx)

      expect(handler).toHaveBeenCalledWith({ x: 1 }, ctx)
      expect(result.result).toBe(42)
      expect(result.error).toBeUndefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('catches handler errors and returns them in the result', async () => {
      const r = new ActionRegistry()
      r.register({
        name: 'boom',
        description: '',
        handler: async () => { throw new Error('kaboom') },
      })
      const result = await r.execute('boom', {}, {})
      expect(result.error).toBe('kaboom')
      expect(result.result).toBeUndefined()
    })

    it('returns error for unknown action', async () => {
      const r = new ActionRegistry()
      const result = await r.execute('ghost', {}, {})
      expect(result.error).toMatch(/not registered/)
    })
  })

  describe('executeAll', () => {
    it('executes actions in sequence', async () => {
      const order: string[] = []
      const r = new ActionRegistry()
      r.register({ name: 'first',  description: '', handler: async () => { order.push('first');  return 1 } })
      r.register({ name: 'second', description: '', handler: async () => { order.push('second'); return 2 } })

      const results = await r.executeAll(
        [{ action: 'first', params: {} }, { action: 'second', params: {} }],
        {}
      )

      expect(order).toEqual(['first', 'second'])
      expect(results[0].result).toBe(1)
      expect(results[1].result).toBe(2)
    })

    it('continues executing after a failure', async () => {
      const r = new ActionRegistry()
      r.register({ name: 'fail', description: '', handler: async () => { throw new Error('fail') } })
      r.register({ name: 'ok',   description: '', handler: async () => 'success' })

      const results = await r.executeAll(
        [{ action: 'fail', params: {} }, { action: 'ok', params: {} }],
        {}
      )
      expect(results[0].error).toBe('fail')
      expect(results[1].result).toBe('success')
    })
  })

  describe('describeActions', () => {
    it('lists registered action descriptions', () => {
      const r = new ActionRegistry()
      r.register({ name: 'get_user', description: 'Fetch user by ID', handler: async () => null })
      const desc = r.describeActions(['get_user'])
      expect(desc).toContain('get_user')
      expect(desc).toContain('Fetch user by ID')
    })

    it('marks unregistered actions', () => {
      const r = new ActionRegistry()
      const desc = r.describeActions(['missing_action'])
      expect(desc).toContain('not registered')
    })
  })
})
