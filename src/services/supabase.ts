import { supabase } from '../config';

export interface BotSettings {
  id: number;
  bot_status: boolean;
  maintenance_reason: string;
  dollar_rate: number;
  min_usdt: number;
  max_usdt: number;
  contact_support_username: string;
}

export interface BscWallet {
  id: string;
  wallet_address: string;
  label: string;
  is_active: boolean;
}

export interface OrderRecord {
  id: string;
  telegram_id: string;
  username: string | null;
  user_full_name: string | null;
  amount_usdt: number;
  dollar_rate: number;
  bdt_amount: number;
  payment_method: string;
  account_number: string;
  bsc_address_given: string;
  txid: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  admin_note?: string | null;
  created_at: string;
}

export interface UserStats {
  total_completed_orders: number;
  total_usd_traded: number;
  total_bdt_received: number;
  pending_orders_count: number;
}

/**
 * Fetch current operational settings from Supabase
 */
export async function getSettings(): Promise<BotSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.error('Error fetching settings from Supabase:', error);
    // Fallback default safe settings
    return {
      id: 1,
      bot_status: true,
      maintenance_reason: 'Bot is undergoing maintenance. Please check back soon.',
      dollar_rate: 125.50,
      min_usdt: 5.0,
      max_usdt: 5000.0,
      contact_support_username: '@AdminSupport',
    };
  }

  return {
    id: data.id,
    bot_status: Boolean(data.bot_status),
    maintenance_reason: data.maintenance_reason || 'System is undergoing maintenance.',
    dollar_rate: parseFloat(data.dollar_rate) || 125.50,
    min_usdt: parseFloat(data.min_usdt) || 5.0,
    max_usdt: parseFloat(data.max_usdt) || 5000.0,
    contact_support_username: data.contact_support_username || '@AdminSupport',
  };
}

/**
 * Fetch an active Binance Smart Chain (BEP-20) address from Supabase
 */
export async function getActiveBscWallet(): Promise<BscWallet | null> {
  const { data, error } = await supabase
    .from('bsc_wallets')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching active BSC wallet:', error);
    return null;
  }

  return data as BscWallet | null;
}

/**
 * Insert a new pending sell order into Supabase
 */
export async function createOrder(order: {
  telegram_id: string;
  username: string | null;
  user_full_name: string | null;
  amount_usdt: number;
  dollar_rate: number;
  bdt_amount: number;
  payment_method: string;
  account_number: string;
  bsc_address_given: string;
  txid: string;
}): Promise<OrderRecord> {
  const { data, error } = await supabase
    .from('orders')
    .insert([
      {
        telegram_id: order.telegram_id,
        username: order.username,
        user_full_name: order.user_full_name,
        amount_usdt: order.amount_usdt,
        dollar_rate: order.dollar_rate,
        bdt_amount: order.bdt_amount,
        payment_method: order.payment_method,
        account_number: order.account_number,
        bsc_address_given: order.bsc_address_given,
        txid: order.txid,
        status: 'pending',
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create order in Supabase: ${error?.message}`);
  }

  return data as OrderRecord;
}

/**
 * Get user profile trade statistics
 */
export async function getUserProfileStats(telegramId: string): Promise<UserStats> {
  // Try stored procedure first
  const { data, error } = await supabase.rpc('get_user_profile_stats', {
    p_telegram_id: telegramId,
  });

  if (!error && data && data.length > 0) {
    const row = data[0];
    return {
      total_completed_orders: parseInt(row.total_completed_orders, 10) || 0,
      total_usd_traded: parseFloat(row.total_usd_traded) || 0.0,
      total_bdt_received: parseFloat(row.total_bdt_received) || 0.0,
      pending_orders_count: parseInt(row.pending_orders_count, 10) || 0,
    };
  }

  // Fallback: direct aggregate query
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('amount_usdt, bdt_amount, status')
    .eq('telegram_id', telegramId);

  if (ordersError || !orders) {
    return {
      total_completed_orders: 0,
      total_usd_traded: 0.0,
      total_bdt_received: 0.0,
      pending_orders_count: 0,
    };
  }

  const approved = orders.filter((o) => o.status === 'approved');
  const pending = orders.filter((o) => o.status === 'pending');

  const totalUsd = approved.reduce((sum, o) => sum + (parseFloat(o.amount_usdt) || 0), 0);
  const totalBdt = approved.reduce((sum, o) => sum + (parseFloat(o.bdt_amount) || 0), 0);

  return {
    total_completed_orders: approved.length,
    total_usd_traded: totalUsd,
    total_bdt_received: totalBdt,
    pending_orders_count: pending.length,
  };
}

/**
 * Setup Supabase Realtime Subscription on orders table
 * Automatically triggers callback when order status is updated by Admin in mobile app
 */
export function setupOrdersRealtimeSubscription(
  onStatusChange: (payload: {
    orderId: string;
    telegramId: string;
    status: string;
    adminNote?: string;
    bdtAmount: number;
    amountUsdt: number;
    paymentMethod: string;
    accountNumber: string;
    txid?: string;
  }) => void
) {
  const channel = supabase
    .channel('orders-realtime-bot')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
      },
      (payload) => {
        const newRecord = payload.new as any;
        const oldRecord = payload.old as any;

        // Trigger only if status actually changed
        if (newRecord && oldRecord && newRecord.status !== oldRecord.status) {
          onStatusChange({
            orderId: newRecord.id,
            telegramId: newRecord.telegram_id,
            status: newRecord.status,
            adminNote: newRecord.admin_note,
            bdtAmount: parseFloat(newRecord.bdt_amount) || 0,
            amountUsdt: parseFloat(newRecord.amount_usdt) || 0,
            paymentMethod: newRecord.payment_method,
            accountNumber: newRecord.account_number,
            txid: newRecord.txid,
          });
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Supabase Realtime] Orders subscription status: ${status}`);
    });

  return channel;
}
