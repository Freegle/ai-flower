import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageAdapter, WorkflowInstance, WorkflowDefinition, InstanceFilter } from '../schema/types.js'

interface Store {
  instances: Record<string, WorkflowInstance>
  workflows: Record<string, WorkflowDefinition>
}

/**
 * Simple JSON file storage adapter.
 * All data lives in a single JSON file — suitable for development and
 * single-process deployments where SQLite isn't available.
 */
export class JSONFileStorage implements StorageAdapter {
  private readonly filePath: string
  private cache: Store | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private async load(): Promise<Store> {
    if (this.cache) return this.cache
    if (!existsSync(this.filePath)) {
      this.cache = { instances: {}, workflows: {} }
      return this.cache
    }
    const raw = await readFile(this.filePath, 'utf-8')
    this.cache = JSON.parse(raw) as Store
    return this.cache
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'))
    if (dir) await mkdir(dir, { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    const store = await this.load()
    store.instances[instance.id] = instance
    await this.persist()
  }

  async loadInstance(id: string): Promise<WorkflowInstance | null> {
    const store = await this.load()
    return store.instances[id] ?? null
  }

  async listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    const store = await this.load()
    let results = Object.values(store.instances).filter(i => i.workflowId === workflowId)
    if (filter?.state) results = results.filter(i => i.currentState === filter.state)
    if (filter?.status) results = results.filter(i => i.status === filter.status)
    if (filter?.label) results = results.filter(i => i.label === filter.label)
    return results
  }

  async deleteInstance(id: string): Promise<void> {
    const store = await this.load()
    delete store.instances[id]
    await this.persist()
  }

  async saveWorkflow(definition: WorkflowDefinition): Promise<void> {
    const store = await this.load()
    store.workflows[definition.id] = definition
    await this.persist()
  }

  async loadWorkflow(id: string): Promise<WorkflowDefinition | null> {
    const store = await this.load()
    return store.workflows[id] ?? null
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const store = await this.load()
    return Object.values(store.workflows)
  }

  async deleteWorkflow(id: string): Promise<void> {
    const store = await this.load()
    delete store.workflows[id]
    await this.persist()
  }
}

/**
 * In-memory storage adapter — no persistence.
 * Useful for testing and ephemeral single-call workflows.
 */
export class MemoryStorage implements StorageAdapter {
  private readonly instances = new Map<string, WorkflowInstance>()
  private readonly workflows = new Map<string, WorkflowDefinition>()

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.id, structuredClone(instance))
  }

  async loadInstance(id: string): Promise<WorkflowInstance | null> {
    const inst = this.instances.get(id)
    return inst ? structuredClone(inst) : null
  }

  async listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    let results = [...this.instances.values()].filter(i => i.workflowId === workflowId)
    if (filter?.state) results = results.filter(i => i.currentState === filter.state)
    if (filter?.status) results = results.filter(i => i.status === filter.status)
    if (filter?.label) results = results.filter(i => i.label === filter.label)
    return results.map(i => structuredClone(i))
  }

  async deleteInstance(id: string): Promise<void> {
    this.instances.delete(id)
  }

  async saveWorkflow(definition: WorkflowDefinition): Promise<void> {
    this.workflows.set(definition.id, structuredClone(definition))
  }

  async loadWorkflow(id: string): Promise<WorkflowDefinition | null> {
    const def = this.workflows.get(id)
    return def ? structuredClone(def) : null
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return [...this.workflows.values()].map(d => structuredClone(d))
  }

  async deleteWorkflow(id: string): Promise<void> {
    this.workflows.delete(id)
  }
}
