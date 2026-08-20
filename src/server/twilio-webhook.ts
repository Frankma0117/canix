import express, { type Express } from 'express';
import twilioLib from 'twilio';
import { env } from '../config/env.js';
import { handleCallStatusUpdate } from '../calls/call-reminders.service.js';

/**
 * Twilio's own status-callback POST (see calls/call-reminders.service.ts's statusCallbackUrl) -
 * mounted OUTSIDE the /api prefix on purpose: this request comes straight from Twilio's servers,
 * which can't send our panel's Bearer token (see server/auth.ts). Authenticity is verified instead
 * via Twilio's own request-signature scheme (the X-Twilio-Signature header, checked by
 * twilio.webhook() below) - anyone else posting here without a valid signature gets a 403.
 *
 * Twilio POSTs this as application/x-www-form-urlencoded, not JSON - hence its own
 * express.urlencoded() here rather than relying on the app-wide express.json() in http-server.ts.
 */
export function registerTwilioWebhook(app: Express): void {
  const urlencoded = express.urlencoded({ extended: false });

  const validate = env.twilio.authToken
    ? twilioLib.webhook(env.twilio.authToken)
    : (_req: express.Request, res: express.Response) => {
        // No auth token configured - refuse instead of accepting unverified requests from the
        // open internet (this route has no other authentication).
        res.status(500).send('Twilio no configurado');
      };

  app.post('/webhooks/twilio/call-status', urlencoded, validate, (req, res) => {
    const callSid = String(req.body?.CallSid ?? '');
    const callStatus = String(req.body?.CallStatus ?? '');
    if (!callSid || !callStatus) {
      res.status(400).send('Falta CallSid o CallStatus');
      return;
    }
    handleCallStatusUpdate(callSid, callStatus);
    res.status(204).end();
  });
}
