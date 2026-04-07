import type { WorkflowDefinition, WorkflowInstance, WorkflowInput, ProcessResult, LLMAdapter, StorageAdapter, ActionDefinition, InstanceFilter, InstanceStatus } from '../schema/types.js';
export interface WorkflowEngineConfig {
    workflow: WorkflowDefinition;
    storageAdapter: StorageAdapter;
    /** Required for LLM-driven mode (processInput). Optional for host-driven only. */
    llmAdapter?: LLMAdapter;
    actions?: ActionDefinition[];
    /** Max LLM retries when the response fails validation (default: 1) */
    maxLLMRetries?: number;
}
/**
 * The main orchestrator. Supports two transition modes:
 *
 * 1. LLM-driven (processInput): sends the current context + input to the LLM,
 *    validates the LLM's JSON decision against the workflow definition,
 *    executes allowed actions, and applies the transition.
 *
 * 2. Host-driven (triggerTransition): the caller (e.g. Answerbot's vector
 *    classifier) decides the transition; the engine validates it is defined
 *    in the workflow and records it.
 */
export declare class WorkflowEngine {
    private readonly config;
    private readonly validator;
    private readonly registry;
    private readonly promptBuilder;
    private readonly maxRetries;
    constructor(config: WorkflowEngineConfig);
    /** Register an additional action after construction. */
    registerAction(definition: ActionDefinition): void;
    createInstance(initialContext?: Record<string, unknown>, label?: string): Promise<WorkflowInstance>;
    getInstance(id: string): Promise<WorkflowInstance>;
    listInstances(filter?: InstanceFilter): Promise<WorkflowInstance[]>;
    updateContext(instanceId: string, updates: Record<string, unknown>): Promise<WorkflowInstance>;
    setStatus(instanceId: string, status: InstanceStatus): Promise<WorkflowInstance>;
    /**
     * Process new input using the LLM.
     * The engine calls the LLM with a constrained prompt, validates the response,
     * executes allowed actions, and applies the proposed transition.
     */
    processInput(instanceId: string, input: WorkflowInput): Promise<ProcessResult>;
    /**
     * Trigger a transition from outside (e.g. Answerbot's vector classifier).
     * The engine validates the transition is defined in the workflow, records
     * it in history, and updates instance state.
     */
    triggerTransition(instanceId: string, toState: string, metadata?: Record<string, unknown>): Promise<WorkflowInstance>;
    /**
     * Force a transition regardless of whether it is defined in the workflow.
     * For human override / admin use only — records the override in history.
     */
    forceTransition(instanceId: string, toState: string, reason: string): Promise<WorkflowInstance>;
    /**
     * Check all active instances for expired timeouts and process them.
     * Call this on a schedule (e.g. every minute).
     */
    processTimeouts(): Promise<WorkflowInstance[]>;
    private parseLLMResponse;
    private isLLMDecision;
}
//# sourceMappingURL=WorkflowEngine.d.ts.map