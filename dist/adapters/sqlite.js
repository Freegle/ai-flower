export class SQLiteStorage {
    db;
    constructor(db) {
        this.db = db;
        this.migrate();
    }
    migrate() {
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
    `);
    }
    async saveInstance(instance) {
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
    `).run(instance.id, instance.workflowId, instance.currentState, instance.status, JSON.stringify(instance.context), JSON.stringify(instance.history), instance.label ?? null, instance.timeoutAt ?? null, instance.createdAt, instance.updatedAt);
    }
    async loadInstance(id) {
        const row = this.db.prepare(`SELECT * FROM llm_fsm_instances WHERE id = ?`).get(id);
        return row ? this.rowToInstance(row) : null;
    }
    async listInstances(workflowId, filter) {
        let sql = `SELECT * FROM llm_fsm_instances WHERE workflow_id = ?`;
        const params = [workflowId];
        if (filter?.status) {
            sql += ` AND status = ?`;
            params.push(filter.status);
        }
        if (filter?.state) {
            sql += ` AND current_state = ?`;
            params.push(filter.state);
        }
        if (filter?.label) {
            sql += ` AND label = ?`;
            params.push(filter.label);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this.rowToInstance(r));
    }
    async deleteInstance(id) {
        this.db.prepare(`DELETE FROM llm_fsm_instances WHERE id = ?`).run(id);
    }
    async saveWorkflow(definition) {
        this.db.prepare(`
      INSERT INTO llm_fsm_workflows (id, definition, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        definition = excluded.definition,
        updated_at = excluded.updated_at
    `).run(definition.id, JSON.stringify(definition), new Date().toISOString());
    }
    async loadWorkflow(id) {
        const row = this.db.prepare(`SELECT definition FROM llm_fsm_workflows WHERE id = ?`).get(id);
        return row ? JSON.parse(row.definition) : null;
    }
    async listWorkflows() {
        const rows = this.db.prepare(`SELECT definition FROM llm_fsm_workflows`).all();
        return rows.map(r => JSON.parse(r.definition));
    }
    async deleteWorkflow(id) {
        this.db.prepare(`DELETE FROM llm_fsm_workflows WHERE id = ?`).run(id);
    }
    rowToInstance(row) {
        return {
            id: row.id,
            workflowId: row.workflow_id,
            currentState: row.current_state,
            status: row.status,
            context: JSON.parse(row.context),
            history: JSON.parse(row.history),
            label: row.label,
            timeoutAt: row.timeout_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=sqlite.js.map