import type { ActionDefinition, ExecutedAction } from '../schema/types.js';
/**
 * Registers actions and sandboxes their execution.
 * The LLM can only call actions by name — it never has direct access to the
 * handler functions. The registry is the only entry point.
 */
export declare class ActionRegistry {
    private readonly actions;
    /**
     * Register a named action.
     * @param definition - Action definition including the handler function
     */
    register(definition: ActionDefinition): void;
    /**
     * Register multiple actions at once.
     */
    registerAll(definitions: ActionDefinition[]): void;
    has(name: string): boolean;
    getDefinition(name: string): ActionDefinition | undefined;
    /**
     * Returns a summary of registered actions suitable for inclusion in
     * the LLM system prompt.
     */
    describeActions(names: string[]): string;
    /**
     * Execute an action by name, returning the result and timing info.
     * Errors are caught and returned in the ExecutedAction record rather than thrown,
     * so a single failing action doesn't abort the entire LLM decision.
     */
    execute(name: string, params: Record<string, unknown>, context: Readonly<Record<string, unknown>>): Promise<ExecutedAction>;
    /**
     * Execute multiple actions in sequence, accumulating results.
     * Returns all results even if some fail.
     */
    executeAll(requests: Array<{
        action: string;
        params: Record<string, unknown>;
    }>, context: Readonly<Record<string, unknown>>): Promise<ExecutedAction[]>;
}
//# sourceMappingURL=ActionRegistry.d.ts.map