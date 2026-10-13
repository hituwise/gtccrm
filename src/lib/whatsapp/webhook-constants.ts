/**
 * WhatsApp Webhook Processing Constants
 */

/**
 * Timeout after which an inbound message left in 'processing' status
 * without an update is considered abandoned/crashed by a serverless worker.
 *
 * Rationale:
 * A normal webhook flow (compliance -> flow -> automations -> AI generation -> send)
 * takes between 1.5s to 30s max. A 5-minute timeout provides 10x safety buffer
 * against cold-starts and retries while preventing permanently dropped messages
 * if a worker abruptly dies (OOM, container kill, uncaught exception).
 */
export const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
