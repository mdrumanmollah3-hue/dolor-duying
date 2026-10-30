import { Bot, InlineKeyboard, Context } from 'grammy';
import {
  getSettings,
  getActiveBscWallet,
  createOrder,
  getUserProfileStats,
  BotSettings,
} from './services/supabase';

export interface UserSession {
  step:
    | 'idle'
    | 'awaiting_usdt_amount'
    | 'awaiting_payment_method'
    | 'awaiting_custom_method'
    | 'awaiting_account_number'
    | 'awaiting_confirmation'
    | 'awaiting_txid';
  usdtAmount?: number;
  dollarRate?: number;
  bdtAmount?: number;
  paymentMethod?: string;
  accountNumber?: string;
  bscAddress?: string;
}

// In-memory sessions indexed by Telegram User ID
const sessions = new Map<number, UserSession>();

function getSession(userId: number): UserSession {
  let session = sessions.get(userId);
  if (!session) {
    session = { step: 'idle' };
    sessions.set(userId, session);
  }
  return session;
}

function resetSession(userId: number) {
  sessions.set(userId, { step: 'idle' });
}

export function setupBot(botToken: string): Bot {
  const bot = new Bot(botToken);

  // Helper: check bot maintenance status
  const checkMaintenance = async (ctx: Context): Promise<BotSettings | null> => {
    const settings = await getSettings();
    if (!settings.bot_status) {
      await ctx.reply(
        `🚨 <b>BOT IS CURRENTLY CLOSED FOR MAINTENANCE</b>\n\n` +
          `📢 <i>${settings.maintenance_reason}</i>\n\n` +
          `We will resume dollar exchange services shortly. For emergencies, contact support: ${settings.contact_support_username}`,
        { parse_mode: 'HTML' }
      );
      return null;
    }
    return settings;
  };

  // Helper: build main menu keyboard
  const buildMainMenu = () => {
    return new InlineKeyboard()
      .text('💵 Sell USDT (Dollar)', 'action_sell_usdt')
      .row()
      .text('👤 My Profile', 'action_my_profile')
      .text('📈 Live Rate', 'action_live_rate')
      .row()
      .text('💬 Support & FAQ', 'action_support');
  };

  // ============================================================================
  // COMMAND: /start
  // ============================================================================
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    resetSession(userId);

    const settings = await checkMaintenance(ctx);
    if (!settings) return;

    const firstName = ctx.from?.first_name || 'Trader';

    const welcomeMsg = `
👋 <b>Welcome to Elite Dollar Exchange, ${firstName}!</b>

Sell your USDT (Binance Smart Chain BEP-20) safely and get instant payment in <b>bKash, Nagad, Rocket</b>, or Bank Transfer.

📊 <b>Current Exchange Rate:</b>
🔥 <b>1 USDT = ${settings.dollar_rate.toFixed(2)} BDT</b>
⚡ <i>Minimum: ${settings.min_usdt} USDT | Maximum: ${settings.max_usdt} USDT</i>
⏱ <i>Average payout time: 5–15 minutes</i>

Please tap below to start selling or view your profile:
`;

    await ctx.reply(welcomeMsg, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  // ============================================================================
  // ACTION: Sell USDT Initiation
  // ============================================================================
  bot.callbackQuery('action_sell_usdt', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const settings = await checkMaintenance(ctx);
    if (!settings) return;

    const session = getSession(userId);
    session.step = 'awaiting_usdt_amount';
    session.dollarRate = settings.dollar_rate;

    await ctx.reply(
      `💵 <b>Enter USDT Amount to Sell:</b>\n\n` +
        `Current Rate: <b>1 USDT = ${settings.dollar_rate.toFixed(2)} BDT</b>\n` +
        `Minimum: <b>${settings.min_usdt} USDT</b> | Maximum: <b>${settings.max_usdt} USDT</b>\n\n` +
        `<i>Please reply with the exact dollar amount you wish to sell (e.g. <code>50</code> or <code>120.5</code>):</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('❌ Cancel', 'action_cancel'),
      }
    );
  });

  // ============================================================================
  // ACTION: My Profile Feature
  // Queries Supabase and displays total completed orders count and USD traded
  // ============================================================================
  bot.callbackQuery('action_my_profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleProfileDisplay(ctx);
  });

  bot.command('profile', async (ctx) => {
    await handleProfileDisplay(ctx);
  });

  async function handleProfileDisplay(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;

    const stats = await getUserProfileStats(userId.toString());
    const firstName = ctx.from?.first_name || 'Trader';
    const username = ctx.from?.username ? `@${ctx.from.username}` : 'Not set';

    // Tier badge calculation based on total volume
    let tierBadge = '🥉 Bronze Trader';
    if (stats.total_usd_traded >= 5000) {
      tierBadge = '💎 Elite Diamond Trader';
    } else if (stats.total_usd_traded >= 1000) {
      tierBadge = '🥇 Gold Trader';
    } else if (stats.total_usd_traded >= 250) {
      tierBadge = '🥈 Silver Trader';
    }

    const profileText = `
👤 <b>USER PROFILE & TRADING METRICS</b>
━━━━━━━━━━━━━━━━━━━
📛 <b>Name:</b> ${firstName}
🆔 <b>Telegram ID:</b> <code>${userId}</code>
🔗 <b>Username:</b> ${username}
🏆 <b>Trading Rank:</b> <b>${tierBadge}</b>
━━━━━━━━━━━━━━━━━━━
📈 <b>TRADING LIFETIME STATS:</b>
✅ <b>Completed Orders:</b> <b>${stats.total_completed_orders} orders</b>
💰 <b>Total USD Sold:</b> <b>$${stats.total_usd_traded.toFixed(2)} USDT</b>
💵 <b>Total BDT Received:</b> <b>${stats.total_bdt_received.toLocaleString()} BDT</b>
⏳ <b>Currently Pending:</b> <b>${stats.pending_orders_count} orders</b>
━━━━━━━━━━━━━━━━━━━
🛡 <i>All transactions are recorded on Supabase & verified on Binance Smart Chain.</i>
`;

    const keyboard = new InlineKeyboard()
      .text('💵 Sell USDT Now', 'action_sell_usdt')
      .row()
      .text('🔙 Back to Main Menu', 'action_main_menu');

    await ctx.reply(profileText, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ============================================================================
  // ACTION: Live Rate Check
  // ============================================================================
  bot.callbackQuery('action_live_rate', async (ctx) => {
    await ctx.answerCallbackQuery();
    const settings = await getSettings();

    const rateMsg = `
📊 <b>LIVE DOLLAR EXCHANGE RATE</b>
━━━━━━━━━━━━━━━━━━━
🔥 <b>1 USDT = ${settings.dollar_rate.toFixed(2)} BDT</b>
Min Trade: <b>${settings.min_usdt} USDT</b>
Max Trade: <b>${settings.max_usdt} USDT</b>
Network: <b>Binance Smart Chain (BEP-20)</b>
Payout Methods: <b>bKash, Nagad, Rocket, Custom/Bank</b>
━━━━━━━━━━━━━━━━━━━
<i>Rates are adjusted dynamically by admin in real-time according to market liquidity.</i>
`;

    await ctx.reply(rateMsg, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('💵 Sell USDT Now', 'action_sell_usdt')
        .row()
        .text('🔙 Main Menu', 'action_main_menu'),
    });
  });

  // ============================================================================
  // ACTION: Support
  // ============================================================================
  bot.callbackQuery('action_support', async (ctx) => {
    await ctx.answerCallbackQuery();
    const settings = await getSettings();

    await ctx.reply(
      `💬 <b>SUPPORT & ASSISTANCE</b>\n\n` +
        `If you need help with your orders, TXID verification, or payout delays, please contact our official administrator:\n\n` +
        `👤 <b>Admin Support:</b> ${settings.contact_support_username}\n` +
        `⏰ <b>Operating Hours:</b> 24/7 Fast Response\n` +
        `⚠️ <i>We will NEVER ask for your private keys or seed phrase!</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔙 Main Menu', 'action_main_menu'),
      }
    );
  });

  // ============================================================================
  // ACTION: Back to Main Menu
  // ============================================================================
  bot.callbackQuery('action_main_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (userId) resetSession(userId);

    const settings = await getSettings();
    await ctx.reply(`👋 <b>Main Menu:</b>\nCurrent Rate: <b>1 USDT = ${settings.dollar_rate.toFixed(2)} BDT</b>`, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  // ============================================================================
  // ACTION: Cancel
  // ============================================================================
  bot.callbackQuery('action_cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Operation cancelled' });
    const userId = ctx.from?.id;
    if (userId) resetSession(userId);

    await ctx.reply('❌ <i>Transaction cancelled. You can start over whenever you are ready.</i>', {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  // ============================================================================
  // PAYMENT METHOD CALLBACKS
  // ============================================================================
  bot.callbackQuery(/^pay_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = getSession(userId);
    const chosen = ctx.match[1];

    if (chosen === 'others') {
      session.step = 'awaiting_custom_method';
      await ctx.reply(
        `✍️ <b>Custom Payment Method:</b>\n\n` +
          `Please type the name of your desired payment service (e.g. <code>Upay</code>, <code>CellFin</code>, <code>City Bank</code>, <code>Brac Bank</code>):`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('❌ Cancel', 'action_cancel'),
        }
      );
      return;
    }

    let methodName = 'bKash (Personal)';
    if (chosen === 'bkash') methodName = 'bKash (Personal)';
    if (chosen === 'nagad') methodName = 'Nagad (Personal)';
    if (chosen === 'rocket') methodName = 'Rocket';

    session.paymentMethod = methodName;
    session.step = 'awaiting_account_number';

    await ctx.reply(
      `📱 <b>Enter Your ${methodName} Account Number:</b>\n\n` +
        `Please provide the 11-digit mobile account number where you want to receive the <b>${session.bdtAmount?.toLocaleString()} BDT</b>:`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('❌ Cancel', 'action_cancel'),
      }
    );
  });

  // ============================================================================
  // ORDER CONFIRMATION CALLBACKS: [Confirm] / [Reject]
  // ============================================================================
  bot.callbackQuery('confirm_order_details', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = getSession(userId);
    if (!session.usdtAmount || !session.paymentMethod || !session.accountNumber) {
      await ctx.reply('⚠️ Session expired. Please /start again.', {
        reply_markup: buildMainMenu(),
      });
      return;
    }

    // Fetch active BSC wallet from Supabase
    const activeWallet = await getActiveBscWallet();
    if (!activeWallet) {
      await ctx.reply(
        '⚠️ <b>Deposit Address Unavailable:</b>\nNo active BSC wallet is currently configured. Please contact support.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    session.bscAddress = activeWallet.wallet_address;
    session.step = 'awaiting_txid';

    const depositMsg = `
🏦 <b>SEND USDT TO ADMIN BSC ADDRESS</b>
━━━━━━━━━━━━━━━━━━━
💵 <b>Exact Amount to Send:</b> <code>${session.usdtAmount.toFixed(2)}</code> <b>USDT</b>
🌐 <b>Network:</b> <b>Binance Smart Chain (BEP-20)</b>

📋 <b>Admin BEP-20 Deposit Address:</b>
<code>${activeWallet.wallet_address}</code>
<i>(Tap address above to copy)</i>
━━━━━━━━━━━━━━━━━━━
⚠️ <b>IMPORTANT 15-MINUTE NOTICE:</b>
• You have <b>15 minutes</b> to transfer the funds on BSC network.
• Make sure to select <b>BNB Smart Chain (BEP20)</b> to avoid permanent loss.
• After transferring, copy the <b>Transaction Hash / TXID</b> and paste it below!

✍️ <b>Please reply now with your Transaction Hash (TXID):</b>
`;

    await ctx.reply(depositMsg, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('❌ Cancel Order', 'action_cancel'),
    });
  });

  bot.callbackQuery('reject_order_details', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Order cancelled' });
    const userId = ctx.from?.id;
    if (userId) resetSession(userId);

    await ctx.reply('❌ <b>Order Cancelled.</b> No transaction has been created.', {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  // ============================================================================
  // TEXT MESSAGE HANDLER (Handles conversation steps)
  // ============================================================================
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = getSession(userId);
    const text = ctx.message.text.trim();

    // Ignore commands in this state handler
    if (text.startsWith('/')) return;

    // STEP 1: Awaiting USDT Amount
    if (session.step === 'awaiting_usdt_amount') {
      const amount = parseFloat(text);
      const settings = await getSettings();

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('⚠️ Please enter a valid positive numeric amount (e.g. 50 or 100):');
        return;
      }

      if (amount < settings.min_usdt) {
        await ctx.reply(`⚠️ Minimum sell amount is <b>${settings.min_usdt} USDT</b>. Please enter a larger amount:`, {
          parse_mode: 'HTML',
        });
        return;
      }

      if (amount > settings.max_usdt) {
        await ctx.reply(`⚠️ Maximum sell amount is <b>${settings.max_usdt} USDT</b> per order. Please enter a smaller amount:`, {
          parse_mode: 'HTML',
        });
        return;
      }

      session.usdtAmount = amount;
      session.dollarRate = settings.dollar_rate;
      session.bdtAmount = parseFloat((amount * settings.dollar_rate).toFixed(2));
      session.step = 'awaiting_payment_method';

      const methodKeyboard = new InlineKeyboard()
        .text('🟢 bKash', 'pay_bkash')
        .text('🟠 Nagad', 'pay_nagad')
        .row()
        .text('🟣 Rocket', 'pay_rocket')
        .text('🌐 Others / Custom', 'pay_others')
        .row()
        .text('❌ Cancel', 'action_cancel');

      await ctx.reply(
        `💰 <b>Selling:</b> <b>${amount.toFixed(2)} USDT</b>\n` +
          `📈 <b>Rate:</b> 1 USDT = ${settings.dollar_rate.toFixed(2)} BDT\n` +
          `💵 <b>Total Payout:</b> <b>${session.bdtAmount.toLocaleString()} BDT</b>\n\n` +
          `Please select your receiving payment method below:`,
        {
          parse_mode: 'HTML',
          reply_markup: methodKeyboard,
        }
      );
      return;
    }

    // STEP 2B: Awaiting Custom Payment Method Name
    if (session.step === 'awaiting_custom_method') {
      if (text.length < 2) {
        await ctx.reply('⚠️ Please enter a valid payment method name (e.g. Upay, City Bank):');
        return;
      }

      session.paymentMethod = text;
      session.step = 'awaiting_account_number';

      await ctx.reply(
        `📱 <b>Enter Your ${text} Account / Details:</b>\n\n` +
          `Please provide the account / phone / bank info to receive the <b>${session.bdtAmount?.toLocaleString()} BDT</b>:`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('❌ Cancel', 'action_cancel'),
        }
      );
      return;
    }

    // STEP 3: Awaiting Account Number & Presenting Confirmation
    if (session.step === 'awaiting_account_number') {
      if (text.length < 5) {
        await ctx.reply('⚠️ Please enter a valid account or phone number:');
        return;
      }

      session.accountNumber = text;
      session.step = 'awaiting_confirmation';

      const confirmSummary = `
🧾 <b>ORDER CONFIRMATION SUMMARY</b>
━━━━━━━━━━━━━━━━━━━
💵 <b>Selling Amount:</b> <b>${session.usdtAmount?.toFixed(2)} USDT</b>
📈 <b>Exchange Rate:</b> <b>1 USDT = ${session.dollarRate?.toFixed(2)} BDT</b>
💰 <b>Total to Receive:</b> <b>${session.bdtAmount?.toLocaleString()} BDT</b>
💳 <b>Payment Method:</b> <b>${session.paymentMethod}</b>
📱 <b>Account Number:</b> <code>${session.accountNumber}</code>
━━━━━━━━━━━━━━━━━━━
<i>Please verify all details carefully before confirming.</i>
`;

      const confirmKeyboard = new InlineKeyboard()
        .text('✅ Confirm Order', 'confirm_order_details')
        .text('❌ Reject / Cancel', 'reject_order_details');

      await ctx.reply(confirmSummary, {
        parse_mode: 'HTML',
        reply_markup: confirmKeyboard,
      });
      return;
    }

    // STEP 5: Awaiting TXID and Creating Pending Order
    if (session.step === 'awaiting_txid') {
      if (text.length < 10) {
        await ctx.reply('⚠️ That does not look like a valid transaction hash (TXID). Please paste the full TXID:');
        return;
      }

      const txid = text;
      const username = ctx.from?.username || null;
      const fullName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'User';

      try {
        const order = await createOrder({
          telegram_id: userId.toString(),
          username: username,
          user_full_name: fullName,
          amount_usdt: session.usdtAmount!,
          dollar_rate: session.dollarRate!,
          bdt_amount: session.bdtAmount!,
          payment_method: session.paymentMethod!,
          account_number: session.accountNumber!,
          bsc_address_given: session.bscAddress!,
          txid: txid,
        });

        // Reset session back to idle
        resetSession(userId);

        const shortId = order.id.slice(0, 8).toUpperCase();
        const successMsg = `
⏳ <b>ORDER SUBMITTED SUCCESSFULLY!</b>
━━━━━━━━━━━━━━━━━━━
📋 <b>Order ID:</b> <code>#${shortId}</code>
💵 <b>Amount USDT:</b> <b>${order.amount_usdt.toFixed(2)} USDT</b>
💰 <b>Receiving BDT:</b> <b>${order.bdt_amount.toLocaleString()} BDT</b>
💳 <b>Payment Method:</b> <b>${order.payment_method}</b>
📱 <b>Account:</b> <code>${order.account_number}</code>
🔗 <b>TXID:</b> <code>${txid}</code>
━━━━━━━━━━━━━━━━━━━
⚡ <b>Status:</b> <b>⏳ Pending Verification</b>

🕒 <i>Your order is now being verified by the admin team. Payment is usually sent within 5–15 minutes. You will receive an instant notification here once payment is released!</i>
`;

        await ctx.reply(successMsg, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('👤 View My Profile', 'action_my_profile')
            .row()
            .text('🔙 Back to Main Menu', 'action_main_menu'),
        });
      } catch (err: any) {
        console.error('Error creating order in Supabase:', err);
        await ctx.reply(
          `❌ <b>Error Placing Order:</b> ${err.message || 'Database error'}. Please try again or contact support.`,
          {
            parse_mode: 'HTML',
            reply_markup: buildMainMenu(),
          }
        );
      }
      return;
    }

    // Default response if message received outside any step
    await ctx.reply(`👋 Welcome! Please use the buttons below to trade or view your profile:`, {
      reply_markup: buildMainMenu(),
    });
  });

  return bot;
}
