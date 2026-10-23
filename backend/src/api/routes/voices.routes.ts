import { type Express } from 'express';
import { usersModel } from '../../models/users.model.js';
import { VOICES, currentVoice, findVoice, voiceSample } from '../../services/audio/voices.js';
import { isFishConfigured } from '../../services/audio/fish-audio.js';
import { rateLimit } from '../middleware/security.middleware.js';
import { h, userId } from '../http-helpers.js';

/** Natural voice (paid extra): pick the voice Canix speaks with, hear samples. */
export function registerVoiceRoutes(app: Express): void {
  app.get(
    '/api/voices',
    h((req, res) => {
      const me = usersModel.getById(userId(req))!;
      res.json({
        voices: VOICES.map(({ key, gender, name, style }) => ({ key, gender, name, style })),
        current: currentVoice(me)?.key ?? null,
        samplesAvailable: isFishConfigured(),
      });
    }),
  );
  app.put(
    '/api/voices',
    h((req, res) => {
      const voice = findVoice(String(req.body?.voice ?? ''));
      if (!voice) return res.status(400).json({ error: 'Esa voz no existe.' });
      usersModel.setVoice(userId(req), voice.key, voice.gender);
      res.json({ current: voice.key });
    }),
  );
  app.get(
    '/api/voices/:key/sample',
    rateLimit({ capacity: 40, windowMs: 60_000, keyFn: (req) => `voice-sample:${req.panelUser?.id}` }),
    h(async (req, res) => {
      const voice = VOICES.find((v) => v.key === req.params.key);
      if (!voice) return res.status(404).json({ error: 'Esa voz no existe.' });
      const mp3 = await voiceSample(voice, userId(req));
      if (!mp3) return res.status(503).json({ error: 'No pude generar la muestra en este momento.' });
      res.type('audio/mpeg').send(mp3);
    }),
  );
}
