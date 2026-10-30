import express, { Request, Response } from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { setupBot } from './bot';
import {
  setupOrdersRealtimeSubscription,
} from './services/supabase';
import {
  sendOrderApprovedNotification,
  sendOrderRejectedNotification,
} from './services/notification';

async function main() {
  console.log('🚀 Starting Telegram Dollar Buying Bot & Notification Backend...');

  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️ WARNING: TELEGRAM_BOT_TOKEN is not set in .env. Bot polling will not start until configured.');
  }

  // 1. Initialize Bot
  const bot = CONFIG.TELEGRAM_BOT_TOKEN ? setupBot(CONFIG.TELEGRAM_BOT_TOKEN) : null;

  // 2. Setup Realtime Listener on Supabase
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_SERVICE_ROLE_KEY && bot) {
    console.log('📡 Initializing Supabase Realtime Orders Listener for Telegram notifications...');
    setupOrdersRealtimeSubscription(async (payload) => {
      console.log(`[Realtime Trigger] Order ${payload.orderId} status changed to ${payload.status}`);
      if (payload.status === 'approved') {
        await sendOrderApprovedNotification(bot, {
          orderId: payload.orderId,
          telegramId: payload.telegramId,
          bdtAmount: payload.bdtAmount,
          amountUsdt: payload.amountUsdt,
          paymentMethod: payload.paymentMethod,
          accountNumber: payload.accountNumber,
          adminNote: payload.adminNote,
        });
      } else if (payload.status === 'rejected') {
        await sendOrderRejectedNotification(bot, {
          orderId: payload.orderId,
          telegramId: payload.telegramId,
          amountUsdt: payload.amountUsdt,
          reason: payload.adminNote || 'Blockchain verification failed.',
        });
      }
    });
  }

  // 3. Setup Express Server for Webhooks & Admin Mobile App direct calls
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'telegram-dollar-buying-bot',
      timestamp: new Date().toISOString(),
      botOnline: Boolean(bot),
    });
  });

  // Direct Webhook endpoint callable by Flutter Admin App or Supabase Database Webhooks
  app.post('/api/admin/notify-order-status', async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (CONFIG.ADMIN_API_SECRET && authHeader !== `Bearer ${CONFIG.ADMIN_API_SECRET}`) {
        res.status(401).json({ error: 'Unauthorized admin webhook call' });
        return;
      }

      const {
        orderId,
        telegramId,
        status,
        adminNote,
        bdtAmount,
        amountUsdt,
        paymentMethod,
        accountNumber,
      } = req.body;

      if (!orderId || !telegramId || !status) {
        res.status(400).json({ error: 'Missing required parameters (orderId, telegramId, status)' });
        return;
      }

      if (!bot) {
        res.status(503).json({ error: 'Telegram Bot instance is not initialized' });
        return;
      }

      if (status === 'approved') {
        await sendOrderApprovedNotification(bot, {
          orderId,
          telegramId,
          bdtAmount: parseFloat(bdtAmount) || 0,
          amountUsdt: parseFloat(amountUsdt) || 0,
          paymentMethod: paymentMethod || 'bKash/Nagad',
          accountNumber: accountNumber || 'N/A',
          adminNote,
        });
      } else if (status === 'rejected') {
        await sendOrderRejectedNotification(bot, {
          orderId,
          telegramId,
          amountUsdt: parseFloat(amountUsdt) || 0,
          reason: adminNote || 'Order rejected by administrator',
        });
      }

      res.json({ success: true, message: `Notification sent for order ${orderId}` });
    } catch (err: any) {
      console.error('Error handling admin notify webhook:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Start HTTP Server
  app.listen(CONFIG.PORT, () => {
    console.log(`⚡ HTTP Webhook & Notification Server listening on port ${CONFIG.PORT}`);
  });

  // Start Bot Polling
  if (bot) {
    bot
      .start({
        onStart: (botInfo) => {
          console.log(`🤖 Telegram Bot @${botInfo.username} is ONLINE and polling for updates!`);
        },
      })
      .catch((err) => {
        console.error('Failed to start Telegram Bot:', err);
      });
  }
}

main().catch((err) => {
  console.error('Fatal initialization error:', err);
});
