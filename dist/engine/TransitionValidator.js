/**
 * Enforces the FSM constraints defined in the workflow.
 * The LLM cannot break these rules — invalid proposals are rejected here
 * before any state change or action execution occurs.
 */
export class TransitionValidator {
    workflow;
    constructor(workflow) {
        this.workflow = workflow;
    }
    /**
     * Return all transitions that are valid from the given state.
     */
    validTransitionsFrom(stateId) {
        return this.workflow.transitions.filter(t => t.from === stateId);
    }
    /**
     * Check whether a specific transition (from → to) is defined in the workflow.
     */
    isValidTransition(fromState, toState) {
        return this.workflow.transitions.some(t => t.from === fromState && t.to === toState);
    }
    /**
     * Validate the full LLMDecision object returned by the LLM.
     * Checks:
     *   - proposed transition is valid from the current state (or null)
     *   - all requested actions are in the state's allowed action lists
     */
    validateLLMDecision(decision, currentState) {
        const errors = [];
        const stateDef = this.workflow.states[currentState];
        if (!stateDef) {
            return {
                valid: false,
                errors: [{ field: 'currentState', message: `State '${currentState}' not found in workflow definition` }],
            };
        }
        // Validate proposed transition
        if (decision.proposedTransition !== null) {
            if (!this.isValidTransition(currentState, decision.proposedTransition)) {
                const valid = this.validTransitionsFrom(currentState).map(t => t.to);
                errors.push({
                    field: 'proposedTransition',
                    message: `Transition from '${currentState}' to '${decision.proposedTransition}' is not defined. Valid targets: [${valid.join(', ')}]`,
                });
            }
        }
        // Validate requested actions
        const allowedRead = stateDef.readActions ?? [];
        const allowedWrite = stateDef.writeActions ?? [];
        const allowed = new Set([...allowedRead, ...allowedWrite]);
        for (const { action } of decision.actions) {
            if (!allowed.has(action)) {
                errors.push({
                    field: `actions[${action}]`,
                    message: `Action '${action}' is not allowed in state '${currentState}'. Allowed: [${[...allowed].join(', ')}]`,
                });
            }
        }
        return { valid: errors.length === 0, errors };
    }
    /**
     * Validate a host-driven transition (Answerbot mode).
     * The engine can't validate the caller's reasoning, but it CAN enforce
     * that the transition itself is defined in the workflow.
     */
    validateHostTransition(fromState, toState) {
        if (this.isValidTransition(fromState, toState)) {
            return { valid: true, errors: [] };
        }
        const valid = this.validTransitionsFrom(fromState).map(t => t.to);
        return {
            valid: false,
            errors: [{
                    field: 'toState',
                    message: `Transition from '${fromState}' to '${toState}' is not defined in the workflow. Valid targets: [${valid.join(', ')}]`,
                }],
        };
    }
    /**
     * Validate the workflow definition itself (call when loading a definition).
     */
    validateDefinition() {
        const errors = [];
        const stateIds = new Set(Object.keys(this.workflow.states));
        // initialState must exist
        if (!stateIds.has(this.workflow.initialState)) {
            errors.push({
                field: 'initialState',
                message: `initialState '${this.workflow.initialState}' is not defined in states`,
            });
        }
        // Every transition must reference valid states
        for (const t of this.workflow.transitions) {
            if (!stateIds.has(t.from)) {
                errors.push({
                    field: `transitions[${t.id}].from`,
                    message: `State '${t.from}' referenced in transition '${t.id}' is not defined`,
                });
            }
            if (!stateIds.has(t.to)) {
                errors.push({
                    field: `transitions[${t.id}].to`,
                    message: `State '${t.to}' referenced in transition '${t.id}' is not defined`,
                });
            }
        }
        // Timeout targets must exist
        for (const [stateId, state] of Object.entries(this.workflow.states)) {
            if (state.timeout && !stateIds.has(state.timeout.toState)) {
                errors.push({
                    field: `states[${stateId}].timeout.toState`,
                    message: `Timeout target state '${state.timeout.toState}' is not defined`,
                });
            }
        }
        // Must have exactly one start node
        const startNodes = Object.entries(this.workflow.states).filter(([, s]) => s.nodeType === 'start');
        if (startNodes.length === 0) {
            errors.push({ field: 'states', message: 'Workflow must have at least one start node' });
        }
        return { valid: errors.length === 0, errors };
    }
}
//# sourceMappingURL=TransitionValidator.js.map