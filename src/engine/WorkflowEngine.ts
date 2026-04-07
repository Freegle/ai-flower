import { v4 as uuidv4 } from 'uuid'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInput,
  ProcessResult,
  LLMDecision,
  TransitionDefinition,
  TransitionEvent,
  TriggerTransitionResult,
  LLMAdapter,
  StorageAdapter,
  ActionDefinition,
  StateDefinition,
  InstanceFilter,
  InstanceStatus,
} from '../schema/types.js'
import { TransitionValidator } from './TransitionValidator.js'
import { ActionRegistry } from './ActionRegistry.js'
import { PromptBuilder } from './PromptBuilder.js'

export interface WorkflowHooks {
  onEnterState?: (instance: WorkflowInstance, state: string, stateDef: StateDefinition) => Promise<void>
  onExitState?: (instance: WorkflowInstance, state: string) => Promise<void>
  onTransition?: (instance: WorkflowInstance, event: TransitionEvent) => Promise<void>
  onInstanceCreated?: (instance: WorkflowInstance) => Promise<void>
  onInstanceCompleted?: (instance: WorkflowInstance) => Promise<void>
}

export interface WorkflowEngineConfig {
  workflow: WorkflowDefinition
  storageAdapter: StorageAdapter
  /** Required for LLM-driven mode (processInput). Optional for host-driven only. */
  llmAdapter?: LLMAdapter
  actions?: ActionDefinition[]
  /** Max LLM retries when the response fails validation (default: 1) */
  maxLLMRetries?: number
  /** Lifecycle hooks — async callbacks fired during state changes */
  hooks?: WorkflowHooks
  /** Max depth for chained unconditional transitions (default: 10) */
  maxUnconditionalDepth?: number
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
export class WorkflowEngine {
  private readonly validator: TransitionValidator
  private readonly registry: ActionRegistry
  private readonly promptBuilder: PromptBuilder
  private readonly maxRetries: number
  private readonly hooks: WorkflowHooks
  private readonly maxUnconditionalDepth: number

  constructor(private readonly config: WorkflowEngineConfig) {
    this.validator = new TransitionValidator(config.workflow)
    this.registry = new ActionRegistry()
    this.promptBuilder = new PromptBuilder(config.workflow, this.registry, this.validator)
    this.maxRetries = config.maxLLMRetries ?? 1
    this.hooks = config.hooks ?? {}
    this.maxUnconditionalDepth = config.maxUnconditionalDepth ?? 10

    // Validate the definition on startup
    const result = this.validator.validateDefinition()
    if (!result.valid) {
      throw new Error(
        `Invalid workflow definition: ${result.errors.map(e => e.message).join('; ')}`
      )
    }

    // Register provided actions
    if (config.actions) {
      this.registry.registerAll(config.actions)
    }
  }

  // ─── Action registration ───────────────────────────────────────────────────

  /** Register an additional action after construction. */
  registerAction(definition: ActionDefinition): void {
    this.registry.register(definition)
  }

  // ─── Instance management ──────────────────────────────────────────────────

  async createInstance(
    initialContext: Record<string, unknown> = {},
    label?: string
  ): Promise<WorkflowInstance> {
    const now = new Date().toISOString()
    const instance: WorkflowInstance = {
      id: uuidv4(),
      workflowId: this.config.workflow.id,
      currentState: this.config.workflow.initialState,
      status: 'active',
      context: { ...initialContext },
      history: [],
      createdAt: now,
      updatedAt: now,
      label,
      stayCount: 0,
    }

    const initialState = this.config.workflow.states[instance.currentState]
    if (initialState?.timeout) {
      instance.timeoutAt = new Date(Date.now() + initialState.timeout.duration).toISOString()
    }

    await this.config.storageAdapter.saveInstance(instance)
    await this.safeHook('onInstanceCreated', instance)
    return instance
  }

  async getInstance(id: string): Promise<WorkflowInstance> {
    const instance = await this.config.storageAdapter.loadInstance(id)
    if (!instance) throw new Error(`Instance '${id}' not found`)
    return instance
  }

  async listInstances(filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    return this.config.storageAdapter.listInstances(this.config.workflow.id, filter)
  }

  async updateContext(
    instanceId: string,
    updates: Record<string, unknown>
  ): Promise<WorkflowInstance> {
    const instance = await this.getInstance(instanceId)
    instance.context = { ...instance.context, ...updates }
    instance.updatedAt = new Date().toISOString()
    await this.config.storageAdapter.saveInstance(instance)
    return instance
  }

