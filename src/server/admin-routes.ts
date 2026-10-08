import type { Express } from 'express';
import { usersRepo } from '../db/repositories/users.repo.js';
import { permissionsRepo, AccessError } from '../db/repositories/permissions.repo.js';
import { PERMISSIONS } from '../permissions/catalog.js';
import { effectivePermissions } from '../permissions/engine.js';
import { issueTemporaryPassword, revokeAllSessions } from '../auth/web-auth.js';
import { phoneToJid } from '../util/jid.js';
import { ensureWeeklyReportReminder } from '../agent/weekly-report.js';
import { ensureDailyResetReminder } from '../agent/daily-reset.js';
import { ensureDailyDedupReminder } from '../agent/dedup.js';
import { portalAccessMessage } from '../agent/tools/set-web-password.tool.js';
import { schedRepo } from '../scheduling/repo.js';
import { db } from '../db/pool.js';
import { aiUsageRepo } from '../db/repositories/ai-usage.repo.js';
import { requirePanelAdmin } from './auth.js';
import { h, userId, str, strArr, intArr, int } from './http-helpers.js';
import type { User } from '../types/index.js';
import type { BotManager } from '../whatsapp/bot-manager.js';

function userView(u: User) {
  const overrides = permissionsRepo.userOverrides(u.id);
  return {
    id: u.id,
    name: u.name,
    phone: u.jid.split('@')[0],
    role: u.role,
    created_at: u.created_at,
    paused_until: u.paused_until,
    has_password: !!u.password_hash,
    must_change_password: !!u.must_change_password,
    locked_until: u.locked_until,
    packages: permissionsRepo.userPackages(u.id).map((p) => ({ id: p.id, key: p.key, name: p.name })),
    allow: overrides.filter((o) => o.effect === 'allow').map((o) => o.permission_key),
    deny: overrides.filter((o) => o.effect === 'deny').map((o) => o.permission_key),
    effective: [...effectivePermissions(u)],
    is_professional: !!schedRepo.getProfessional(u.id),
  };
}

function loadNonAdmin(id: number): User {
  const u = usersRepo.getById(id);
  if (!u) throw new AccessError('Ese usuario no existe.');
  if (u.role === 'admin') throw new AccessError('El administrador siempre tiene acceso total; no se edita aquí.');
  return u;
}

/**
 * Administration API (/api/admin/*, admin only): users and their access, packages, the permission
 * catalog, the audit trail and the scheduling "agendas generales". Every write goes through the
 * transactional repositories (permissions.repo.ts / scheduling repo), never raw SQL here.
 */
