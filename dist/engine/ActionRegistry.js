/**
 * Registers actions and sandboxes their execution.
 * The LLM can only call actions by name — it never has direct access to the
 * handler functions. The registry is the only entry point.
 */
export class ActionRegistry {
    actions = new Map();
    /**
     * Register a named action.
     * @param definition - Action definition including the handler function
     */
    register(definition) {
        if (this.actions.has(definition.name)) {
            throw new Error(`Action '${definition.name}' is already registered`);
        }
        this.actions.set(definition.name, definition);
    }
    /**
     * Register multiple actions at once.
     */
    registerAll(definitions) {
        for (const def of definitions) {
            this.register(def);
        }
    }
    has(name) {
        return this.actions.has(name);
    }
    getDefinition(name) {
        return this.actions.get(name);
    }
    /**
     * Returns a summary of registered actions suitable for inclusion in
     * the LLM system prompt.
     */
    describeActions(names) {
        return names
            .map(name => {
            const def = this.actions.get(name);
            if (!def)
                return `- ${name}: (not registered)`;
            const schema = def.paramsSchema
                ? ` | params: ${JSON.stringify(def.paramsSchema)}`
                : '';
            return `- ${name}: ${def.description}${schema}`;
        })
            .join('\n');
    }
    /**
     * Execute an action by name, returning the result and timing info.
     * Errors are caught and returned in the ExecutedAction record rather than thrown,
     * so a single failing action doesn't abort the entire LLM decision.
     */
    async execute(name, params, context) {
        const def = this.actions.get(name);
        const start = Date.now();
        if (!def) {
            return {
                action: name,
                params,
                error: `Action '${name}' is not registered`,
                durationMs: Date.now() - start,
            };
        }
        try {
            const result = await def.handler(params, context);
            return {
                action: name,
                params,
                result,
                durationMs: Date.now() - start,
            };
        }
        catch (err) {
            return {
                action: name,
                params,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        }
    }
    /**
     * Execute multiple actions in sequence, accumulating results.
     * Returns all results even if some fail.
     */
    async executeAll(requests, context) {
        const results = [];
        for (const req of requests) {
            results.push(await this.execute(req.action, req.params, context));
        }
        return results;
    }
}
//# sourceMappingURL=ActionRegistry.js.map