  async setStatus(instanceId: string, status: InstanceStatus): Promise<WorkflowInstance> {
    const instance = await this.getInstance(instanceId)
    instance.status = status
    instance.updatedAt = new Date().toISOString()
    await this.config.storageAdapter.saveInstance(instance)
    return instance
  }

  // ─── LLM-driven transition ─────────────────────────────────────────────────

  /**
   * Process new input using the LLM.
   * The engine calls the LLM with a constrained prompt, validates the response,
   * executes allowed actions, and applies the proposed transition.
   */
  async processInput(instanceId: string, input: WorkflowInput): Promise<ProcessResult> {
    if (!this.config.llmAdapter) {
      throw new Error('llmAdapter is required for processInput (LLM-driven mode)')
    }

    const instance = await this.getInstance(instanceId)
    if (instance.status !== 'active') {
      throw new Error(`Instance '${instanceId}' is not active (status: ${instance.status})`)
    }

    const { system, user } = this.promptBuilder.build(instance, input)
    let decision: LLMDecision | null = null
    let lastError: string | null = null

    // Attempt LLM call with retries on validation failure
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const rawResponse = await this.config.llmAdapter.call(
        attempt === 0 ? system : `${system}\n\nPREVIOUS ATTEMPT ERROR: ${lastError}\n\nPlease fix your JSON response.`,
        user
      )

      const parsed = this.parseLLMResponse(rawResponse)
      if (!parsed.ok) {
        lastError = parsed.error
        continue
      }

      const validation = this.validator.validateLLMDecision(parsed.decision, instance.currentState)
      if (!validation.valid) {
        lastError = validation.errors.map(e => e.message).join('; ')
        continue
      }

      decision = parsed.decision
      break
    }

    if (!decision) {
      // LLM failed validation after retries — mark instance as error
      await this.setStatus(instanceId, 'error')
      throw new Error(`LLM decision failed validation after ${this.maxRetries + 1} attempts: ${lastError}`)
    }

    // Execute actions
    const actionsExecuted = await this.registry.executeAll(decision.actions, instance.context)

    // Collect action results into context updates
    const actionResults: Record<string, unknown> = {}
    for (const exec of actionsExecuted) {
      if (exec.result !== undefined) {
        actionResults[`_action_${exec.action}`] = exec.result
      }
    }

    // Apply context updates
    const contextDelta = { ...decision.contextUpdates, ...actionResults }
    const previousState = instance.currentState
    const toState = decision.proposedTransition ?? previousState

    // Find the matched transition definition
    const matchedTransition = decision.proposedTransition
      ? this.config.workflow.transitions.find(
          t => t.from === previousState && t.to === decision.proposedTransition
        )
      : undefined

    const event: TransitionEvent = {
      timestamp: new Date().toISOString(),
      fromState: previousState,
      toState,
      trigger: 'llm_decision',
      triggeredBy: 'llm',
      actionsExecuted,
      contextDelta,
      metadata: matchedTransition?.metadata,
    }

    instance.context = { ...instance.context, ...contextDelta }
    instance.history = [...instance.history, event]
    instance.updatedAt = new Date().toISOString()

    // Apply transition (including self-transitions)
    let transitioned = false
    if (decision.proposedTransition && decision.proposedTransition !== previousState) {
      // Real transition
      await this.safeHook('onExitState', instance, previousState)
      await this.safeHook('onTransition', instance, event)

      instance.currentState = decision.proposedTransition
      instance.stayCount = 0
      transitioned = true

      const newStateDef = this.config.workflow.states[decision.proposedTransition]
      if (newStateDef?.nodeType === 'end') {
        instance.status = 'completed'
      }

      instance.timeoutAt = newStateDef?.timeout
        ? new Date(Date.now() + newStateDef.timeout.duration).toISOString()
        : undefined

      await this.safeHook('onEnterState', instance, decision.proposedTransition, newStateDef!)

      if (instance.status === 'completed') {
        await this.safeHook('onInstanceCompleted', instance)
      }
    } else if (decision.proposedTransition && decision.proposedTransition === previousState) {
      // Self-transition: record event, increment stayCount
      instance.stayCount = (instance.stayCount ?? 0) + 1
      await this.safeHook('onTransition', instance, event)
    }

    await this.config.storageAdapter.saveInstance(instance)

    // Process unconditional transitions from new state
    if (transitioned) {
      await this.processUnconditionalTransitions(instance)
    }