export function registerAdminRoutes(app: Express, bot: BotManager): void {
  app.use('/api/admin', requirePanelAdmin);

  app.get('/api/admin/permissions', h((_req, res) => res.json(PERMISSIONS.map(({ tools: _t, ...p }) => p))));

  // ---------- users ----------
  app.get('/api/admin/users', h((_req, res) => res.json(usersRepo.listAll().map(userView))));

  app.post(
    '/api/admin/users',
    h(async (req, res) => {
      const phone = str(req.body?.phone, 30) ?? '';
      const name = str(req.body?.name, 80) ?? '';
      if (phone.replace(/\D/g, '').length < 7 || !name) throw new AccessError('Necesito un número completo (con indicativo) y un nombre.');
      const jid = phoneToJid(phone);
      if (usersRepo.getByJidOrLid(jid)) throw new AccessError('Ese número ya tiene acceso.');
      const user = usersRepo.create({ jid, name, role: 'user' });
      permissionsRepo.setUserAccess(userId(req), user.id, {
        packageIds: intArr(req.body?.packageIds),
        allow: strArr(req.body?.allow),
        deny: strArr(req.body?.deny),
      });
      ensureWeeklyReportReminder(user.id, user.jid);
      ensureDailyResetReminder(user.id, user.jid);
      ensureDailyDedupReminder(user.id, user.jid);
      let notified = false;
      if (req.body?.notify) {
        try {
          await bot.session.sendText(jid, `¡Hola ${name}! Soy Canix, tu asistente virtual 🤖 Ya tienes acceso. Escribe /menu para ver lo que puedo hacer por ti.`);
          notified = true;
        } catch (err) {
          console.error('[ADMIN] No se pudo saludar a %s:', jid, (err as Error).message);
        }
      }
      res.status(201).json({ user: userView(usersRepo.getById(user.id)!), notified });
    }),
  );

  app.put(
    '/api/admin/users/:id',
    h((req, res) => {
      const u = usersRepo.getById(Number(req.params.id));
      if (!u) throw new AccessError('Ese usuario no existe.');
      const name = str(req.body?.name, 80);
      if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
      res.json(userView(usersRepo.getById(u.id)!));
    }),
  );

  app.put(
    '/api/admin/users/:id/access',
    h((req, res) => {
      const u = loadNonAdmin(Number(req.params.id));
      permissionsRepo.setUserAccess(userId(req), u.id, {
        packageIds: intArr(req.body?.packageIds),
        allow: strArr(req.body?.allow),
        deny: strArr(req.body?.deny),
      });
      // Losing portal access ends their open web sessions right away.
      if (!effectivePermissions(u).has('portal.access')) revokeAllSessions(u.id);
      res.json(userView(usersRepo.getById(u.id)!));
    }),
  );

  /** Temporary password: shown ONCE to the admin and optionally sent to the person over WhatsApp. */
  app.post(
    '/api/admin/users/:id/temp-password',
    h(async (req, res) => {
      const u = usersRepo.getById(Number(req.params.id));
      if (!u) throw new AccessError('Ese usuario no existe.');
      const pwd = await issueTemporaryPassword(u.id, userId(req));
      let sent = false;
      if (req.body?.sendWhatsApp) {
        try {
          await bot.session.sendText(u.jid, portalAccessMessage(u.jid.split('@')[0], pwd));
          sent = true;
        } catch (err) {
          console.error('[ADMIN] No se pudo enviar la contraseña a %s:', u.jid, (err as Error).message);
        }
      }
      res.json({ password: pwd, sent });
    }),
  );

  app.post(
    '/api/admin/users/:id/unlock',
    h((req, res) => {
      const u = usersRepo.getById(Number(req.params.id));
      if (!u) throw new AccessError('Ese usuario no existe.');
      db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
      permissionsRepo.recordAudit(userId(req), u.id, 'auth.unlocked');
      res.json(userView(usersRepo.getById(u.id)!));
    }),
  );

  app.post(
    '/api/admin/users/:id/logout-all',
    h((req, res) => {
      const u = usersRepo.getById(Number(req.params.id));
      if (!u) throw new AccessError('Ese usuario no existe.');
      revokeAllSessions(u.id);
      permissionsRepo.recordAudit(userId(req), u.id, 'auth.sessions_revoked');
      res.json({ ok: true });
    }),
  );

  /** Removes the person and ALL their data (same as revoke_access) - requires confirm=name. */
  app.delete(
    '/api/admin/users/:id',
    h((req, res) => {
      const u = loadNonAdmin(Number(req.params.id));
      if (String(req.query.confirm ?? '') !== String(u.id)) throw new AccessError('Falta la confirmación.');
      permissionsRepo.recordAudit(userId(req), null, 'user.removed', { id: u.id, name: u.name, phone: u.jid.split('@')[0] });
      usersRepo.remove(u.id);
      res.json({ ok: true });
    }),
  );

  // ---------- packages ----------
  app.get('/api/admin/packages', h((_req, res) => res.json(permissionsRepo.listPackages())));
  app.post(
    '/api/admin/packages',
    h((req, res) => {
      const pkg = permissionsRepo.savePackage(userId(req), {
        name: str(req.body?.name, 80) ?? '',
        description: str(req.body?.description, 300) ?? '',
        permissions: strArr(req.body?.permissions),
      });
      res.status(201).json(pkg);
    }),
  );
  app.put(
    '/api/admin/packages/:id',
    h((req, res) => {
      const existing = permissionsRepo.getPackage(Number(req.params.id));
      if (!existing) throw new AccessError('Ese paquete no existe.');
      res.json(
        permissionsRepo.savePackage(userId(req), {
          id: existing.id,
          name: str(req.body?.name, 80) ?? existing.name,
          description: str(req.body?.description, 300) ?? existing.description,
          permissions: Array.isArray(req.body?.permissions) ? strArr(req.body.permissions) : existing.permissions,
        }),
      );
    }),
  );
  app.delete(
    '/api/admin/packages/:id',
    h((req, res) => {
      permissionsRepo.deletePackage(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- audit ----------
  app.get(
    '/api/admin/audit',
    h((req, res) => {
      const limit = Math.min(Math.max(int(req.query.limit) ?? 200, 1), 1000);
      res.json(permissionsRepo.listAudit(limit, int(req.query.userId)));
    }),
  );

  // ---------- usage of paid resources (basis for charging per person later) ----------
  // operation: 'chat' (LLM tokens in/out), 'voice.fish' / 'voice.fish.call' (characters spoken),
  // 'call.twilio' (calls placed), plus Fashion Mode's own operations.
  app.get(
    '/api/admin/usage',
    h((req, res) => {
      const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 366);
      res.json({ days, rows: aiUsageRepo.summaryByUser(days) });
    }),
  );

  // ---------- scheduling: professionals and agendas generales ----------
  app.get(
    '/api/admin/scheduling/professionals',
    h((_req, res) =>
      res.json(
        usersRepo
          .listAll()
          .filter((u) => effectivePermissions(u).has('scheduling.professional'))
          .map((u) => {
            const p = schedRepo.getProfessional(u.id);
            return { user_id: u.id, name: u.name, phone: u.jid.split('@')[0], profile: p ?? null };
          }),
      ),
    ),
  );

  app.get(
    '/api/admin/scheduling/groups',
    h((_req, res) =>
      res.json(
        schedRepo.listGroups().map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          members: schedRepo.groupMemberIds(g.id),
          clients: schedRepo.clientsOfGroup(g.id).map((c) => ({ id: c.client_user_id, name: c.client_name, phone: c.client_jid.split('@')[0] })),
        })),
      ),
    ),
  );

  app.post(
    '/api/admin/scheduling/groups',
    h((req, res) => {
      const name = str(req.body?.name, 80);
      if (!name) throw new AccessError('El grupo necesita un nombre.');
      const id = schedRepo.createGroup(name, str(req.body?.description, 300) ?? '');
      permissionsRepo.recordAudit(userId(req), null, 'scheduling.group_create', { id, name });
      res.status(201).json({ id });
    }),
  );

  app.put(
    '/api/admin/scheduling/groups/:id',
    h((req, res) => {
      const g = schedRepo.getGroup(Number(req.params.id));
      if (!g) throw new AccessError('Ese grupo no existe.');
      schedRepo.updateGroup(g.id, str(req.body?.name, 80) ?? g.name, str(req.body?.description, 300) ?? g.description);
      if (Array.isArray(req.body?.members)) {
        const ids = intArr(req.body.members);
        for (const id of ids) {
          const u = usersRepo.getById(id);
          if (!u || !effectivePermissions(u).has('scheduling.professional')) throw new AccessError(`El usuario #${id} no es profesional de agenda.`);
          if (!schedRepo.getProfessional(id)) schedRepo.createProfessional(id, u.name ?? 'Profesional');
        }
        schedRepo.setGroupMembers(g.id, ids);
      }
      permissionsRepo.recordAudit(userId(req), null, 'scheduling.group_update', { id: g.id });
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/admin/scheduling/groups/:id',
    h((req, res) => {
      schedRepo.deleteGroup(Number(req.params.id));
      permissionsRepo.recordAudit(userId(req), null, 'scheduling.group_delete', { id: Number(req.params.id) });
      res.json({ ok: true });
    }),
  );
}
