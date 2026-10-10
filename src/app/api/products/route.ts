import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  getTenantProducts,
  upsertTenantProduct,
  validateTenantProductMeetingMode,
} from '@/lib/products/tenant-products';
import type { TenantProductConfig } from '@/lib/ai/actions/types';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/products
 *
 * List all products/services configured for the current tenant.
 * Strictly scoped to the authenticated user's workspace account.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const products = await getTenantProducts(supabase, accountId);

    return NextResponse.json({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/products  (admin+)
 *
 * Create or upsert a tenant product/service configuration.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`products-write:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return bad('Invalid JSON body');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return bad('Product name is required');
    }

    // Derive or sanitize productServiceId
    let productServiceId =
      typeof body.productServiceId === 'string' && body.productServiceId.trim()
        ? body.productServiceId.trim()
        : typeof body.productKey === 'string' && body.productKey.trim()
          ? body.productKey.trim()
          : name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '');

    if (!productServiceId) {
      productServiceId = `prod_${Date.now()}`;
    }

    let durationMinutes = Number(body.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5) {
      durationMinutes = 45;
    }

    const price = body.price !== undefined && body.price !== null && body.price !== ''
      ? Number(body.price)
      : null;
    const isFree = Boolean(body.isFree || (price === 0));

    const config: TenantProductConfig = {
      productServiceId,
      productKey: productServiceId,
      tenantId: accountId,
      name,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      category: typeof body.category === 'string' ? body.category.trim() : 'Services',
      targetAudience: typeof body.targetAudience === 'string' ? body.targetAudience.trim() : undefined,
      enabled: body.enabled !== false && !body.archived,
      archived: Boolean(body.archived),
      appointmentType: typeof body.appointmentType === 'string' && body.appointmentType.trim()
        ? body.appointmentType.trim()
        : name,
      durationMinutes,
      price,
      currency: typeof body.currency === 'string' ? body.currency.trim() : 'INR',
      isFree,
      workingHoursStart: typeof body.workingHoursStart === 'string' ? body.workingHoursStart.trim() : undefined,
      workingHoursEnd: typeof body.workingHoursEnd === 'string' ? body.workingHoursEnd.trim() : undefined,
      availabilityDays: Array.isArray(body.availabilityDays) ? body.availabilityDays : undefined,
      bookingMethod: body.bookingMethod,
      meetingMode: validateTenantProductMeetingMode(body.meetingMode),
      meetingLink: typeof body.meetingLink === 'string' ? body.meetingLink.trim() : null,
      calendarId: typeof body.calendarId === 'string' ? body.calendarId.trim() : 'primary',
      timezone: typeof body.timezone === 'string' ? body.timezone.trim() : undefined,
      requiredFields: Array.isArray(body.requiredFields) ? body.requiredFields : ['name'],
      optionalFields: Array.isArray(body.optionalFields) ? body.optionalFields : ['email', 'phone'],
      tags: typeof body.tags === 'object' && body.tags !== null ? body.tags : {
        interestTag: `${productServiceId.toUpperCase()}_INTEREST`,
        bookedTag: `${productServiceId.toUpperCase()}_BOOKED`,
      },
      ctaType: body.ctaType || 'Demo',
      teamName: typeof body.teamName === 'string' ? body.teamName.trim() : 'General',
      assignedAgentId: typeof body.assignedAgentId === 'string' ? body.assignedAgentId.trim() : null,
      eventTitleTemplate: typeof body.eventTitleTemplate === 'string'
        ? body.eventTitleTemplate.trim()
        : `{{name}} - ${name}`,
      confirmationTemplate: typeof body.confirmationTemplate === 'string'
        ? body.confirmationTemplate.trim()
        : undefined,
      followUpInstructions: typeof body.followUpInstructions === 'string' ? body.followUpInstructions.trim() : undefined,
      qualificationQuestions: Array.isArray(body.qualificationQuestions) ? body.qualificationQuestions : undefined,
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
    };

    const saved = await upsertTenantProduct(supabase, accountId, config);

    if (!saved) {
      return bad('Failed to save product/service configuration', 500);
    }

    return NextResponse.json({ success: true, product: saved }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
