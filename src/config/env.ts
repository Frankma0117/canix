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
    // Prepended to phone numbers that look "local" (given without a country code) when building a
    // WhatsApp jid - e.g. a bare 10-digit Colombian mobile number becomes 57XXXXXXXXXX. Without
    // this, a number saved/typed without indicativo produces an invalid jid that silently can't
    // be messaged (see util/jid.ts). Set to '' to disable and always use numbers exactly as given.
    defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE ?? '57',
  },

  audio: {
    // Local speech-to-text (Vosk) for transcribing WhatsApp voice notes - no AI/tokens involved.
    // Download a model from https://alphacephei.com/vosk/models (e.g. vosk-model-small-es-0.42)
    // and point this at the extracted folder. Transcription is silently skipped if unset/missing.
    voskModelPath: process.env.VOSK_MODEL_PATH ?? './models/vosk-es',

    // Local text-to-speech (Piper) for voice replies - also no AI/tokens. Download a binary from
    // https://github.com/rhasspy/piper/releases and a Spanish voice (.onnx + .onnx.json) from
    // https://huggingface.co/rhasspy/piper-voices. Voice replies are silently skipped if unset/missing.
    piper: {
      binPath: process.env.PIPER_BIN_PATH ?? '',
      voicePath: process.env.PIPER_VOICE_PATH ?? '',
    },
  },

  // Admin panel access token. If not set here, the server generates
  // one and saves it to auth_info/admin-token.txt (see src/server/auth.ts).
  adminToken: process.env.ADMIN_TOKEN ?? '',
};

export type Env = typeof env;
