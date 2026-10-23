import type { Tool } from '../../tool-registry.js';
import { usersModel } from '../../../models/users.model.js';
import { wavToOggOpus } from '../../../services/audio/ffmpeg.js';
import { isFishConfigured } from '../../../services/audio/fish-audio.js';
import { VOICES, currentVoice, describeVoice, findVoice, voiceListMessage, voiceSample } from '../../../services/audio/voices.js';
import { can } from '../../../services/permissions/permissions.service.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

/**
 * Lets someone with the paid natural voice pick which one Canix uses with them: see the catalog,
 * hear a sample of any of them, and keep one. Owned by the 'voice.premium' permission (see
 * services/permissions/catalog.ts), so people on the free local voice never get offered it.
 */
export const chooseVoiceTool: Tool = {
  name: 'choose_voice',
  description:
    'Voces naturales para las notas de voz: action "list" muestra las voces disponibles (hombre y mujer) y cuál ' +
    'tengo; "preview" me manda una muestra de audio de una voz para oírla; "set" deja esa voz como la mía. Úsala ' +
    'cuando pida ver/cambiar/elegir/probar voces. Con "list", responde con la lista TAL CUAL la devuelve la tool.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'preview', 'set'] },
      voice: { type: 'string', description: 'Código (ej. "M3") o nombre (ej. "Laura") de la voz. Necesario para preview y set.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver o cambiar SU voz.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const user = usersModel.getById(acting.userId);
    if (!user) return 'No encontré a esa persona.';
    if (!can(user, 'voice.premium')) {
      return 'Esa persona no tiene habilitada la voz natural (es un extra que activa el administrador), así que no hay voces para elegir.';
    }

    const action = String(args.action ?? 'list');
    if (action === 'list') return voiceListMessage(currentVoice(user));

    const voice = findVoice(args.voice ? String(args.voice) : '');
    if (!voice) return `No reconocí esa voz. Las que hay: ${VOICES.map((v) => `${v.key} (${v.name})`).join(', ')}.`;

    if (action === 'preview') {
      if (!isFishConfigured()) return 'La voz natural no está configurada en el servidor todavía, no puedo mandar muestras.';
      const mp3 = await voiceSample(voice, ctx.userId);
      if (!mp3) return `No pude generar la muestra de ${voice.name} en este momento, intenta de nuevo en un rato.`;
      try {
        // The sample goes to whoever is chatting (the admin too, when looking on someone's behalf).
        await ctx.wa.sendAudio(ctx.ownerJid, await wavToOggOpus(mp3));
      } catch (err) {
        console.error('[VOICE] Could not send the sample of %s:', voice.key, (err as Error).message);
        return `No pude enviar la muestra de ${voice.name}.`;
      }
      return `Ya le mandé la muestra de audio de ${describeVoice(voice)}. Pregúntale si la deja o quiere oír otra - no la cambies hasta que lo diga.`;
    }

    if (action === 'set') {
      usersModel.setVoice(user.id, voice.key, voice.gender);
      return `🔊 Listo, de ahora en adelante las notas de voz suenan con ${voice.name} (${voice.key}, ${voice.style}).`;
    }
    return 'action tiene que ser "list", "preview" o "set".';
  },
};
