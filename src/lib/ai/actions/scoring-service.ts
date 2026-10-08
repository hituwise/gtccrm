import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ScoringSignal,
  type LeadTemperature,
  DEFAULT_SCORING_WEIGHTS,
} from './types';
import { updateLeadTemperature } from './tag-service';
import { logAiAction } from './action-logger';

export interface ScoringResult {
  previousScore: number;
  newScore: number;
  addedSignals: ScoringSignal[];
  temperature?: LeadTemperature;
}

/**
 * Calculates and updates the lead score on the contact without double-counting events.
 * Automatically aligns lead temperature with the 0-30 / 31-70 / 71-100 brackets.
 */
export async function applyScoringSignals(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  newSignals: ScoringSignal[];
  scoringWeights?: Record<string, number>;
  explicitTemperature?: LeadTemperature;
}): Promise<ScoringResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    newSignals,
    scoringWeights = DEFAULT_SCORING_WEIGHTS,
    explicitTemperature,
  } = args;

  // 1. Fetch current contact score state
  const { data: contact } = await db
    .from('contacts')
    .select('id, lead_score, lead_temperature, lead_score_events')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  const currentScore = contact?.lead_score ?? 0;
  const currentEvents: string[] = Array.isArray(contact?.lead_score_events)
    ? (contact?.lead_score_events as string[])
    : [];
  const currentTemp = (contact?.lead_temperature as LeadTemperature) || undefined;

  // 2. Filter out already-counted signals to prevent double-counting
  const freshSignals = newSignals.filter((sig) => !currentEvents.includes(sig));

  if (freshSignals.length === 0 && !explicitTemperature) {
    return {
      previousScore: currentScore,
      newScore: currentScore,
      addedSignals: [],
      temperature: currentTemp,
    };
  }

  // 3. Compute score delta
  let pointsDelta = 0;
  for (const sig of freshSignals) {
    const pts = scoringWeights[sig] ?? DEFAULT_SCORING_WEIGHTS[sig] ?? 0;
    pointsDelta += pts;
  }

  const newScore = Math.min(100, Math.max(0, currentScore + pointsDelta));
  const updatedEvents = Array.from(new Set([...currentEvents, ...freshSignals]));

  // 4. Derive temperature: high-intent signals (demo request, booking, appointment confirmation) are always HOT
  const highIntentSignals: ScoringSignal[] = [
    'requests_demo_or_call',
    'books_demo_or_call',
    'confirms_appointment',
    'ready_to_join',
    'asks_payment',
  ];
  const hasHighIntent = updatedEvents.some((e) => highIntentSignals.includes(e as ScoringSignal));

  let targetTemp: LeadTemperature | undefined = explicitTemperature;
  if (!targetTemp) {
    if (hasHighIntent || newScore >= 71) {
      targetTemp = 'hot';
    } else if (newScore >= 31 || updatedEvents.length > 0) {
      targetTemp = currentTemp === 'hot' ? 'hot' : 'warm';
    } else {
      targetTemp = currentTemp || 'cold';
    }
  }

  // 5. Update contact record
  const updatePayload: Record<string, unknown> = {
    lead_score: newScore,
    lead_score_events: updatedEvents,
    updated_at: new Date().toISOString(),
  };

  await db
    .from('contacts')
    .update(updatePayload)
    .eq('id', contactId)
    .eq('account_id', accountId);

  // 6. Update temperature tags if temperature changed
  if (targetTemp && targetTemp !== currentTemp) {
    await updateLeadTemperature({
      db,
      accountId,
      contactId,
      conversationId,
      temperature: targetTemp,
    });
  }

  // 7. Audit log
  if (freshSignals.length > 0) {
    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'LEAD_SCORE_UPDATED',
      details: {
        previousScore: currentScore,
        newScore,
        addedSignals: freshSignals,
        pointsDelta,
      },
    });
  }

  return {
    previousScore: currentScore,
    newScore,
    addedSignals: freshSignals,
    temperature: targetTemp || currentTemp,
  };
}
