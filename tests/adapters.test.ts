import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryStorage, JSONFileStorage } from '../src/adapters/json-file.js'
import type { WorkflowInstance, WorkflowDefinition } from '../src/schema/types.js'
import { unlinkSync, existsSync } from 'node:fs'

const sampleInstance = (): WorkflowInstance => ({
  id: 'inst-1',
  workflowId: 'wf-a',
  currentState: 'NEW',
  status: 'active',
  context: { userId: '42' },
  history: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  label: 'test',
})

const sampleWorkflow = (): WorkflowDefinition => ({
  id: 'wf-a',
  name: 'Test Workflow',
  initialState: 'NEW',
  states: {
    NEW:  { description: 'Start', nodeType: 'start' },
    DONE: { description: 'Done',  nodeType: 'end' },
  },
  transitions: [{ id: 't1', from: 'NEW', to: 'DONE', trigger: 'host_driven' }],
})

function runStorageTests(name: string, makeStorage: () => ReturnType<typeof MemoryStorage['prototype'] extends never ? never : () => MemoryStorage>) {
  describe(name, () => {
    let storage: MemoryStorage

    beforeEach(() => { storage = makeStorage() as unknown as MemoryStorage })

    it('saves and loads an instance', async () => {
      const inst = sampleInstance()
      await storage.saveInstance(inst)
      const loaded = await storage.loadInstance(inst.id)
      expect(loaded).toMatchObject({ id: inst.id, currentState: 'NEW' })
    })

    it('returns null for missing instance', async () => {
      expect(await storage.loadInstance('ghost')).toBeNull()
    })

    it('overwrites on repeated save', async () => {
      const inst = sampleInstance()
      await storage.saveInstance(inst)
      await storage.saveInstance({ ...inst, currentState: 'DONE' })
      const loaded = await storage.loadInstance(inst.id)
      expect(loaded?.currentState).toBe('DONE')
    })

    it('deletes an instance', async () => {
      const inst = sampleInstance()
      await storage.saveInstance(inst)
      await storage.deleteInstance(inst.id)
      expect(await storage.loadInstance(inst.id)).toBeNull()
    })

    it('lists instances by workflowId', async () => {
      await storage.saveInstance({ ...sampleInstance(), id: 'a', workflowId: 'wf-a' })
      await storage.saveInstance({ ...sampleInstance(), id: 'b', workflowId: 'wf-a' })
      await storage.saveInstance({ ...sampleInstance(), id: 'c', workflowId: 'wf-b' })
      const results = await storage.listInstances('wf-a')
      expect(results.map(r => r.id)).toEqual(expect.arrayContaining(['a', 'b']))
      expect(results.map(r => r.id)).not.toContain('c')
    })

    it('filters by state', async () => {
      await storage.saveInstance({ ...sampleInstance(), id: 'a', currentState: 'NEW' })
      await storage.saveInstance({ ...sampleInstance(), id: 'b', currentState: 'DONE' })
      const results = await storage.listInstances('wf-a', { state: 'NEW' })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('a')
    })

    it('filters by status', async () => {
      await storage.saveInstance({ ...sampleInstance(), id: 'a', status: 'active' })
      await storage.saveInstance({ ...sampleInstance(), id: 'b', status: 'completed' })
      const active = await storage.listInstances('wf-a', { status: 'active' })
      expect(active.every(i => i.status === 'active')).toBe(true)
    })

    it('saves and loads a workflow definition', async () => {
      const wf = sampleWorkflow()
      await storage.saveWorkflow(wf)
      const loaded = await storage.loadWorkflow(wf.id)
      expect(loaded?.name).toBe(wf.name)
    })

    it('returns null for missing workflow', async () => {
      expect(await storage.loadWorkflow('no-such-wf')).toBeNull()
    })

    it('lists workflows', async () => {
      await storage.saveWorkflow(sampleWorkflow())
      await storage.saveWorkflow({ ...sampleWorkflow(), id: 'wf-b', name: 'Other' })
      const list = await storage.listWorkflows()
      expect(list.length).toBeGreaterThanOrEqual(2)
    })

    it('deletes a workflow', async () => {
      await storage.saveWorkflow(sampleWorkflow())
      await storage.deleteWorkflow('wf-a')
      expect(await storage.loadWorkflow('wf-a')).toBeNull()
    })
  })
}

runStorageTests('MemoryStorage', () => new MemoryStorage() as unknown as MemoryStorage)

describe('JSONFileStorage', () => {
  const path = '/tmp/ai-flower-test-storage.json'

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path)
  })

  runStorageTests('JSONFileStorage (shared tests)', () => new JSONFileStorage(path) as unknown as MemoryStorage)

  it('persists data across instances', async () => {
    const s1 = new JSONFileStorage(path)
    await s1.saveInstance(sampleInstance())

    const s2 = new JSONFileStorage(path)
    const loaded = await s2.loadInstance('inst-1')
    expect(loaded?.id).toBe('inst-1')
  })
})
