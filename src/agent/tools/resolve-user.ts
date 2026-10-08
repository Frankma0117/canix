import { usersRepo } from '../../db/repositories/users.repo.js';
import type { User } from '../../types/index.js';

/**
 * Resolves "Juan" / "3001234567" to exactly one user with access, or an error message ready to
 * hand back to the model (never guesses between several matches).
 */
export function resolveUserByQuery(query: string, opts: { allowAdmin?: boolean } = {}): { user: User } | { error: string } {
  const q = query.trim();
  if (!q) return { error: 'Me falta el nombre o el número de la persona.' };
  const matches = usersRepo.findByNameOrPhone(q).filter((u) => opts.allowAdmin || u.role !== 'admin');
  if (matches.length === 0) return { error: `No encontré a nadie con acceso que coincida con "${q}".` };
  if (matches.length > 1) {
    return { error: `Hay varias personas que coinciden con "${q}": ${matches.map((u) => `${u.name ?? '(sin nombre)'} (${u.jid.split('@')[0]})`).join(', ')}. Sé más específico.` };
  }
  return { user: matches[0] };
}
