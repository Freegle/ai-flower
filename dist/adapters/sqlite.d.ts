import type { StorageAdapter, WorkflowInstance, WorkflowDefinition, InstanceFilter } from '../schema/types.js';
/**
 * SQLite storage adapter using better-sqlite3.
 * better-sqlite3 is synchronous — we wrap in Promises for interface compat.
 *
 * Usage:
 *   import Database from 'better-sqlite3'
 *   import { SQLiteStorage } from 'llm-fsm/adapters/sqlite'
 *   const db = new Database('state.db')
 *   const storage = new SQLiteStorage(db)
 */
interface BetterSQLiteDatabase {
    prepare(sql: string): BetterSQLiteStatement;
    exec(sql: string): void;
}
interface BetterSQLiteStatement {
    run(...params: unknown[]): {
        changes: number;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
export declare class SQLiteStorage implements StorageAdapter {
    private readonly db;
    constructor(db: BetterSQLiteDatabase);
    private migrate;
    saveInstance(instance: WorkflowInstance): Promise<void>;
    loadInstance(id: string): Promise<WorkflowInstance | null>;
    listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]>;
    deleteInstance(id: string): Promise<void>;
    saveWorkflow(definition: WorkflowDefinition): Promise<void>;
    loadWorkflow(id: string): Promise<WorkflowDefinition | null>;
    listWorkflows(): Promise<WorkflowDefinition[]>;
    deleteWorkflow(id: string): Promise<void>;
    private rowToInstance;
}
export {};
//# sourceMappingURL=sqlite.d.ts.map