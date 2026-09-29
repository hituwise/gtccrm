/**
 * Structured Decision Logger for Inbound Message Orchestration.
 *
 * Emits uniform log lines with structured tags that allow operators to trace
 * why an inbound message was handled by Flow, Automation, AI, or blocked.
 *
 * Never logs secrets, bearer tokens, or sensitive customer text.
 */

export type OrchestrationDecision =
  | 'FLOW_CONSUMED'
  | 'AUTOMATION_EXECUTED'
  | 'HUMAN_HANDOFF'
  | 'AI_REPLY_LIMIT_REACHED'
  | 'AI_RATE_LIMITED'
  | 'AI_COMPLIANCE_BLOCKED'
  | 'AI_RESPONDED'
  | 'AI_NO_RESPONSE'

export interface DecisionPayload {
  conversationId?: string
  accountId?: string
  contactId?: string
  flowRunId?: string
  automationId?: string
  triggerType?: string
  outcome?: string
  reason?: string
  assignedAgent?: boolean
  replyCount?: number
  maxReplies?: number
  limit?: number
  [key: string]: unknown
}

export function logDecision(decision: OrchestrationDecision, payload: DecisionPayload = {}): void {
  const parts: string[] = []

  if (payload.conversationId) parts.push(`conversation=${payload.conversationId}`)
  if (payload.accountId) parts.push(`account=${payload.accountId}`)
  if (payload.flowRunId) parts.push(`flow_run_id=${payload.flowRunId}`)
  if (payload.automationId) parts.push(`automation_id=${payload.automationId}`)
  if (payload.triggerType) parts.push(`trigger=${payload.triggerType}`)
  if (payload.outcome) parts.push(`outcome=${payload.outcome}`)
  if (payload.reason) parts.push(`reason=${payload.reason}`)
  if (payload.assignedAgent !== undefined) parts.push(`assigned=${payload.assignedAgent}`)
  if (payload.replyCount !== undefined) parts.push(`reply_count=${payload.replyCount}`)
  if (payload.maxReplies !== undefined) parts.push(`max_replies=${payload.maxReplies}`)
  if (payload.limit !== undefined) parts.push(`limit=${payload.limit}`)

  const detailStr = parts.length > 0 ? ` (${parts.join(', ')})` : ''

  // Both the specific tag and [AI_DECISION] are printed so log aggregators can grep either.
  const message = `[AI_DECISION] [${decision}]${detailStr}`

  if (decision === 'AI_RATE_LIMITED' || decision === 'AI_COMPLIANCE_BLOCKED') {
    console.warn(message)
  } else {
    console.info(message)
  }
}
