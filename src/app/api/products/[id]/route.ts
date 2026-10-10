import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  getTenantProductById,
  upsertTenantProduct,
  deleteTenantProduct,
  validateTenantProductMeetingMode,
} from '@/lib/products/tenant-products';
import type { TenantProductConfig } from '@/lib/ai/actions/types';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/products/[id]
 *
 * Retrieve a specific product/service by ID, strictly scoped to current tenant.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const product = await getTenantProductById(supabase, accountId, id);
    if (!product) {
      return bad('Product/service not found', 404);
    }

    return NextResponse.json({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PUT /api/products/[id]  (admin+)
 *
 * Update an existing product/service for the current tenant.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const { id } = await params;

    const limit = checkRateLimit(`products-write:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return bad('Invalid JSON body');
    }

    const existing = await getTenantProductById(supabase, accountId, id);
    if (!existing) {
      return bad('Product/service not found', 404);
    }

    const updatedConfig: TenantProductConfig = {
      ...existing,
      ...body,
      productServiceId: id,
      productKey: id,
      tenantId: accountId,
    };

    if (body.meetingMode !== undefined) {
      updatedConfig.meetingMode = validateTenantProductMeetingMode(body.meetingMode);
    }

    if (body.price !== undefined) {
      updatedConfig.price = body.price !== null && body.price !== '' ? Number(body.price) : null;
      updatedConfig.isFree = Boolean(body.isFree || (updatedConfig.price === 0));
    }

    if (body.archived !== undefined) {
      updatedConfig.archived = Boolean(body.archived);
      if (updatedConfig.archived) {
        updatedConfig.enabled = false;
      }
    }

    if (body.durationMinutes !== undefined) {
      const dur = Number(body.durationMinutes);
      if (Number.isFinite(dur) && dur >= 5) {
        updatedConfig.durationMinutes = dur;
      }
    }

    const saved = await upsertTenantProduct(supabase, accountId, updatedConfig);
    if (!saved) {
      return bad('Failed to update product/service configuration', 500);
    }

    return NextResponse.json({ success: true, product: saved });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/products/[id]  (admin+)
 *
 * Delete or disable a tenant product/service.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const { id } = await params;

    const limit = checkRateLimit(`products-write:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const deleted = await deleteTenantProduct(supabase, accountId, id);
    if (!deleted) {
      return bad('Failed to delete product or product not found', 404);
    }

    return NextResponse.json({ success: true, id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