    return {
      instance,
      transitioned,
      newState: transitioned ? decision.proposedTransition ?? undefined : undefined,
      actionsExecuted,
      llmReasoning: decision.reasoning,
      transition: matchedTransition,
    }
  }

  // ─── Host-driven transition ────────────────────────────────────────────────

  /**
   * Trigger a transition from outside (e.g. Answerbot's vector classifier).
   * The engine validates the transition is defined in the workflow, records
   * it in history, and updates instance state.
   */
  async triggerTransition(
    instanceId: string,
    toState: string,
    metadata: Record<string, unknown> = {}
  ): Promise<TriggerTransitionResult> {
    const instance = await this.getInstance(instanceId)
    if (instance.status !== 'active') {
      throw new Error(`Instance '${instanceId}' is not active (status: ${instance.status})`)
    }

    const validation = this.validator.validateHostTransition(instance.currentState, toState)
    if (!validation.valid) {
      throw new Error(validation.errors.map(e => e.message).join('; '))
    }

    const previousState = instance.currentState

    // Find the matched transition definition
    const matchedTransition = this.config.workflow.transitions.find(
      t => t.from === previousState && t.to === toState
    )!

    // Merge caller metadata with transition definition metadata
    const mergedMetadata = { ...matchedTransition.metadata, ...metadata }

    const event: TransitionEvent = {
      timestamp: new Date().toISOString(),
      fromState: previousState,
      toState,
      trigger: 'host_driven',
      triggeredBy: 'host',
      actionsExecuted: [],
      contextDelta: {},
      metadata: mergedMetadata,
    }

    instance.history = [...instance.history, event]
    instance.updatedAt = new Date().toISOString()

    if (toState === previousState) {
      // Self-transition: record event, increment stayCount
      instance.stayCount = (instance.stayCount ?? 0) + 1
      await this.safeHook('onTransition', instance, event)
    } else {
      // Real transition
      await this.safeHook('onExitState', instance, previousState)
      await this.safeHook('onTransition', instance, event)

      instance.currentState = toState
      instance.stayCount = 0

      const newStateDef = this.config.workflow.states[toState]
      if (newStateDef?.nodeType === 'end') {
        instance.status = 'completed'
      }
      instance.timeoutAt = newStateDef?.timeout
        ? new Date(Date.now() + newStateDef.timeout.duration).toISOString()
        : undefined

      await this.safeHook('onEnterState', instance, toState, newStateDef!)

      if (instance.status === 'completed') {
        await this.safeHook('onInstanceCompleted', instance)
      }
    }

    await this.config.storageAdapter.saveInstance(instance)

    // Process unconditional transitions from new state
    if (toState !== previousState) {
      await this.processUnconditionalTransitions(instance)
    }

    return { instance, transition: matchedTransition, event }
  }

  /**
   * Force a transition regardless of whether it is defined in the workflow.
   * For human override / admin use only — records the override in history.
   */
  async forceTransition(
    instanceId: string,
    toState: string,
    reason: string
  ): Promise<WorkflowInstance> {
    const instance = await this.getInstance(instanceId)
    const targetDef = this.config.workflow.states[toState]
    if (!targetDef) {
      throw new Error(`State '${toState}' is not defined in the workflow`)
    }

    const previousState = instance.currentState
    const event: TransitionEvent = {
      timestamp: new Date().toISOString(),
      fromState: previousState,
      toState,
      trigger: 'host_driven',
      triggeredBy: 'force',
      actionsExecuted: [],
      contextDelta: {},
      metadata: { forced: true, reason },
    }

    await this.safeHook('onExitState', instance, previousState)
    await this.safeHook('onTransition', instance, event)

    instance.currentState = toState
    instance.status = targetDef.nodeType === 'end' ? 'completed' : 'active'
    instance.stayCount = toState === previousState ? (instance.stayCount ?? 0) + 1 : 0
    instance.history = [...instance.history, event]
    instance.updatedAt = new Date().toISOString()
    instance.timeoutAt = targetDef.timeout
      ? new Date(Date.now() + targetDef.timeout.duration).toISOString()
      : undefined

    await this.safeHook('onEnterState', instance, toState, targetDef)

    if (instance.status === 'completed') {
      await this.safeHook('onInstanceCompleted', instance)
    }

    await this.config.storageAdapter.saveInstance(instance)
    return instance
  }

  // ─── Timeout processing ────────────────────────────────────────────────────

