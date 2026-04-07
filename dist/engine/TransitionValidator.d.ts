import type { WorkflowDefinition, TransitionDefinition, LLMDecision } from '../schema/types.js';
export interface ValidationError {
    field: string;
    message: string;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
/**
 * Enforces the FSM constraints defined in the workflow.
 * The LLM cannot break these rules — invalid proposals are rejected here
 * before any state change or action execution occurs.
 */
export declare class TransitionValidator {
    private readonly workflow;
    constructor(workflow: WorkflowDefinition);
    /**
     * Return all transitions that are valid from the given state.
     */
    validTransitionsFrom(stateId: string): TransitionDefinition[];
    /**
     * Check whether a specific transition (from → to) is defined in the workflow.
     */
    isValidTransition(fromState: string, toState: string): boolean;
    /**
     * Validate the full LLMDecision object returned by the LLM.
     * Checks:
     *   - proposed transition is valid from the current state (or null)
     *   - all requested actions are in the state's allowed action lists
     */
    validateLLMDecision(decision: LLMDecision, currentState: string): ValidationResult;
    /**
     * Validate a host-driven transition (Answerbot mode).
     * The engine can't validate the caller's reasoning, but it CAN enforce
     * that the transition itself is defined in the workflow.
     */
    validateHostTransition(fromState: string, toState: string): ValidationResult;
    /**
     * Validate the workflow definition itself (call when loading a definition).
     */
    validateDefinition(): ValidationResult;
}
//# sourceMappingURL=TransitionValidator.d.ts.map