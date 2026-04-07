/**
 * Builds the constrained system prompt sent to the LLM.
 * The LLM cannot see or modify this construction — it only receives the
 * finished string. The prompt hard-codes exactly which actions are callable
 * and which transitions are valid, making it impossible for the LLM to
 * escape the FSM constraints.
 */
export class PromptBuilder {
    workflow;
    registry;
    validator;
    constructor(workflow, registry, validator) {
        this.workflow = workflow;
        this.registry = registry;
        this.validator = validator;
    }
    build(instance, input) {
        const stateDef = this.workflow.states[instance.currentState];
        if (!stateDef) {
            throw new Error(`State '${instance.currentState}' not found in workflow`);
        }
        const validTransitions = this.validator.validTransitionsFrom(instance.currentState);
        const readActions = stateDef.readActions ?? [];
        const writeActions = stateDef.writeActions ?? [];
        const system = [
            `You are operating within a controlled workflow. Follow these rules exactly.`,
            ``,
            `## Current State: ${instance.currentState}`,
            `${stateDef.description}`,
            ``,
            ...(stateDef.prompt ? [`## Your Task\n${stateDef.prompt}`, ``] : []),
            ...(this.workflow.guardrails ? [`## Guardrails (apply always)\n${this.workflow.guardrails}`, ``] : []),
            `## Current Context`,
            '```json',
            JSON.stringify(instance.context, null, 2),
            '```',
            ``,
            readActions.length > 0
                ? `## Read Actions (call these to gather information — no side effects)\n${this.registry.describeActions(readActions)}`
                : `## Read Actions\n(none available in this state)`,
            ``,
            writeActions.length > 0
                ? `## Write Actions (call these to take effect — use only when necessary)\n${this.registry.describeActions(writeActions)}`
                : `## Write Actions\n(none available in this state)`,
            ``,
            validTransitions.length > 0
                ? `## Valid Next States (you may ONLY propose these, or null to stay)\n${validTransitions.map(t => `- "${t.to}": ${t.condition ?? t.label ?? t.trigger}`).join('\n')}`
                : `## Valid Next States\n(none — this is a terminal state)`,
            ``,
            `## Response Format`,
            `You MUST respond with valid JSON matching this exact schema:`,
            '```json',
            JSON.stringify({
                reasoning: 'string — your reasoning process',
                contextUpdates: '{ ...key: value pairs to merge into context }',
                actions: [{ action: 'action_name', params: { key: 'value' } }],
                proposedTransition: 'STATE_ID or null',
                proposedTransitionReason: 'string (optional)',
            }, null, 2),
            '```',
            ``,
            `RULES:`,
            `- Only call actions listed in Read Actions or Write Actions above`,
            `- Only propose a transition listed in Valid Next States, or null`,
            `- Set proposedTransition to null if not enough information to decide yet`,
            `- Never invent action names or state names not listed above`,
        ].join('\n');
        const user = [
            `## New Input`,
            `Type: ${input.type}`,
            '```json',
            JSON.stringify(input.data, null, 2),
            '```',
            ``,
            `Respond with the JSON decision object.`,
        ].join('\n');
        return { system, user };
    }
}
//# sourceMappingURL=PromptBuilder.js.map