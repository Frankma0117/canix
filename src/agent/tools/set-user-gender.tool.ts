import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const setUserGenderTool: Tool = {
  name: 'set_user_gender',
  description:
    'Guarda si soy hombre o mujer, para que me hables en el género gramatical correcto ("parcero"/"parcera", ' +
    '"listo"/"lista") de ahora en adelante sin tener que adivinarlo cada vez. Llámala SOLO la primera vez que ' +
    'quede claro - por mi nombre inequívoco, o porque lo digo explícitamente - y nunca antes: si mi nombre es ' +
    'ambiguo o no da pistas, NO la llames, sigue usando lenguaje neutro como ya haces. Si en el contexto de ' +
    'abajo ya ves "Mi género" con un valor, no la vuelvas a llamar, ya está guardado.',
  parameters: {
    type: 'object',
    properties: {
      gender: { type: 'string', enum: ['male', 'female'], description: '"male" (hombre) o "female" (mujer).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardárselo a ella en vez de a ti.',
      },
    },
    required: ['gender'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const gender = args.gender === 'female' ? 'female' : args.gender === 'male' ? 'male' : undefined;
    if (!gender) return 'gender tiene que ser "male" o "female".';

    usersRepo.setGender(userId, gender);
    return 'ok'; // internal bookkeeping, never worth a visible confirmation to the user
  },
};
