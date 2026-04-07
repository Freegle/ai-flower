import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
/**
 * Simple JSON file storage adapter.
 * All data lives in a single JSON file — suitable for development and
 * single-process deployments where SQLite isn't available.
 */
export class JSONFileStorage {
    filePath;
    cache = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        if (this.cache)
            return this.cache;
        if (!existsSync(this.filePath)) {
            this.cache = { instances: {}, workflows: {} };
            return this.cache;
        }
        const raw = await readFile(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw);
        return this.cache;
    }
    async persist() {
        if (!this.cache)
            return;
        const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
        if (dir)
            await mkdir(dir, { recursive: true });
        await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    }
    async saveInstance(instance) {
        const store = await this.load();
        store.instances[instance.id] = instance;
        await this.persist();
    }
    async loadInstance(id) {
        const store = await this.load();
        return store.instances[id] ?? null;
    }
    async listInstances(workflowId, filter) {
        const store = await this.load();
        let results = Object.values(store.instances).filter(i => i.workflowId === workflowId);
        if (filter?.state)
            results = results.filter(i => i.currentState === filter.state);
        if (filter?.status)
            results = results.filter(i => i.status === filter.status);
        if (filter?.label)
            results = results.filter(i => i.label === filter.label);
        return results;
    }
    async deleteInstance(id) {
        const store = await this.load();
        delete store.instances[id];
        await this.persist();
    }
    async saveWorkflow(definition) {
        const store = await this.load();
        store.workflows[definition.id] = definition;
        await this.persist();
    }
    async loadWorkflow(id) {
        const store = await this.load();
        return store.workflows[id] ?? null;
    }
    async listWorkflows() {
        const store = await this.load();
        return Object.values(store.workflows);
    }
    async deleteWorkflow(id) {
        const store = await this.load();
        delete store.workflows[id];
        await this.persist();
    }
}
/**
 * In-memory storage adapter — no persistence.
 * Useful for testing and ephemeral single-call workflows.
 */
export class MemoryStorage {
    instances = new Map();
    workflows = new Map();
    async saveInstance(instance) {
        this.instances.set(instance.id, structuredClone(instance));
    }
    async loadInstance(id) {
        const inst = this.instances.get(id);
        return inst ? structuredClone(inst) : null;
    }
    async listInstances(workflowId, filter) {
        let results = [...this.instances.values()].filter(i => i.workflowId === workflowId);
        if (filter?.state)
            results = results.filter(i => i.currentState === filter.state);
        if (filter?.status)
            results = results.filter(i => i.status === filter.status);
        if (filter?.label)
            results = results.filter(i => i.label === filter.label);
        return results.map(i => structuredClone(i));
    }
    async deleteInstance(id) {
        this.instances.delete(id);
    }
    async saveWorkflow(definition) {
        this.workflows.set(definition.id, structuredClone(definition));
    }
    async loadWorkflow(id) {
        const def = this.workflows.get(id);
        return def ? structuredClone(def) : null;
    }
    async listWorkflows() {
        return [...this.workflows.values()].map(d => structuredClone(d));
    }
    async deleteWorkflow(id) {
        this.workflows.delete(id);
    }
}
//# sourceMappingURL=json-file.js.map