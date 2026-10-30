import { Bot } from 'grammy';

/**
 * Format and deliver Telegram message to user when Admin approves their order
 */
export async function sendOrderApprovedNotification(
  bot: Bot<any>,
  data: {
    orderId: string;
    telegramId: string;
    bdtAmount: number;
    amountUsdt: number;
    paymentMethod: string;
    accountNumber: string;
    adminNote?: string;
  }
) {
  const shortId = data.orderId.slice(0, 8).toUpperCase();
  const message = `
🎉 <b>ORDER APPROVED & PAYMENT SENT!</b>

Your sell order has been verified and processed by the admin team.

━━━━━━━━━━━━━━━━━━━
📋 <b>Order ID:</b> <code>#${shortId}</code>
💵 <b>Sold Amount:</b> <b>${data.amountUsdt.toFixed(2)} USDT</b>
💰 <b>Paid Amount:</b> <b>${data.bdtAmount.toLocaleString()} BDT</b>
💳 <b>Payment Method:</b> <b>${data.paymentMethod}</b>
📱 <b>Account Sent To:</b> <code>${data.accountNumber}</code>
${data.adminNote ? `📝 <b>Admin Note:</b> ${data.adminNote}\n` : ''}━━━━━━━━━━━━━━━━━━━
⚡ <i>Please check your mobile wallet balance. Thank you for trading with us!</i>
`;

  try {
    await bot.api.sendMessage(data.telegramId, message, {
      parse_mode: 'HTML',
    });
    console.log(`[Notification] Order ${shortId} approval message delivered to ${data.telegramId}`);
  } catch (err) {
    console.error(`[Notification Error] Failed to send approval message to ${data.telegramId}:`, err);
  }
}

/**
 * Format and deliver Telegram message to user when Admin rejects their order
 */
export async function sendOrderRejectedNotification(
  bot: Bot<any>,
  data: {
    orderId: string;
    telegramId: string;
    amountUsdt: number;
    reason?: string;
  }
) {
  const shortId = data.orderId.slice(0, 8).toUpperCase();
  const reasonText = data.reason || 'Transaction could not be verified on the blockchain.';
  const message = `
❌ <b>ORDER REJECTED</b>

Your sell order could not be approved by the admin team.

━━━━━━━━━━━━━━━━━━━
📋 <b>Order ID:</b> <code>#${shortId}</code>
💵 <b>Attempted USDT:</b> <b>${data.amountUsdt.toFixed(2)} USDT</b>
⚠️ <b>Reason:</b> <i>${reasonText}</i>
━━━━━━━━━━━━━━━━━━━
💡 <i>Common reasons: Invalid TXID, incorrect amount transferred, or wrong BEP-20 network. If you think this is a mistake, please reach out to customer support.</i>
`;

  try {
    await bot.api.sendMessage(data.telegramId, message, {
      parse_mode: 'HTML',
    });
    console.log(`[Notification] Order ${shortId} rejection message delivered to ${data.telegramId}`);
  } catch (err) {
    console.error(`[Notification Error] Failed to send rejection message to ${data.telegramId}:`, err);
  }
}
