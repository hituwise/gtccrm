import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountWallet, BillingTransaction } from '@/types';

export const DEFAULT_RATES = {
  currency: 'INR',
  marketing_rate: 0.88,
  utility_rate: 0.15,
  auth_rate: 0.15,
  service_rate: 0.30,
  low_balance_threshold: 100.00,
};

const WALLET_FALLBACK_PREFIX = '__wacrm_wallet__:';

interface FallbackWalletState {
  balance: number;
  currency: string;
  marketing_rate: number;
  utility_rate: number;
  auth_rate: number;
  service_rate: number;
  low_balance_threshold: number;
  transactions: BillingTransaction[];
}

/**
 * Calculate the estimated cost for sending a template broadcast.
 */
export function calculateBroadcastCost(
  category: string | undefined | null,
  recipientCount: number,
  rates: {
    marketing_rate?: number;
    utility_rate?: number;
    auth_rate?: number;
    service_rate?: number;
  } = DEFAULT_RATES
): {
  costPerMessage: number;
  totalCost: number;
  categoryLabel: string;
  category: 'Marketing' | 'Utility' | 'Authentication' | 'Service';
} {
  const norm = (category || 'marketing').trim().toLowerCase();

  let costPerMessage = rates.marketing_rate ?? DEFAULT_RATES.marketing_rate;
  let categoryLabel = 'Marketing';
  let cat: 'Marketing' | 'Utility' | 'Authentication' | 'Service' = 'Marketing';

  if (norm.includes('util')) {
    costPerMessage = rates.utility_rate ?? DEFAULT_RATES.utility_rate;
    categoryLabel = 'Utility';
    cat = 'Utility';
  } else if (norm.includes('auth')) {
    costPerMessage = rates.auth_rate ?? DEFAULT_RATES.auth_rate;
    categoryLabel = 'Authentication';
    cat = 'Authentication';
  } else if (norm.includes('service')) {
    costPerMessage = rates.service_rate ?? DEFAULT_RATES.service_rate;
    categoryLabel = 'Service';
    cat = 'Service';
  }

  const count = Math.max(0, recipientCount);
  const totalCost = Math.round(count * costPerMessage * 100) / 100;

  return {
    costPerMessage,
    totalCost,
    categoryLabel,
    category: cat,
  };
}

/**
 * Load wallet info for the given account.
 * Uses `account_wallets` table with seamless fallback to `whatsapp_config`.
 */
export async function getAccountWallet(
  db: SupabaseClient,
  accountId: string
): Promise<AccountWallet> {
  try {
    const { data, error } = await db
      .from('account_wallets')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!error && data) {
      return {
        account_id: accountId,
        balance: Number(data.balance ?? 0),
        currency: data.currency ?? DEFAULT_RATES.currency,
        marketing_rate: Number(data.marketing_rate ?? DEFAULT_RATES.marketing_rate),
        utility_rate: Number(data.utility_rate ?? DEFAULT_RATES.utility_rate),
        auth_rate: Number(data.auth_rate ?? DEFAULT_RATES.auth_rate),
        service_rate: Number(data.service_rate ?? DEFAULT_RATES.service_rate),
        low_balance_threshold: Number(data.low_balance_threshold ?? DEFAULT_RATES.low_balance_threshold),
        updated_at: data.updated_at ?? new Date().toISOString(),
      };
    }
  } catch {
    // ignore table lookup failure and fallback
  }

  // Fallback to whatsapp_config storage
  const fallback = await readFallbackWallet(db, accountId);
  return {
    account_id: accountId,
    balance: fallback.balance,
    currency: fallback.currency,
    marketing_rate: fallback.marketing_rate,
    utility_rate: fallback.utility_rate,
    auth_rate: fallback.auth_rate,
    service_rate: fallback.service_rate,
    low_balance_threshold: fallback.low_balance_threshold,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Load recent billing transactions / fund additions.
 */
export async function getBillingTransactions(
  db: SupabaseClient,
  accountId: string,
  limit = 20
): Promise<BillingTransaction[]> {
  try {
    const { data, error } = await db
      .from('account_billing_funds')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row) => ({
        id: row.id,
        account_id: row.account_id,
        user_id: row.user_id,
        type: row.type as 'credit' | 'debit',
        amount: Number(row.amount),
        balance_after: Number(row.balance_after),
        description: row.description,
        reference: row.reference,
        broadcast_id: row.broadcast_id,
        created_at: row.created_at,
      }));
    }
  } catch {
    // ignore and check fallback
  }

  const fallback = await readFallbackWallet(db, accountId);
  return fallback.transactions.slice(0, limit);
}

/**
 * Add / recharge funds for an account.
 */
