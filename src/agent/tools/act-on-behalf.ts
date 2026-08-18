import { usersRepo } from '../../db/repositories/users.repo.js';
import type { ToolContext } from '../tool-registry.js';

export interface ActingUser {
  userId: number;
  targetJid: string;
}

/**
 * Resolves which user's data a tool call should actually operate on. Every data tool (todos,
 * routines, reminders, etc.) accepts an optional `target_user` param - when omitted, this just
 * returns the caller's own identity (zero behavior change for every non-admin call, and for the
 * admin's own everyday use). When given, only the primary admin may use it (ctx.isAdmin is a safe
 * proxy for "the one primary admin" - see restricted-tools.ts, only one admin row can ever exist),
 * letting them view/act on another granted user's data ("agendar desde el equipo de él"). Reuses
 * the same name-or-phone resolution + 0/1/>1-match disambiguation already used by
 * grant-access.tool.ts/revoke-access.tool.ts/set-user-permissions.tool.ts, instead of inventing a
 * second lookup convention.
 */
export function resolveActingUser(
  ctx: ToolContext,
  targetUserRaw: string | undefined,
): ActingUser | { error: string } {
  if (!targetUserRaw) return { userId: ctx.userId, targetJid: ctx.ownerJid };

  if (!ctx.isAdmin) return { error: 'Solo el administrador puede actuar en nombre de otra persona.' };

  const query = targetUserRaw.trim();
  const matches = usersRepo.findByNameOrPhone(query);
  if (matches.length === 0) return { error: `No encontré a nadie con acceso que coincida con "${query}".` };
  if (matches.length > 1) {
    return {
      error: `Hay varias personas que coinciden con "${query}": ${matches.map((u) => u.name).join(', ')}. Sé más específico.`,
    };
  }
  return { userId: matches[0].id, targetJid: matches[0].jid };
}
