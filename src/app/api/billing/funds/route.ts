import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getAccountWallet,
  getBillingTransactions,
  addAccountFunds,
  getMetaBillingDetails,
  updateMetaCurrentBalance,
} from '@/lib/billing/wallet';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const metaBilling = await getMetaBillingDetails(ctx.supabase, ctx.accountId);
    const wallet = await getAccountWallet(ctx.supabase, ctx.accountId);
    const transactions = await getBillingTransactions(ctx.supabase, ctx.accountId, 30);

    return NextResponse.json({
      metaBilling,
      wallet,
      transactions,
      lowBalance: metaBilling.currentBalance < wallet.low_balance_threshold,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    // Only agents/admins/owners can manage funds
    const ctx = await requireRole('agent');
    const body = await req.json().catch(() => ({}));

    // If updating current Meta balance
    if (body.current_balance !== undefined) {
      const bal = Number(body.current_balance);
      if (isNaN(bal) || bal < 0) {
        return NextResponse.json(
          { error: 'Please enter a valid balance' },
          { status: 400 }
        );
      }
      await updateMetaCurrentBalance(ctx.supabase, ctx.accountId, bal);
      const metaBilling = await getMetaBillingDetails(ctx.supabase, ctx.accountId);
      return NextResponse.json({
        success: true,
        currentBalance: bal,
        metaBilling,
      });
    }

    const amount = Number(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Please enter a valid positive amount' },
        { status: 400 }
      );
    }

    const description = body.description || 'Messaging Funds Top-up';
    const reference = body.reference || null;

    const result = await addAccountFunds(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      amount,
      description,
      reference,
    });

    const updatedWallet = await getAccountWallet(ctx.supabase, ctx.accountId);

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      wallet: updatedWallet,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
