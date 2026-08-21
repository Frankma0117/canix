import type { Tool } from '../tool-registry.js';
import { fashionProfileRepo } from '../../db/repositories/fashion-profile.repo.js';
import { normalizeToTaxonomy, BODY_BUILDS, SIZES, COLORS, STYLES } from '../../fashion/taxonomy.js';
import { resolveActingUser } from './act-on-behalf.js';

function normalizeList(pool: readonly string[], values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const normalized = values
    .map((v) => (typeof v === 'string' ? normalizeToTaxonomy(pool, v) : undefined))
    .filter((v): v is string => !!v);
  return normalized.length ? normalized : undefined;
}

export const setFashionProfileTool: Tool = {
  name: 'set_fashion_profile',
  description:
    'Guarda datos de estilo personal (talla, contextura, altura, colores que prefiero/evito, estilos que ' +
    'prefiero) para que Fashion Mode arme mejores outfits sin que tenga que repetirlos cada vez. Úsala cuando ' +
    'te cuente cualquiera de estos datos dentro de Fashion Mode (o me lo pregunte y yo se lo cuente) - solo ' +
    'pasa los campos que efectivamente mencioné, nunca inventes los demás. Puedes llamarla varias veces para ' +
    'ir completando el perfil de a poco.',
  parameters: {
    type: 'object',
    properties: {
      height_cm: { type: 'number', description: 'Mi altura en centímetros.' },
      build: { type: 'string', enum: [...BODY_BUILDS], description: 'Mi contextura general.' },
      size: { type: 'string', enum: [...SIZES], description: 'Mi talla general (S/M/L/etc).' },
      preferred_colors: { type: 'array', items: { type: 'string' }, description: 'Colores que prefiero usar.' },
      avoided_colors: { type: 'array', items: { type: 'string' }, description: 'Colores que evito usar.' },
      preferred_styles: { type: 'array', items: { type: 'string' }, description: 'Estilos que prefiero (casual, formal, deportivo, etc).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardarle el perfil a ella en vez de a ti.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const heightCm = args.height_cm !== undefined ? Number(args.height_cm) : undefined;
    if (heightCm !== undefined && (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250)) {
      return 'height_cm tiene que ser un número de centímetros realista (entre 100 y 250).';
    }

    const build = typeof args.build === 'string' ? normalizeToTaxonomy(BODY_BUILDS, args.build) : undefined;
    const size = typeof args.size === 'string' ? normalizeToTaxonomy(SIZES, args.size) : undefined;
    const preferredColors = normalizeList(COLORS, args.preferred_colors);
    const avoidedColors = normalizeList(COLORS, args.avoided_colors);
    const preferredStyles = normalizeList(STYLES, args.preferred_styles);

    if (
      heightCm === undefined &&
      !build &&
      !size &&
      !preferredColors &&
      !avoidedColors &&
      !preferredStyles
    ) {
      return 'No reconocí ninguno de esos valores en mi taxonomía - dime talla/contextura/colores/estilos con palabras más comunes.';
    }

    fashionProfileRepo.upsert(userId, {
      heightCm,
      build,
      size,
      preferredColors,
      avoidedColors,
      preferredStyles,
    });

    return 'ok'; // internal bookkeeping - the AI turns this into a natural confirmation itself
  },
};
