import twilioLib from 'twilio';
import { env } from '../config/env.js';

/**
 * Built lazily (never at module load) so a missing/incomplete Twilio config never crashes boot -
 * same reasoning as spaces-storage.service.ts's buildClient(). Placing a call simply fails with a
 * clear error until TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are set - nothing else in the app depends
 * on this module.
 */
let cachedClient: ReturnType<typeof twilioLib> | undefined;

export function getTwilioClient(): ReturnType<typeof twilioLib> {
  if (!env.twilio.accountSid || !env.twilio.authToken) {
    throw new Error('Twilio no está configurado (falta TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN).');
  }
  if (!cachedClient) {
    cachedClient = twilioLib(env.twilio.accountSid, env.twilio.authToken);
  }
  return cachedClient;
}

export function isTwilioConfigured(): boolean {
  return Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.phoneNumber);
}
