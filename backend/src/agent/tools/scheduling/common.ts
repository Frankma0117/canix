import type { Tool, ToolContext } from '../../tool-registry.js';
import { usersModel } from '../../../models/users.model.js';
import { SchedulingError } from '../../../services/scheduling/scheduling.service.js';
import { schedulingModel, type ClientAccessRow } from '../../../models/scheduling.model.js';
import type { User } from '../../../entities/index.js';

/** Wraps a scheduling tool: resolves the acting user and turns SchedulingError into a plain reply. */
export function schedTool(def: Omit<Tool, 'execute'> & { run(args: Record<string, unknown>, me: User, ctx: ToolContext): Promise<string> }): Tool {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    async execute(args, ctx) {
      const me = usersModel.getById(ctx.userId);
      if (!me) return 'No encontré tu cuenta.';
      try {
        return await def.run(args, me, ctx);
      } catch (err) {
        if (err instanceof SchedulingError) return err.message;
        throw err;
      }
    },
  };
}

const DAY_NAMES: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** "Miércoles" / "miercoles" / "3" -> 3; null when unrecognized. */
export function parseWeekday(raw: unknown): number | null {
  const s = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  return DAY_NAMES[s] ?? null;
}

/** Finds one of this professional's clients by name or phone. */
export function resolveClientOf(professionalId: number, query: string): ClientAccessRow {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const clients = schedulingModel.clientsOfProfessional(professionalId);
  const unique = [...new Map(clients.map((c) => [c.client_user_id, c])).values()];
  const matches = unique.filter((c) =>
    digits.length >= 6 ? c.client_jid.includes(digits) : (c.client_name ?? '').toLowerCase().includes(q),
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new SchedulingError(`"${query}" no está entre tus clientes. Usa share_scheduling_access para darle acceso primero.`);
  throw new SchedulingError(`Varios clientes coinciden con "${query}": ${matches.map((c) => c.client_name ?? c.client_jid.split('@')[0]).join(', ')}.`);
}

export const strOrNull = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