  /**
   * Check all active instances for expired timeouts and process them.
   * Call this on a schedule (e.g. every minute).
   */
  async processTimeouts(): Promise<WorkflowInstance[]> {
    const instances = await this.listInstances({ status: 'active' })
    const now = Date.now()
    const processed: WorkflowInstance[] = []

    for (const instance of instances) {
      if (!instance.timeoutAt) continue
      if (new Date(instance.timeoutAt).getTime() > now) continue

      const stateDef = this.config.workflow.states[instance.currentState]
      if (!stateDef?.timeout) continue

      const { toState, action } = stateDef.timeout

      // Execute optional pre-timeout action
      if (action && this.registry.has(action)) {
        await this.registry.execute(action, {}, instance.context)
      }

      const result = await this.triggerTransition(instance.id, toState, {
        triggeredBy: 'timeout',
        timedOutFrom: instance.currentState,
      })
      processed.push(result.instance)
    }

    return processed
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private parseLLMResponse(
    raw: string
  ): { ok: true; decision: LLMDecision } | { ok: false; error: string } {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim()

    try {
      const parsed = JSON.parse(cleaned) as unknown
      if (!this.isLLMDecision(parsed)) {
        return {
          ok: false,
          error: 'Response is not a valid LLMDecision object (missing required fields)',
        }
      }
      return { ok: true, decision: parsed }
    } catch (err) {
      return {
        ok: false,
        error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private isLLMDecision(value: unknown): value is LLMDecision {
    if (typeof value !== 'object' || value === null) return false
    const obj = value as Record<string, unknown>
    return (
      typeof obj.reasoning === 'string' &&
      typeof obj.contextUpdates === 'object' &&
      obj.contextUpdates !== null &&
      Array.isArray(obj.actions) &&
      (obj.proposedTransition === null || typeof obj.proposedTransition === 'string')
    )
  }

  // ─── Hook helpers ─────────────────────────────────────────────────────────

  /**
   * Fire a lifecycle hook safely — errors are logged but do not prevent
   * the transition from completing.
   */
  private async safeHook(name: 'onInstanceCreated' | 'onInstanceCompleted', instance: WorkflowInstance): Promise<void>
  private async safeHook(name: 'onEnterState', instance: WorkflowInstance, state: string, stateDef: StateDefinition): Promise<void>
  private async safeHook(name: 'onExitState', instance: WorkflowInstance, state: string): Promise<void>
  private async safeHook(name: 'onTransition', instance: WorkflowInstance, event: TransitionEvent): Promise<void>
  private async safeHook(name: string, ...args: unknown[]): Promise<void> {
    const hook = (this.hooks as Record<string, ((...a: unknown[]) => Promise<void>) | undefined>)[name]
    if (!hook) return
    try {
      await hook(...args)
    } catch (err) {
      console.error(`[ai-flower] Hook '${name}' threw:`, err instanceof Error ? err.message : err)
    }
  }

  // ─── Unconditional transition processing ──────────────────────────────────

  /**
   * After entering a new state, check if it has unconditional transitions.
   * If so, automatically follow the first one. Chains up to maxUnconditionalDepth.
   */
  private async processUnconditionalTransitions(instance: WorkflowInstance): Promise<void> {
    for (let depth = 0; depth < this.maxUnconditionalDepth; depth++) {
      if (instance.status !== 'active') break

      const unconditionals = this.config.workflow.transitions.filter(
        t => t.from === instance.currentState && t.trigger === 'unconditional'
      )
      if (unconditionals.length === 0) break

      const transition = unconditionals[0]
      const previousState = instance.currentState

      const event: TransitionEvent = {
        timestamp: new Date().toISOString(),
        fromState: previousState,
        toState: transition.to,
        trigger: 'unconditional',
        triggeredBy: 'unconditional',
        actionsExecuted: [],
        contextDelta: {},
        metadata: transition.metadata,
      }

      await this.safeHook('onExitState', instance, previousState)
      await this.safeHook('onTransition', instance, event)

      instance.currentState = transition.to
      instance.stayCount = 0
      instance.history = [...instance.history, event]
      instance.updatedAt = new Date().toISOString()

      const newStateDef = this.config.workflow.states[transition.to]
      if (newStateDef?.nodeType === 'end') {
        instance.status = 'completed'
      }
      instance.timeoutAt = newStateDef?.timeout
        ? new Date(Date.now() + newStateDef.timeout.duration).toISOString()
        : undefined

      await this.safeHook('onEnterState', instance, transition.to, newStateDef!)

      if (instance.status === 'completed') {
        await this.safeHook('onInstanceCompleted', instance)
      }

      await this.config.storageAdapter.saveInstance(instance)
    }
  }
}
