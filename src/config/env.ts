import { config as loadDotenv } from 'dotenv';

// dotenv 18 prints a "◇ injected env (N) from .env" line by default on every load - explicit call
// (instead of the implicit `import 'dotenv/config'` side-effect) so `quiet` can actually be set:
// the only other way is the DOTENV_CONFIG_QUIET env var, which can't be set from inside .env itself
// (chicken-and-egg - that file is what this call is busy loading).
loadDotenv({ quiet: true });

const DEFAULT_TIMEZONE = 'America/Bogota';

/**
 * A typo'd TIMEZONE (e.g. "America/Bogotá", "Bogota") made Intl.DateTimeFormat throw a RangeError
 * on EVERY nowLocal() call - every reminder, every prompt, every scheduler tick failing. Validated
 * once at boot instead: an invalid value logs a loud warning and falls back to the default, so the
 * bot keeps the correct (Colombian) time rather than going down. Independent of the server's own OS
 * timezone on purpose - all wall-clock math goes through this value, never the system clock's zone.
 */
function resolveTimezone(raw: string | undefined): string {
  const tz = (raw ?? '').trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    console.error('[CONFIG] TIMEZONE="%s" no es una zona horaria válida - uso %s.', tz, DEFAULT_TIMEZONE);
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Central configuration read from environment variables (.env).
 */
export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),

  timezone: resolveTimezone(process.env.TIMEZONE),

  // Ya no dispara ningún aviso propio (el push automático de la agenda diaria se quitó - ver el
  // comentario de 'daily_agenda' en types/index.ts) - se conserva solo como el punto de referencia
  // horario que dailyResetTime usa más abajo para decidir su propio horario.
  morningSummaryTime: process.env.MORNING_SUMMARY_TIME ?? '06:30',

  // Hora (0-23, en TIMEZONE) a partir de la cual completar la última tarea/rutina pendiente del día
  // dispara la despedida de "buenas noches" (ver agent/agenda.ts's maybeNightFarewell) - antes de
  // esta hora, terminar todo temprano no dispara la despedida (ej. terminar todo a las 10am no es
  // "buenas noches").
  nightSummaryAfterHour: parseInt(process.env.NIGHT_SUMMARY_AFTER_HOUR ?? '18', 10),

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

    // Daily send caps enforced by whatsapp/send-guard.ts - a last line of defense against the
    // "one-way broadcast" pattern that gets numbers flagged (see README "Cómo evitar que WhatsApp
    // bloquee/restrinja el número"). A brand-new number gets a fraction of these (warm-up ramp,
    // hardcoded in send-guard.ts, eases up over its first 14 days) - these are the steady-state
    // ceiling once warmed up. 0 = uncapped (not recommended). Defaults are generous for personal/
    // small multi-tenant use; lower them if this deploy has many granted users.
    maxDailyProactiveMessages: parseInt(process.env.MAX_DAILY_PROACTIVE_MESSAGES ?? '300', 10),
    // Much lower default: cold sends (send_message to someone who's never written to the bot) are
    // the single riskiest pattern - this should stay close to genuine day-to-day personal use, not
    // scaled up "just in case".
    maxDailyColdMessages: parseInt(process.env.MAX_DAILY_COLD_MESSAGES ?? '20', 10),
  },

  audio: {
    // Local speech-to-text (Vosk) for transcribing WhatsApp voice notes - no AI/tokens involved.
    // Download a model from https://alphacephei.com/vosk/models (e.g. vosk-model-small-es-0.42)
    // and point this at the extracted folder. Transcription is silently skipped if unset/missing.
    voskModelPath: process.env.VOSK_MODEL_PATH ?? './models/vosk-es',

    // Local text-to-speech (Piper) for voice replies - also no AI/tokens. Download a binary from
    // https://github.com/rhasspy/piper/releases and a Spanish voice (.onnx + .onnx.json) from
    // https://huggingface.co/rhasspy/piper-voices. Voice replies are silently skipped if unset/missing.
    // Two voice models can be configured side by side (PIPER_VOICE_PATH = male/default,
    // PIPER_VOICE_PATH_FEMALE = female) - each user picks which one speaks their replies via the
    // set_voice_gender tool (see set-voice-gender.tool.ts); PIPER_VOICE_PATH_FEMALE is optional, if
    // unset every reply just uses the default voice regardless of preference (see audio/tts.ts).
    piper: {
      binPath: process.env.PIPER_BIN_PATH ?? '',
      voicePath: process.env.PIPER_VOICE_PATH ?? '',
      voicePathFemale: process.env.PIPER_VOICE_PATH_FEMALE ?? '',
    },

    // Natural (human-sounding) voice via Fish Audio's TTS API - pay-per-use, so it only ever runs
    // for users with the 'voice.premium' permission (see permissions/catalog.ts); everyone else, or
    // any Fish failure/timeout, falls back to local Piper above. Voices are Fish "reference_id"s
    // (fish.audio voice library) - one per gender, picked from users.voice_gender.
    fish: {
      apiKey: process.env.FISH_AUDIO_API_KEY ?? '',
      model: process.env.FISH_AUDIO_MODEL ?? 's2.1-pro-free',
      voiceMale: process.env.FISH_AUDIO_VOICE_MALE ?? 'da13e1b3f87c4f40b8090d0fd6454921',
      voiceFemale: process.env.FISH_AUDIO_VOICE_FEMALE ?? '10509ddabaaf48089ad5cf2d1b1eaf1d',
      // Fish bills per character - a reply longer than this goes out as text instead of an
      // expensive (and tedious to listen to) long voice note.
      maxChars: parseInt(process.env.FISH_AUDIO_MAX_CHARS ?? '700', 10),
      timeoutMs: parseInt(process.env.FISH_AUDIO_TIMEOUT_MS ?? '20000', 10),
    },
  },

  // Public landing page + free demo accounts + web analytics (see src/growth/).
  growth: {
    // Canonical public URL of the sales page, e.g. https://canix.cania.app - its host is served the
    // landing at "/" (any other host still gets the portal at "/" and the landing at /conoce).
    landingUrl: (process.env.LANDING_URL ?? '').replace(/\/$/, ''),
    // WhatsApp number (digits, with country code) behind every "Contáctanos" button.
    contactWhatsapp: (process.env.CONTACT_WHATSAPP ?? '573229457553').replace(/\D/g, ''),
    demoHours: parseInt(process.env.DEMO_HOURS ?? '24', 10),
    // Most demos alive at once - a brake on abuse (each demo is real AI usage).
    maxActiveDemos: parseInt(process.env.DEMO_MAX_ACTIVE ?? '25', 10),
    // Google Search Console "HTML tag" verification value (content="..."), optional.
    googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION ?? '',
  },

  // fal.ai (image generation) - deliberately NOT used by the bot (the user only wants their own
  // sticker pack); kept configured only for generating web-portal assets by hand when needed.
  fal: {
    apiKey: process.env.FAL_KEY ?? '',
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

  // Phone-call reminders (Twilio Programmable Voice, see src/calls/) - an isolated module, same
  // "never crashes boot if unconfigured" philosophy as Fashion Mode's vision service: a missing
  // TWILIO_AUTH_TOKEN only means placing a call fails with a clear error, nothing else breaks.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    // The Twilio number calls are placed FROM (caller id) - E.164, e.g. "+18023004379".
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
    // How many times a failed/no-answer/busy call is retried before giving up for good (see
    // calls/call-reminders.service.ts) - kept low on purpose, every attempt is a real phone call
    // Twilio bills for.
    maxAttempts: parseInt(process.env.TWILIO_CALL_MAX_ATTEMPTS ?? '3', 10),
    retryDelayMinutes: parseInt(process.env.TWILIO_CALL_RETRY_DELAY_MINUTES ?? '5', 10),
  },
};

export type Env = typeof env;