export async function addAccountFunds(
  db: SupabaseClient,
  params: {
    accountId: string;
    userId?: string | null;
    amount: number;
    description: string;
    reference?: string | null;
  }
): Promise<{ success: boolean; newBalance: number }> {
  const { accountId, userId, amount, description, reference } = params;
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  const currentWallet = await getAccountWallet(db, accountId);
  const newBalance = Math.round((currentWallet.balance + amount) * 100) / 100;
  const now = new Date().toISOString();

  const newTx: BillingTransaction = {
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    account_id: accountId,
    user_id: userId ?? null,
    type: 'credit',
    amount,
    balance_after: newBalance,
    description: description || 'Messaging Funds Added',
    reference: reference || null,
    created_at: now,
  };

  // Try real database tables first
  try {
    await db.from('account_wallets').upsert(
      {
        account_id: accountId,
        balance: newBalance,
        currency: currentWallet.currency,
        marketing_rate: currentWallet.marketing_rate,
        utility_rate: currentWallet.utility_rate,
        auth_rate: currentWallet.auth_rate,
        service_rate: currentWallet.service_rate,
        low_balance_threshold: currentWallet.low_balance_threshold,
        updated_at: now,
      },
      { onConflict: 'account_id' }
    );

    await db.from('account_billing_funds').insert({
      account_id: accountId,
      user_id: userId ?? null,
      type: 'credit',
      amount,
      balance_after: newBalance,
      description: newTx.description,
      reference: newTx.reference,
      created_at: now,
    });
  } catch (err) {
    console.warn('[wallet] SQL tables insert failed, relying on fallback:', err);
  }

  // Also sync to fallback storage
  const fallback = await readFallbackWallet(db, accountId);
  fallback.balance = newBalance;
  fallback.transactions.unshift(newTx);
  if (fallback.transactions.length > 50) {
    fallback.transactions = fallback.transactions.slice(0, 50);
  }
  await writeFallbackWallet(db, accountId, fallback);

  return { success: true, newBalance };
}

/**
 * Deduct funds for a broadcast sent.
 */
export async function deductBroadcastFunds(
  db: SupabaseClient,
  params: {
    accountId: string;
    broadcastId: string;
    amount: number;
    description: string;
  }
): Promise<{ success: boolean; newBalance: number }> {
  const { accountId, broadcastId, amount, description } = params;
  if (!amount || amount <= 0) return { success: true, newBalance: 0 };

  const currentWallet = await getAccountWallet(db, accountId);
  const newBalance = Math.round(Math.max(0, currentWallet.balance - amount) * 100) / 100;
  const now = new Date().toISOString();

  const newTx: BillingTransaction = {
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    account_id: accountId,
    type: 'debit',
    amount,
    balance_after: newBalance,
    description: description || `Broadcast Campaign (${broadcastId})`,
    broadcast_id: broadcastId,
    created_at: now,
  };

  try {
    await db.from('account_wallets').upsert(
      {
        account_id: accountId,
        balance: newBalance,
        updated_at: now,
      },
      { onConflict: 'account_id' }
    );

    await db.from('account_billing_funds').insert({
      account_id: accountId,
      type: 'debit',
      amount,
      balance_after: newBalance,
      description: newTx.description,
      broadcast_id: broadcastId,
      created_at: now,
    });
  } catch (err) {
    console.warn('[wallet] DB deduct error:', err);
  }

  const fallback = await readFallbackWallet(db, accountId);
  fallback.balance = newBalance;
  fallback.transactions.unshift(newTx);
  if (fallback.transactions.length > 50) {
    fallback.transactions = fallback.transactions.slice(0, 50);
  }
  await writeFallbackWallet(db, accountId, fallback);

  return { success: true, newBalance };
}

// -------------------------------------------------------------
// Fallback Storage Helpers (stored safely in whatsapp_config)
// -------------------------------------------------------------

async function readFallbackWallet(
  db: SupabaseClient,
  accountId: string
): Promise<FallbackWalletState> {
  const defaultState: FallbackWalletState = {
    balance: 1500.00, // Initial starter fund for convenience
    currency: DEFAULT_RATES.currency,
    marketing_rate: DEFAULT_RATES.marketing_rate,
    utility_rate: DEFAULT_RATES.utility_rate,
    auth_rate: DEFAULT_RATES.auth_rate,
    service_rate: DEFAULT_RATES.service_rate,
    low_balance_threshold: DEFAULT_RATES.low_balance_threshold,
    transactions: [
      {
        id: 'init_welcome',
        account_id: accountId,
        type: 'credit',
        amount: 1500.00,
        balance_after: 1500.00,
        description: 'Initial WhatsApp Messaging Fund',
        reference: 'WELCOME-FUNDS',
        created_at: new Date().toISOString(),
      },
    ],
  };

  try {
    const { data } = await db
      .from('whatsapp_config')
      .select('last_registration_error')
      .eq('account_id', accountId)
      .maybeSingle();

    const raw = data?.last_registration_error;
    if (raw && typeof raw === 'string' && raw.startsWith(WALLET_FALLBACK_PREFIX)) {
      const parsed = JSON.parse(raw.slice(WALLET_FALLBACK_PREFIX.length));
      return {
        ...defaultState,
        ...parsed,
      };
    }
  } catch {
    // ignore
  }

  return defaultState;
}

async function writeFallbackWallet(
  db: SupabaseClient,
  accountId: string,
  state: FallbackWalletState
): Promise<void> {
  try {
    const serialized = `${WALLET_FALLBACK_PREFIX}${JSON.stringify(state)}`;
    await db
      .from('whatsapp_config')
      .update({ last_registration_error: serialized })
      .eq('account_id', accountId);
  } catch (err) {
    console.warn('[wallet] writeFallbackWallet error:', err);
  }
}
