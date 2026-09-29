/**
 * WhatsApp compliance utilities.
 * Handles standard opt-out keywords (STOP, UNSUBSCRIBE, CANCEL, etc.)
 * per WhatsApp Business Messaging Policy.
 */

export const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'optout',
  'opt-out',
  'revoke',
])

/**
 * Checks whether an incoming message is an opt-out command.
 * Normalizes whitespace and case. Only exact single-word matches
 * (or standard hyphenated phrases) count as an opt-out command to prevent
 * accidental triggers like "stop by tomorrow".
 */
export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = text.trim().toLowerCase()
  return OPT_OUT_KEYWORDS.has(normalized)
}
