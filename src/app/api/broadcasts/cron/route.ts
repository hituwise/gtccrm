import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  claimBroadcastDelivery,
  markBroadcastSending,
  planBroadcastResume,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume';
import {
  deliverBroadcast,
  finalizeBroadcastStatus,
} from '@/lib/whatsapp/broadcast-core';

export const maxDuration = 300;

/**
 * Executes due scheduled broadcast campaigns (status = 'scheduled' AND scheduled_at <= NOW()).
 * Can be called by:
 * 1. Vercel Cron or external scheduler
 * 2. Background polling from the broadcasts dashboard tab
 */
export async function GET(req: Request) {
  return processDueBroadcasts(req);
}

export async function POST(req: Request) {
  return processDueBroadcasts(req);
}

async function processDueBroadcasts(req: Request) {
  try {
    const admin = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: dueBroadcasts, error } = await admin
      .from('broadcasts')
      .select('id, account_id, name, scheduled_at')
      .eq('status', 'scheduled')
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('[broadcasts-cron] Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!dueBroadcasts || dueBroadcasts.length === 0) {
      return NextResponse.json({ processed: 0, message: 'No scheduled broadcasts due.' });
    }

    const processedList: { id: string; name: string; status: string }[] = [];

    for (const bc of dueBroadcasts) {
      const claimed = await claimBroadcastDelivery(admin, bc.account_id, bc.id);
      if (!claimed) {
        continue;
      }

      try {
        const { plan } = await planBroadcastResume(
          admin,
          bc.account_id,
          bc.id,
          'pending'
        );

        await markBroadcastSending(admin, bc.id);

        if (plan.planned.length > 0) {
          await deliverBroadcast(admin, plan);
        }

        await finalizeBroadcastStatus(admin, bc.id);
        processedList.push({ id: bc.id, name: bc.name, status: 'sent' });
      } catch (err: unknown) {
        console.error(`[broadcasts-cron] Failed delivering broadcast ${bc.id}:`, err);
        await admin
          .from('broadcasts')
          .update({ status: 'failed' })
          .eq('id', bc.id);
        processedList.push({ id: bc.id, name: bc.name, status: 'failed' });
      } finally {
        await releaseBroadcastDelivery(admin, bc.id);
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedList.length,
      broadcasts: processedList,
    });
  } catch (err: unknown) {
    console.error('[broadcasts-cron] Unexpected error:', err);
    return NextResponse.json(
      { error: (err as { message?: string })?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
