import { existsSync } from 'node:fs';
import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { env } from '../../config/env.js';
import { resolveActingUser } from './act-on-behalf.js';

export const setVoiceGenderTool: Tool = {
  name: 'set_voice_gender',
  description:
    'Cambia qué voz (masculina o femenina) uso para hablarte cuando te respondo con nota de voz. Llámala cuando ' +
    'pidas explícitamente cambiar de voz o una voz de mujer/hombre - no la uses para adivinar ni para el género ' +
    'gramatical con el que te hablo (eso es set_user_gender, una cosa aparte). Si la voz femenina no está ' +
    'configurada en el servidor, se sigue usando la voz por defecto y así se lo aviso a quien pidió el cambio.',
  parameters: {
    type: 'object',
    properties: {
      voice_gender: { type: 'string', enum: ['male', 'female'], description: '"male" (voz de hombre) o "female" (voz de mujer).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para cambiarle la voz a ella en vez de a ti.',
      },
    },
    required: ['voice_gender'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const voiceGender = args.voice_gender === 'female' ? 'female' : args.voice_gender === 'male' ? 'male' : undefined;
    if (!voiceGender) return 'voice_gender tiene que ser "male" o "female".';

    usersRepo.setVoiceGender(userId, voiceGender);

    if (voiceGender === 'female') {
      const { voicePathFemale } = env.audio.piper;
      if (!voicePathFemale || !existsSync(voicePathFemale)) {
        return (
          'Guardado como preferencia, pero avísale que el administrador todavía no configuró una voz femenina ' +
          'en el servidor (PIPER_VOICE_PATH_FEMALE) - hasta que lo haga, las notas de voz van a seguir sonando ' +
          'con la voz por defecto.'
        );
      }
    }
    return `🔊 Listo, de ahora en adelante te hablo con voz ${voiceGender === 'female' ? 'femenina' : 'masculina'} en las notas de voz.`;
  },
};
