import type { Tool } from '../tool-registry.js';
import { env } from '../../config/env.js';
import { renderMainMenu } from '../menu.js';

/**
 * Renders the SAME two-level menu as the zero-token `/menu` raw command in bot-manager.ts (see
 * agent/menu.ts - single source of truth, kept here only as the natural-language entry point).
 * Deliberately just the category list, not every category's full detail: cheaper (fewer output
 * tokens on every "qué puedes hacer") and points the user at "/menu <categoría>" for specifics,
 * which costs zero tokens since that's the raw command, not this tool. Complements
 * bot-manager.ts's `/ayuda` (that one only lists the /reset-style slash commands) - see
 * BASE_PROMPT in ai-agent.ts for when the model should call this instead of answering from memory.
 */
export const showMenuTool: Tool = {
  name: 'show_menu',
  description:
    'Muestra el menú de categorías de todo lo que el bot puede hacer. Úsala cuando pregunten "qué puedes ' +
    'hacer", "menú", "opciones", "ayuda", "qué funciones tienes" o algo similar - responde SIEMPRE con esta tool en ' +
    'vez de listar funciones de memoria, así nunca se menciona algo que en realidad no existe.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    return renderMainMenu({ fashionEnabled: env.fashion.enabled, isAdmin: ctx.isAdmin });
  },
};
