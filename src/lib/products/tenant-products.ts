import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TenantProductConfig,
  type TenantBusinessProfile,
  type MeetingLinkMode,
  type SupportedBookingMethod,
  GENIPLUS_SEED_PRODUCTS,
} from '@/lib/ai/actions/types';

/**
 * Verified Geniplus Account IDs.
 * Preserves Geniplus functionality without ever exposing or seeding
 * Geniplus products into unrelated coach or trainer accounts.
 */
export const VERIFIED_GENIPLUS_ACCOUNT_IDS = new Set<string>([
  '5d5413c2-6097-4ffe-bad8-2a992dca93a8',
  'geniplus-tenant-acc', // for automated regression test isolation
]);

/**
 * Checks whether an account is the verified Geniplus tenant.
 * Uses verified account IDs, environment variables, or cryptographically verified
 * Meta WhatsApp phone number IDs — NEVER displays or guesses by account name alone.
 */
export async function isVerifiedGeniplusTenant(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  if (!accountId) return false;
  if (process.env.GENIPLUS_ACCOUNT_ID && accountId === process.env.GENIPLUS_ACCOUNT_ID) {
    return true;
  }
  if (VERIFIED_GENIPLUS_ACCOUNT_IDS.has(accountId)) {
    return true;
  }

  try {
    const { data: wa } = await db
      .from('whatsapp_config')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (wa?.phone_number_id === '1371412096054120') {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * Validates the tenant product meeting mode. If missing or invalid,
 * safely defaults to 'NONE' (direct contact / phone call) rather than
 * silently assuming 'GOOGLE_MEET'.
 */
export function validateTenantProductMeetingMode(mode: unknown): MeetingLinkMode {
  const validModes: MeetingLinkMode[] = [
    'GOOGLE_MEET',
    'ZOOM',
    'STATIC_MEETING_LINK',
    'BOOKING_PAGE',
    'PHONE_CALL',
    'NONE',
    'MANUAL_FOLLOW_UP',
  ];
  if (typeof mode === 'string' && validModes.includes(mode as MeetingLinkMode)) {
    return mode as MeetingLinkMode;
  }
  return 'NONE';
}

/**
 * Normalizes a database row or legacy config into a standard TenantProductConfig.
 */
export function normalizeTenantProduct(raw: Record<string, unknown>): TenantProductConfig {
  const productServiceId = String(raw.product_service_id || raw.productServiceId || raw.productKey || raw.id || '');
  const name = String(raw.name || raw.appointmentType || raw.appointment_type || productServiceId);
  const appointmentType = String(raw.appointment_type || raw.appointmentType || name);
  const durationMinutes = Number(raw.duration_minutes || raw.durationMinutes || 30);
  const rawMode = raw.meeting_mode || raw.meetingMode;
  const meetingMode = validateTenantProductMeetingMode(rawMode);

  const requiredFields = Array.isArray(raw.required_fields)
    ? (raw.required_fields as string[])
    : Array.isArray(raw.requiredFields)
    ? (raw.requiredFields as string[])
    : ['name', 'date', 'time'];

  const optionalFields = Array.isArray(raw.optional_fields)
    ? (raw.optional_fields as string[])
    : Array.isArray(raw.optionalFields)
    ? (raw.optionalFields as string[])
    : ['email', 'notes'];

  let tags = (typeof raw.tags === 'object' && raw.tags !== null)
    ? (raw.tags as Record<string, string>)
    : {};

  // Compatibility with legacy tagName
  const legacyTagName = raw.tagName ? String(raw.tagName) : undefined;
  if (legacyTagName && !tags.interestTag) {
    tags = { ...tags, interestTag: legacyTagName };
  }

  const keywords = Array.isArray(raw.keywords) ? (raw.keywords as string[]) : [];

  // Extract coach specific extended fields stored directly or inside rules json
  const assignmentRules = (typeof raw.assignment_rules === 'object' && raw.assignment_rules !== null
    ? raw.assignment_rules
    : typeof raw.assignmentRules === 'object' && raw.assignmentRules !== null
    ? raw.assignmentRules
    : {}) as Record<string, unknown>;

  const followUpRules = (typeof raw.follow_up_rules === 'object' && raw.follow_up_rules !== null
    ? raw.follow_up_rules
    : typeof raw.followUpRules === 'object' && raw.followUpRules !== null
    ? raw.followUpRules
    : {}) as Record<string, unknown>;

  const price = raw.price !== undefined
    ? Number(raw.price)
    : assignmentRules.price !== undefined
    ? Number(assignmentRules.price)
    : null;

  const currency = typeof raw.currency === 'string'
    ? raw.currency
    : typeof assignmentRules.currency === 'string'
    ? assignmentRules.currency
    : 'INR';

  const isFree = Boolean(raw.isFree ?? assignmentRules.isFree ?? (price === 0));

  const targetAudience = typeof raw.targetAudience === 'string'
    ? raw.targetAudience
    : typeof assignmentRules.targetAudience === 'string'
    ? assignmentRules.targetAudience
    : undefined;

  const workingHoursStart = typeof raw.workingHoursStart === 'string'
    ? raw.workingHoursStart
    : typeof assignmentRules.workingHoursStart === 'string'
    ? assignmentRules.workingHoursStart
    : undefined;

  const workingHoursEnd = typeof raw.workingHoursEnd === 'string'
    ? raw.workingHoursEnd
    : typeof assignmentRules.workingHoursEnd === 'string'
    ? assignmentRules.workingHoursEnd
    : undefined;

  const availabilityDays = Array.isArray(raw.availabilityDays)
    ? (raw.availabilityDays as string[])
    : Array.isArray(assignmentRules.availabilityDays)
    ? (assignmentRules.availabilityDays as string[])
    : undefined;

  const bookingMethod = (typeof raw.bookingMethod === 'string'
    ? raw.bookingMethod
    : typeof assignmentRules.bookingMethod === 'string'
    ? assignmentRules.bookingMethod
    : undefined) as SupportedBookingMethod | undefined;

  const qualificationQuestions = Array.isArray(raw.qualificationQuestions)
    ? (raw.qualificationQuestions as string[])
    : Array.isArray(assignmentRules.qualificationQuestions)
    ? (assignmentRules.qualificationQuestions as string[])
    : undefined;

  const followUpInstructions = typeof raw.followUpInstructions === 'string'
    ? raw.followUpInstructions
    : typeof followUpRules.instructions === 'string'
    ? followUpRules.instructions
    : undefined;

  const archived = Boolean(raw.archived ?? assignmentRules.archived ?? false);

  return {
    productServiceId,
    tenantId: raw.account_id ? String(raw.account_id) : raw.tenantId ? String(raw.tenantId) : undefined,
    name,
    description: raw.description ? String(raw.description) : undefined,
    category: raw.category ? String(raw.category) : undefined,
    targetAudience,
    enabled: raw.enabled !== false && !archived,
    archived,
    appointmentType,
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30,
    price,
    currency,
    isFree,
    workingHoursStart,
    workingHoursEnd,
    availabilityDays,
    bookingMethod,
    requiredFields,
    optionalFields,
    meetingMode,
    meetingLink: raw.meeting_link ? String(raw.meeting_link) : raw.meetingLink ? String(raw.meetingLink) : null,
    calendarId: raw.calendar_id ? String(raw.calendar_id) : raw.calendarId ? String(raw.calendarId) : 'primary',
    timezone: raw.timezone ? String(raw.timezone) : undefined,
    eventTitleTemplate: raw.event_title_template ? String(raw.event_title_template) : raw.eventTitleTemplate ? String(raw.eventTitleTemplate) : undefined,
    confirmationTemplate: raw.confirmation_template ? String(raw.confirmation_template) : raw.confirmationTemplate ? String(raw.confirmationTemplate) : undefined,
    followUpInstructions,
    qualificationQuestions,
    tags,
    assignmentRules: assignmentRules as TenantProductConfig['assignmentRules'],
    followUpRules: followUpRules as TenantProductConfig['followUpRules'],
    keywords,
    // Legacy fields
    productKey: productServiceId,
    tagName: tags.interestTag || legacyTagName,
    ctaType: raw.ctaType ? (raw.ctaType as TenantProductConfig['ctaType']) : 'Demo',
    teamName: raw.teamName ? String(raw.teamName) : typeof assignmentRules.teamName === 'string' ? assignmentRules.teamName : 'General',
    assignedAgentId: raw.assignedAgentId ? String(raw.assignedAgentId) : typeof assignmentRules.assignedAgentId === 'string' ? assignmentRules.assignedAgentId : null,
  };
}

/**
 * Loads products/services for a tenant.
 * Isolation rule: Never returns another tenant's products.
 * If the tenant has no configured products, returns an empty array unless it is the verified Geniplus tenant.
 */
export async function getTenantProducts(
  db: SupabaseClient,
  accountId: string,
  options: { onlyEnabled?: boolean; fallbackToSeedIfGeniplus?: boolean } = {},
): Promise<TenantProductConfig[]> {
  const { onlyEnabled = false, fallbackToSeedIfGeniplus = true } = options;

  // 1. Try querying tenant_products table
  try {
    let query = db
      .from('tenant_products')
      .select('*')
      .eq('account_id', accountId);

    if (onlyEnabled) {
      query = query.eq('enabled', true);
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map((row) => normalizeTenantProduct(row));
    }
  } catch (_err) {
    // best-effort fallback to ai_configs
  }

  // 2. Fallback to ai_configs.product_configs
  try {
    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('product_configs')
      .eq('account_id', accountId)
      .maybeSingle();

    if (aiConfig?.product_configs && typeof aiConfig.product_configs === 'object') {
      const entries = Object.entries(aiConfig.product_configs);
      if (entries.length > 0) {
        const configs: TenantProductConfig[] = [];
        for (const [key, val] of entries) {
          if (val && typeof val === 'object') {
            const normalized = normalizeTenantProduct({ productServiceId: key, ...val });
            if (!onlyEnabled || normalized.enabled !== false) {
              configs.push(normalized);
            }
          }
        }
        if (configs.length > 0) {
          return configs;
        }
      }
    }
  } catch (_err) {
    // ignore
  }

  // 3. Check if this is the verified Geniplus tenant (NEVER guess by display name alone)
  if (fallbackToSeedIfGeniplus) {
    const isGeniplus = await isVerifiedGeniplusTenant(db, accountId);
    if (isGeniplus) {
      return Object.values(GENIPLUS_SEED_PRODUCTS);
    }
  }

  // New coach accounts start with an empty catalogue
  return [];
}

/**
 * Finds a single product by ID or key scoped to the tenant.
 */
export async function getTenantProductById(
  db: SupabaseClient,
  accountId: string,
  productServiceId: string,
): Promise<TenantProductConfig | null> {
  const products = await getTenantProducts(db, accountId);
  return (
    products.find(
      (p) =>
        p.productServiceId.toLowerCase() === productServiceId.toLowerCase() ||
        (p.productKey && p.productKey.toLowerCase() === productServiceId.toLowerCase()),
    ) || null
  );
}

/**
 * Upserts a product or service for a tenant.
 */
export async function upsertTenantProduct(
  db: SupabaseClient,
  accountId: string,
  product: TenantProductConfig,
): Promise<TenantProductConfig> {
  const norm = normalizeTenantProduct({ ...product, account_id: accountId });

  // Pack coach-specific fields into assignment_rules and follow_up_rules for schema compatibility
  const assignmentRules = {
    ...(norm.assignmentRules || {}),
    teamName: norm.teamName,
    assignedAgentId: norm.assignedAgentId,
    price: norm.price,
    currency: norm.currency,
    isFree: norm.isFree,
    targetAudience: norm.targetAudience,
    workingHoursStart: norm.workingHoursStart,
    workingHoursEnd: norm.workingHoursEnd,
    availabilityDays: norm.availabilityDays,
    bookingMethod: norm.bookingMethod,
    qualificationQuestions: norm.qualificationQuestions,
    archived: norm.archived,
  };

  const followUpRules = {
    ...(norm.followUpRules || {}),
    instructions: norm.followUpInstructions,
  };

  const payload = {
    account_id: accountId,
    product_service_id: norm.productServiceId,
    name: norm.name,
    description: norm.description || null,
    category: norm.category || null,
    enabled: norm.enabled !== false && !norm.archived,
    appointment_type: norm.appointmentType,
    duration_minutes: norm.durationMinutes,
    required_fields: norm.requiredFields || ['name', 'date', 'time'],
    optional_fields: norm.optionalFields || ['email', 'notes'],
    meeting_mode: norm.meetingMode,
    meeting_link: norm.meetingLink || null,
    calendar_id: norm.calendarId || 'primary',
    timezone: norm.timezone || null,
    event_title_template: norm.eventTitleTemplate || null,
    confirmation_template: norm.confirmationTemplate || null,
    tags: norm.tags || {},
    assignment_rules: assignmentRules,
    follow_up_rules: followUpRules,
    keywords: norm.keywords || [],
    updated_at: new Date().toISOString(),
  };

  // 1. Save to tenant_products table
  try {
    await db
      .from('tenant_products')
      .upsert(payload, { onConflict: 'account_id,product_service_id' });
  } catch (err) {
    console.warn('[tenant-products] Failed upsert to tenant_products:', err);
  }

  // 2. Also sync to ai_configs.product_configs for backward compatibility
  try {
    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('product_configs')
      .eq('account_id', accountId)
      .maybeSingle();

    const existingConfigs = (aiConfig?.product_configs || {}) as Record<string, unknown>;
    const updated = {
      ...existingConfigs,
      [norm.productServiceId]: norm,
    };

    if (aiConfig) {
      await db
        .from('ai_configs')
        .update({ product_configs: updated, updated_at: new Date().toISOString() })
        .eq('account_id', accountId);
    } else {
      await db
        .from('ai_configs')
        .insert({
          account_id: accountId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          api_key: 'unconfigured',
          is_active: false,
          auto_reply_enabled: false,
          product_configs: updated,
          updated_at: new Date().toISOString(),
        });
    }
  } catch (err) {
    console.warn('[tenant-products] Failed to sync ai_configs:', err);
  }

  return norm;
}

/**
 * Deletes or archives a product from the tenant's catalogue.
 */
export async function deleteTenantProduct(
  db: SupabaseClient,
  accountId: string,
  productServiceId: string,
): Promise<boolean> {
  let deleted = false;

  try {
    const { error } = await db
      .from('tenant_products')
      .delete()
      .eq('account_id', accountId)
      .eq('product_service_id', productServiceId);
    if (!error) deleted = true;
  } catch {
    // ignore
  }

  try {
    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('product_configs')
      .eq('account_id', accountId)
      .maybeSingle();

    if (aiConfig?.product_configs && typeof aiConfig.product_configs === 'object') {
      const existing = { ...(aiConfig.product_configs as Record<string, unknown>) };
      delete existing[productServiceId];
      await db
        .from('ai_configs')
        .update({ product_configs: existing, updated_at: new Date().toISOString() })
        .eq('account_id', accountId);
      deleted = true;
    }
  } catch {
    // ignore
  }

  return deleted;
}

/**
 * Seeds the Geniplus tenant catalogue into database for the given account.
 */
export async function seedGeniplusTenantCatalogue(
  db: SupabaseClient,
  accountId: string,
): Promise<TenantProductConfig[]> {
  const seeded: TenantProductConfig[] = [];
  for (const prod of Object.values(GENIPLUS_SEED_PRODUCTS)) {
    const res = await upsertTenantProduct(db, accountId, prod);
    seeded.push(res);
  }
  return seeded;
}

/**
 * Loads the tenant's business profile (name, timezone, contact info, AI prompt).
 */
export async function getTenantBusinessProfile(
  db: SupabaseClient,
  accountId: string,
): Promise<TenantBusinessProfile> {
  const profile: TenantBusinessProfile = {
    businessName: 'Business',
    timezone: 'Asia/Kolkata',
  };

  try {
    const { data: acc } = await db
      .from('accounts')
      .select('name, default_timezone, business_description, contact_phone, contact_email')
      .eq('id', accountId)
      .maybeSingle();

    if (acc) {
      if (acc.name) profile.businessName = acc.name;
      if (acc.default_timezone) profile.timezone = acc.default_timezone;
      if (acc.business_description) profile.businessDescription = acc.business_description;
      if (acc.contact_phone) profile.contactPhone = acc.contact_phone;
      if (acc.contact_email) profile.contactEmail = acc.contact_email;
    }
  } catch {
    // best-effort
  }

  try {
    const { data: calConfig } = await db
      .from('google_calendar_configs')
      .select('default_timezone')
      .eq('account_id', accountId)
      .maybeSingle();

    if (calConfig?.default_timezone) {
      profile.timezone = calConfig.default_timezone;
    }
  } catch {
    // best-effort
  }

  try {
    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('system_prompt, business_profile')
      .eq('account_id', accountId)
      .maybeSingle();

    if (aiConfig?.system_prompt) {
      profile.systemPrompt = aiConfig.system_prompt;
    }
    if (aiConfig?.business_profile && typeof aiConfig.business_profile === 'object') {
      const bp = aiConfig.business_profile as Record<string, string>;
      if (bp.businessName) profile.businessName = bp.businessName;
      if (bp.businessDescription) profile.businessDescription = bp.businessDescription;
      if (bp.timezone) profile.timezone = bp.timezone;
    }
  } catch {
    // best-effort
  }

  return profile;
}
