import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TenantProductConfig,
  type TenantBusinessProfile,
} from '@/lib/ai/actions/types';
import {
  getTenantProducts,
  getTenantBusinessProfile,
} from '@/lib/products/tenant-products';
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults';

export interface TenantKnowledgeContext {
  profile: TenantBusinessProfile;
  products: TenantProductConfig[];
  systemPrompt: string;
}

/**
 * Builds the complete grounded system prompt for the AI agent strictly based
 * on the current tenant's database configuration.
 *
 * Guarantees:
 * - Isolation: No hardcoded competitor or Geniplus products leak to other tenants.
 * - Pricing & Schedules: Accurately presents prices, free consultations, and configured working hours.
 * - Meeting Mode: Only describes meeting methods actually supported and configured.
 * - Handoff: Uses the tenant's handoff instructions and assigned team/agent.
 */
export async function buildTenantAiSystemPrompt(
  db: SupabaseClient,
  accountId: string,
  userCustomPrompt?: string | null,
): Promise<TenantKnowledgeContext> {
  const profile = await getTenantBusinessProfile(db, accountId);
  const products = await getTenantProducts(db, accountId, {
    onlyEnabled: true,
    fallbackToSeedIfGeniplus: true,
  });

  const parts: string[] = [];

  // 1. Identity & Persona
  const businessName = profile.businessName || 'Our Business';
  parts.push(
    `You are the friendly, helpful WhatsApp messaging assistant for "${businessName}". ` +
    `Your goal is to answer customer questions accurately, explain services, and guide qualified leads to schedule an appointment.`
  );

  if (profile.businessDescription) {
    parts.push(`About ${businessName}:\n${profile.businessDescription}`);
  }

  // 2. Products & Services Catalog
  if (products.length > 0) {
    const productDescriptions = products.map((p, idx) => {
      const priceStr = p.isFree
        ? 'Free Consultation'
        : p.price !== null && p.price !== undefined
        ? `${p.currency || 'INR'} ${p.price}`
        : 'Contact for pricing';

      const durationStr = `${p.durationMinutes} minutes`;
      const apptType = p.appointmentType || 'Appointment';
      const audience = p.targetAudience ? ` (Target Audience: ${p.targetAudience})` : '';

      let modeStr = 'Direct Phone Call';
      if (p.meetingMode === 'GOOGLE_MEET') modeStr = 'Google Meet';
      else if (p.meetingMode === 'ZOOM') modeStr = 'Zoom Call';
      else if (p.meetingMode === 'STATIC_MEETING_LINK') modeStr = 'Video Meeting';
      else if (p.meetingMode === 'BOOKING_PAGE') modeStr = 'Online Calendar Link';
      else if (p.meetingMode === 'MANUAL_FOLLOW_UP') modeStr = 'Team Follow-up';

      let details = `${idx + 1}. **${p.name}** [${apptType}]${audience}:\n`;
      if (p.description) details += `   - Description: ${p.description}\n`;
      details += `   - Duration: ${durationStr} | Fee: ${priceStr} | Meeting Mode: ${modeStr}\n`;

      if (p.workingHoursStart && p.workingHoursEnd) {
        const days = p.availabilityDays?.length ? p.availabilityDays.join(', ') : 'Mon-Sat';
        details += `   - Schedule/Availability: ${days}, ${p.workingHoursStart} to ${p.workingHoursEnd} (${p.timezone || profile.timezone})\n`;
      }

      if (p.qualificationQuestions?.length) {
        details += `   - Questions to ask: ${p.qualificationQuestions.join('; ')}\n`;
      }

      return details;
    });

    parts.push(
      `### Configured Services & Catalog:\n` +
      productDescriptions.join('\n')
    );
  } else {
    parts.push(
      `### Products & Services:\n` +
      `No specific self-serve products are currently configured in your catalog. ` +
      `Politely answer customer questions, gather their contact details and requirements, and let them know that a team member will reach out to them directly.`
    );
  }

  // 3. Scheduling & Meeting Guidelines
  parts.push(
    `### Scheduling & Booking Rules:\n` +
    `- When a customer wants to schedule, confirm their preferred day and time.\n` +
    `- Collect their name and any required details.\n` +
    `- If email is requested, explain that the calendar invite will be sent to their email.\n` +
    `- NEVER invent or promise an unverified Google Meet or Zoom link unless confirmed by the booking system.\n` +
    `- If the customer asks about class or batch timings, reply strictly using the schedule listed above. If no schedule is listed, state that our team will confirm the upcoming timings shortly.`
  );

  // 4. FAQs and Policies
  if (profile.faqs && Object.keys(profile.faqs).length > 0) {
    const faqList = Object.entries(profile.faqs)
      .map(([q, a]) => `Q: ${q}\nA: ${a}`)
      .join('\n\n');
    parts.push(`### Frequently Asked Questions:\n${faqList}`);
  }

  if (profile.policies) {
    parts.push(`### Business Policies:\n${profile.policies}`);
  }

  // 5. Human Handoff Instructions
  const handoffTeam = profile.assignedTeam ? `our ${profile.assignedTeam} team` : 'a human representative';
  const customHandoff = profile.handoffInstructions ? `\nInstructions: ${profile.handoffInstructions}` : '';
  parts.push(
    `### Human Handoff Protocol:\n` +
    `If the customer is upset, asks to speak with a human or coach directly, or asks something outside the configured services, reply with exactly ${HANDOFF_SENTINEL} so ${handoffTeam} can take over.${customHandoff}`
  );

  // 6. User Custom Instructions
  const finalCustomPrompt = userCustomPrompt || profile.systemPrompt;
  if (finalCustomPrompt && finalCustomPrompt.trim()) {
    parts.push(`### Additional Guidelines:\n${finalCustomPrompt.trim()}`);
  }

  return {
    profile,
    products,
    systemPrompt: parts.join('\n\n'),
  };
}
