import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

export const CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://demo-supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'demo-service-key',
  PORT: parseInt(process.env.PORT || '4000', 10),
  ADMIN_API_SECRET: process.env.ADMIN_API_SECRET || 'elite_admin_secret_key_2026',
};

// Initialize Supabase Admin Client
export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);
