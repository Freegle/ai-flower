import type { WorkflowDefinition, WorkflowInstance, WorkflowInput } from '../schema/types.js';
import type { ActionRegistry } from './ActionRegistry.js';
import type { TransitionValidator } from './TransitionValidator.js';
/**
 * Builds the constrained system prompt sent to the LLM.
 * The LLM cannot see or modify this construction — it only receives the
 * finished string. The prompt hard-codes exactly which actions are callable
 * and which transitions are valid, making it impossible for the LLM to
 * escape the FSM constraints.
 */
export declare class PromptBuilder {
    private readonly workflow;
    private readonly registry;
    private readonly validator;
    constructor(workflow: WorkflowDefinition, registry: ActionRegistry, validator: TransitionValidator);
    build(instance: WorkflowInstance, input: WorkflowInput): {
        system: string;
        user: string;
    };
}
//# sourceMappingURL=PromptBuilder.d.ts.map