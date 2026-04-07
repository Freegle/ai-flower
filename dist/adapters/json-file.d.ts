import type { StorageAdapter, WorkflowInstance, WorkflowDefinition, InstanceFilter } from '../schema/types.js';
/**
 * Simple JSON file storage adapter.
 * All data lives in a single JSON file — suitable for development and
 * single-process deployments where SQLite isn't available.
 */
export declare class JSONFileStorage implements StorageAdapter {
    private readonly filePath;
    private cache;
    constructor(filePath: string);
    private load;
    private persist;
    saveInstance(instance: WorkflowInstance): Promise<void>;
    loadInstance(id: string): Promise<WorkflowInstance | null>;
    listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]>;
    deleteInstance(id: string): Promise<void>;
    saveWorkflow(definition: WorkflowDefinition): Promise<void>;
    loadWorkflow(id: string): Promise<WorkflowDefinition | null>;
    listWorkflows(): Promise<WorkflowDefinition[]>;
    deleteWorkflow(id: string): Promise<void>;
}
/**
 * In-memory storage adapter — no persistence.
 * Useful for testing and ephemeral single-call workflows.
 */
export declare class MemoryStorage implements StorageAdapter {
    private readonly instances;
    private readonly workflows;
    saveInstance(instance: WorkflowInstance): Promise<void>;
    loadInstance(id: string): Promise<WorkflowInstance | null>;
    listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]>;
    deleteInstance(id: string): Promise<void>;
    saveWorkflow(definition: WorkflowDefinition): Promise<void>;
    loadWorkflow(id: string): Promise<WorkflowDefinition | null>;
    listWorkflows(): Promise<WorkflowDefinition[]>;
    deleteWorkflow(id: string): Promise<void>;
}
//# sourceMappingURL=json-file.d.ts.map