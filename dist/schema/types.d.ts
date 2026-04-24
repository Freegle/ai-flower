/**
 * Core types for the llm-fsm workflow definition format.
 * All fields must be JSON-serialisable — the definition is stored and
 * transmitted as plain JSON.
 */
export type NodeType = 'start' | 'agent' | 'tool' | 'end';
export type TransitionTrigger = 'llm_decision' | 'action_taken' | 'timeout' | 'host_driven' | 'unconditional';
export interface TimeoutConfig {
    /** Duration in milliseconds */
    duration: number;
    /** State to transition to when the timeout fires */
    toState: string;
    /** Optional action to execute before transitioning */
    action?: string;
}
export interface StateDefinition {
    /** Human-readable description of what this state represents */
    description: string;
    /** Node type — affects rendering and behaviour */
    nodeType: NodeType;
    /**
     * System prompt injected at this state.
     * Only meaningful for 'agent' nodes (LLM-driven mode).
     * The engine prepends this with state context + action list + transition list.
     */
    prompt?: string;
    /** Actions the LLM may call at this state to READ data (no side effects) */
    readActions?: string[];
    /** Actions the LLM may call at this state to MODIFY state (side effects) */
    writeActions?: string[];
    /** Optional timeout — if set, fires after this duration of inactivity */
    timeout?: TimeoutConfig;
    /** Visual position in the editor canvas */
    position?: {
        x: number;
        y: number;
    };
    /** Hex colour for the node in the editor */
    color?: string;
}
export interface TransitionDefinition {
    /** Unique identifier for this transition (used as edge ID in Vue Flow) */
    id: string;
    from: string;
    to: string;
    trigger: TransitionTrigger;
    /**
     * For llm_decision: natural-language condition description sent to the LLM.
     * For host_driven: an informational label only (host decides when to fire).
     */
    condition?: string;
    /** For action_taken: the action name that fires this transition */
    action?: string;
    /** Display label shown on the edge in the editor */
    label?: string;
    /** Edge style hint for the editor ('straight' | 'bezier' | 'smoothstep') */
    edgeStyle?: string;
    /** Consumer-defined metadata (e.g. { type: 'affirm' } or { priority: 1 }) */
    metadata?: Record<string, unknown>;
}
export interface WorkflowDefinition {
    /** Unique identifier — used as the workflow key in storage */
    id: string;
    /** Human-readable name */
    name: string;
    version?: string;
    description?: string;
    /** ID of the state new instances start in */
    initialState: string;
    /**
     * Global guardrail rules appended to EVERY agent node's system prompt.
     * Use for cross-cutting constraints (e.g. "Never reveal home address").
     */
    guardrails?: string;
    /**
     * State definitions keyed by state ID.
     * State IDs are arbitrary strings (e.g. 'NEW', 'GATHERING', 'QUALIFIED').
     */
    states: Record<string, StateDefinition>;
    /** All valid transitions. The engine enforces that only these may occur. */
    transitions: TransitionDefinition[];
}
export interface TransitionEvent {
    timestamp: string;
    fromState: string;
    toState: string;
    trigger: TransitionTrigger;
    triggeredBy?: string;
    actionsExecuted: ExecutedAction[];
    contextDelta: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface ExecutedAction {
    action: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs: number;
}
export type InstanceStatus = 'active' | 'completed' | 'error' | 'paused';
export interface WorkflowInstance {
    id: string;
    workflowId: string;
    currentState: string;
    status: InstanceStatus;
    /** The knowledge record — arbitrary per-workflow data */
    context: Record<string, unknown>;
    history: TransitionEvent[];
    createdAt: string;
    updatedAt: string;
    /** Optional label for display (e.g. chat ID, caller ID) */
    label?: string;
    /** If the current state has a timeout, when it fires */
    timeoutAt?: string;
    /** Consecutive self-transitions in the current state (reset to 0 on real transitions) */
    stayCount: number;
}
export interface WorkflowInput {
    type: string;
    data: Record<string, unknown>;
}
export interface ProcessResult {
    instance: WorkflowInstance;
    transitioned: boolean;
    newState?: string;
    actionsExecuted: ExecutedAction[];
    llmReasoning?: string;
    /** The matched transition definition, if a transition occurred */
    transition?: TransitionDefinition;
}
export interface TriggerTransitionResult {
    instance: WorkflowInstance;
    transition: TransitionDefinition;
    event: TransitionEvent;
}
export interface InstanceFilter {
    state?: string;
    status?: InstanceStatus;
    label?: string;
}
export interface LLMAdapter {
    /**
     * Send a prompt to the LLM and return the raw text response.
     * The engine handles JSON parsing and validation of the response.
     */
    call(systemPrompt: string, userMessage: string): Promise<string>;
}
export interface StorageAdapter {
    saveInstance(instance: WorkflowInstance): Promise<void>;
    loadInstance(id: string): Promise<WorkflowInstance | null>;
    listInstances(workflowId: string, filter?: InstanceFilter): Promise<WorkflowInstance[]>;
    deleteInstance(id: string): Promise<void>;
    saveWorkflow(definition: WorkflowDefinition): Promise<void>;
    loadWorkflow(id: string): Promise<WorkflowDefinition | null>;
    listWorkflows(): Promise<WorkflowDefinition[]>;
    deleteWorkflow(id: string): Promise<void>;
}
export type ActionHandler = (params: Record<string, unknown>, context: Readonly<Record<string, unknown>>) => Promise<unknown>;
export interface ActionDefinition {
    name: string;
    description: string;
    /** JSON Schema describing the params object */
    paramsSchema?: Record<string, unknown>;
    handler: ActionHandler;
}
export interface LLMDecision {
    reasoning: string;
    /** Updates to merge into instance.context */
    contextUpdates: Record<string, unknown>;
    /** Actions to execute (validated against current state's allowed actions) */
    actions: Array<{
        action: string;
        params: Record<string, unknown>;
    }>;
    /** State ID to transition to, or null to stay in current state */
    proposedTransition: string | null;
    proposedTransitionReason?: string;
}
//# sourceMappingURL=types.d.ts.map