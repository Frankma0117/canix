import 'dotenv/config';

/**
 * Central configuration read from environment variables (.env).
 */
export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),

  timezone: process.env.TIMEZONE ?? 'America/Bogota',

  // Hora 'HH:mm' (en TIMEZONE) a la que cada usuario recibe su agenda del día automáticamente -
  // ver ensureDailyAgendaReminder() en agent/agenda.ts.
  morningSummaryTime: process.env.MORNING_SUMMARY_TIME ?? '06:30',

  // Día y hora (en TIMEZONE) del reporte semanal automático - ver ensureWeeklyReportReminder() en
  // agent/weekly-report.ts. Día: 0=domingo .. 6=sábado (igual convención que weekdayName()/parseWall).
  weeklyReportDay: parseInt(process.env.WEEKLY_REPORT_DAY ?? '0', 10),
  weeklyReportTime: process.env.WEEKLY_REPORT_TIME ?? '19:00',

  // Hora 'HH:mm' (en TIMEZONE) a la que se borra el historial de conversación de cada usuario cada
  // día (silencioso, no manda mensaje) - ver ensureDailyResetReminder() en agent/daily-reset.ts.
  // Antes de MORNING_SUMMARY_TIME por diseño, así la agenda matutina siempre llega a una
  // conversación recién reiniciada.
  dailyResetTime: process.env.DAILY_RESET_TIME ?? '04:00',

  // Hora 'HH:mm' (en TIMEZONE) a la que se revisan rutinas/recordatorios duplicados de cada usuario
  // cada día (silencioso, no manda mensaje) - ver ensureDailyDedupReminder() en agent/dedup.ts.
  // Después de DAILY_RESET_TIME, para que el dedup siempre corra sobre un día ya reiniciado.
  dailyDedupTime: process.env.DAILY_DEDUP_TIME ?? '04:10',

  ai: {
    provider: process.env.AI_PROVIDER ?? 'openai',
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
    // How many past messages (user+assistant turns) to resend as context on every call - the
    // single biggest lever on input-token cost per message. Lower = cheaper but shorter memory.
    historyTurns: parseInt(process.env.AI_HISTORY_TURNS ?? '14', 10),
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

  // Public URL of the web panel, only used to build the link a newly-granted user gets over
  // WhatsApp (see grant-access.tool.ts) - purely cosmetic, the API works the same without it.
  panelUrl: process.env.PANEL_URL ?? '',

  // Fashion Mode: an isolated wardrobe/outfit module, gated entirely behind this flag - when
  // false, bot-manager.ts never even queries fashion_sessions, so behavior is byte-identical to a
  // build without this feature at all (see agent/fashion/router.ts).
  fashion: {
    enabled: (process.env.FASHION_MODE_ENABLED ?? 'false').toLowerCase() === 'true',
    maxImageSizeMb: parseInt(process.env.FASHION_MAX_IMAGE_SIZE_MB ?? '8', 10),

    // Bulk import: sending a PDF full of garment photos instead of one image at a time (see
    // fashion/flows/add-garment-pdf.flow.ts). maxPdfImages caps how many photos get processed from
    // one PDF - protects both RAM (each one goes through the same resize/upload/analyze pipeline as
    // a single photo) and the user's own patience reading the review list.
    maxPdfSizeMb: parseInt(process.env.FASHION_MAX_PDF_SIZE_MB ?? '15', 10),
    maxPdfImages: parseInt(process.env.FASHION_MAX_PDF_IMAGES ?? '12', 10),

    // DigitalOcean Spaces (S3-compatible) - stores original garment photos + thumbnails. Bucket is
    // public-read (see storage/spaces-storage.service.ts's getPublicUrl) - no presigned URLs.
    spaces: {
      endpoint: process.env.DO_SPACES_ENDPOINT ?? '',
      region: process.env.DO_SPACES_REGION ?? '',
      bucket: process.env.DO_SPACES_BUCKET ?? '',
      accessKeyId: process.env.DO_SPACES_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.DO_SPACES_SECRET_ACCESS_KEY ?? '',
    },

    // Local Python microservice (see /vision-service) doing garment image analysis via CLIP-family
    // zero-shot classification - free, self-hosted, no external API cost. Optional: if unreachable
    // or slow, Fashion Mode falls back to asking the user to tag the garment manually (see
    // vision/http-vision.service.ts) - never blocks or crashes the add-garment flow.
    vision: {
      serviceUrl: process.env.FASHION_VISION_SERVICE_URL ?? 'http://127.0.0.1:8008',
      timeoutMs: parseInt(process.env.FASHION_VISION_TIMEOUT_MS ?? '15000', 10),
      minConfidence: parseFloat(process.env.FASHION_VISION_MIN_CONFIDENCE ?? '0.35'),
    },

    // Outfit recommendation engine (see fashion/outfit/) - reuses the SAME DeepSeek client/model
    // already configured above (env.ai), no second AI provider. These caps exist purely to keep
    // token spend predictable: candidates are filtered/scored locally first (zero AI cost, see
    // candidate-filter.ts) and only the capped, reduced list ever reaches the model.
    ai: {
      maxCandidatesPerRole: parseInt(process.env.FASHION_AI_MAX_CANDIDATES ?? '6', 10),
      maxOutputTokens: parseInt(process.env.FASHION_AI_MAX_OUTPUT_TOKENS ?? '400', 10),
      // How long a recommendation is reused without calling the AI again for the exact same
      // request context, as long as the wardrobe hasn't changed meanwhile (see outfit/cache.ts).
      recommendationCacheTtlMs: parseInt(process.env.FASHION_RECOMMENDATION_CACHE_TTL_MS ?? '3600000', 10),
    },
  },
};

export type Env = typeof env;
