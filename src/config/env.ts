import 'dotenv/config';

/**
 * Central configuration read from environment variables (.env).
 */
export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),

  timezone: process.env.TIMEZONE ?? 'America/Bogota',

  ai: {
    provider: process.env.AI_PROVIDER ?? 'openai',
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  },

  db: {
    path: process.env.DB_PATH ?? './data/app.db',
  },

  wa: {
    session: process.env.WA_SESSION ?? 'personal-agent',
  },

  // Admin panel access token. If not set here, the server generates
  // one and saves it to auth_info/admin-token.txt (see src/server/auth.ts).
  adminToken: process.env.ADMIN_TOKEN ?? '',
};

export type Env = typeof env;
