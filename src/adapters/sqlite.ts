import type { StorageAdapter, WorkflowInstance, WorkflowDefinition, InstanceFilter } from '../schema/types.js'

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

// better-sqlite3 types (inlined to avoid hard dep)
interface BetterSQLiteDatabase {
  prepare(sql: string): BetterSQLiteStatement
  exec(sql: string): void
}
interface BetterSQLiteStatement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export class SQLiteStorage implements StorageAdapter {
  constructor(private readonly db: BetterSQLiteDatabase) {
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_fsm_instances (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        current_state TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        context TEXT NOT NULL DEFAULT '{}',
        history TEXT NOT NULL DEFAULT '[]',
        label TEXT,
        timeout_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_llm_fsm_instances_workflow
        ON llm_fsm_instances (workflow_id, status);

      CREATE TABLE IF NOT EXISTS llm_fsm_workflows (
        id TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    this.db.prepare(`
      INSERT INTO llm_fsm_instances
        (id, workflow_id, current_state, status, context, history, label, timeout_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_state = excluded.current_state,
        status        = excluded.status,
        context       = excluded.context,
        history       = excluded.history,
        label         = excluded.label,
        timeout_at    = excluded.timeout_at,
        updated_at    = excluded.updated_at
    `).run(
      instance.id,
      instance.workflowId,
      instance.currentState,
      instance.status,
      JSON.stringify(instance.context),
      JSON.stringify(instance.history),
      instance.label ?? null,
      instance.timeoutAt ?? null,
      instance.createdAt,
      instance.updatedAt,
    )
  }

  async loadInstance(id: string): Promise<WorkflowInstance | null> {
    const row = this.db.prepare(
      `SELECT * FROM llm_fsm_instances WHERE id = ?`
    ).get(id) as Record<string, unknown> | undefined

    return row ? this.rowToInstance(row) : null
  }

  async listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    let sql = `SELECT * FROM llm_fsm_instances WHERE workflow_id = ?`
    const params: unknown[] = [workflowId]

    if (filter?.status) {
      sql += ` AND status = ?`
      params.push(filter.status)
    }
    if (filter?.state) {
      sql += ` AND current_state = ?`
      params.push(filter.state)
    }
    if (filter?.label) {
      sql += ` AND label = ?`
      params.push(filter.label)
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(r => this.rowToInstance(r))
  }

  async deleteInstance(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM llm_fsm_instances WHERE id = ?`).run(id)
  }

  async saveWorkflow(definition: WorkflowDefinition): Promise<void> {
    this.db.prepare(`
      INSERT INTO llm_fsm_workflows (id, definition, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        definition = excluded.definition,
        updated_at = excluded.updated_at
    `).run(definition.id, JSON.stringify(definition), new Date().toISOString())
  }

  async loadWorkflow(id: string): Promise<WorkflowDefinition | null> {
    const row = this.db.prepare(
      `SELECT definition FROM llm_fsm_workflows WHERE id = ?`
    ).get(id) as { definition: string } | undefined
    return row ? JSON.parse(row.definition) as WorkflowDefinition : null
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const rows = this.db.prepare(
      `SELECT definition FROM llm_fsm_workflows`
    ).all() as { definition: string }[]
    return rows.map(r => JSON.parse(r.definition) as WorkflowDefinition)
  }

  async deleteWorkflow(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM llm_fsm_workflows WHERE id = ?`).run(id)
  }

  private rowToInstance(row: Record<string, unknown>): WorkflowInstance {
    return {
      id: row.id as string,
      workflowId: row.workflow_id as string,
      currentState: row.current_state as string,
      status: row.status as WorkflowInstance['status'],
      context: JSON.parse(row.context as string),
      history: JSON.parse(row.history as string),
      label: row.label as string | undefined,
      timeoutAt: row.timeout_at as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }
}
