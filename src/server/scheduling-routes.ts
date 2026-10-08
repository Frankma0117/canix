import type { Express, Request } from 'express';
import { usersRepo } from '../db/repositories/users.repo.js';
import { addDays, todayLocal, nowLocal } from '../util/datetime.js';
import { schedRepo, type AppointmentView } from '../scheduling/repo.js';
import {
  ensureProfessional,
  updateSettings,
  setAvailability,
  blockTime,
  confirmAppointment,
  rejectAppointment,
  cancelAppointment,
  scheduleByProfessional,
  setAppointmentNotes,
  shareAccess,
  removeClient,
  bookableProfessionals,
  slotsFor,
  requestAppointment,
  SchedulingError,
  statusLabel,
} from '../scheduling/service.js';
import { requirePermission, requirePanelAdmin } from './auth.js';
import { h, userId, str, int } from './http-helpers.js';
import { concurrencyLimit, rateLimit } from './security.js';
import { uploadMiddleware, persistUploads, filesFor, getFile, absolutePath, deleteFile, UploadError } from './uploads.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(req: Request, defaultDays: number): { from: string; to: string } {
  const from = DATE_RE.test(String(req.query.from ?? '')) ? String(req.query.from) : todayLocal();
  const toRaw = String(req.query.to ?? '');
  const to = DATE_RE.test(toRaw) && toRaw >= from ? toRaw : addDays(from, defaultDays).slice(0, 10);
  // Bounded so one request can't ask for years of rows.
  const maxTo = addDays(from, 92).slice(0, 10);
  return { from: `${from} 00:00:00`, to: `${(to > maxTo ? maxTo : to)} 23:59:59` };
}

function me(req: Request) {
  return usersRepo.getById(userId(req))!;
}

function apptView(a: AppointmentView) {
  return { ...a, status_label: statusLabel(a.status), client_phone: a.client_jid.split('@')[0], professional_jid: undefined, client_jid: undefined };
}

function assertParticipant(req: Request, appointmentId: number): AppointmentView {
  const a = schedRepo.getAppointment(appointmentId);
  const uid = userId(req);
  if (!a || (a.professional_id !== uid && a.client_user_id !== uid && req.panelUser?.role !== 'admin')) {
    throw new SchedulingError('Esa cita no existe o no es tuya.');
  }
  return a;
}

export function registerSchedulingRoutes(app: Express): void {
  const uploadLimiter = rateLimit({ capacity: 20, windowMs: 60_000, keyFn: (req) => `up:${req.panelUser?.id}`, message: 'Demasiadas cargas seguidas; espera un minuto.' });
  const uploadConcurrency = concurrencyLimit(2, 10);

  // ================= Professional =================
  const pro = requirePermission('scheduling.professional');

  app.get(
    '/api/scheduling/pro/profile',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      res.json({
        profile: prof,
        availability: schedRepo.availability(prof.user_id),
        time_off: schedRepo.timeOff(prof.user_id, nowLocal(), addDays(nowLocal(), 365)),
        groups: schedRepo.groupsOfProfessional(prof.user_id),
      });
    }),
  );

  app.put(
    '/api/scheduling/pro/settings',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      const b = req.body ?? {};
      res.json(
        updateSettings(prof, {
          display_name: str(b.display_name, 80),
          specialty: b.specialty === undefined ? undefined : (str(b.specialty, 80) ?? null),
          slot_minutes: int(b.slot_minutes),
          buffer_minutes: int(b.buffer_minutes),
          min_notice_minutes: int(b.min_notice_minutes),
          max_days_ahead: int(b.max_days_ahead),
          reminder_morning_time: b.reminder_morning_time === undefined ? undefined : b.reminder_morning_time ? String(b.reminder_morning_time) : null,
          reminder_hours_before: b.reminder_hours_before === undefined ? undefined : b.reminder_hours_before ? int(b.reminder_hours_before) : null,
          auto_confirm: b.auto_confirm === undefined ? undefined : Boolean(b.auto_confirm),
        }),
      );
    }),
  );

  app.put(
    '/api/scheduling/pro/availability',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
      if (rules.length > 70) throw new SchedulingError('Demasiados bloques de horario.');
      setAvailability(
        prof,
        rules.map((r: Record<string, unknown>) => ({ weekday: Number(r.weekday), start: String(r.start ?? ''), end: String(r.end ?? '') })),
      );
      res.json(schedRepo.availability(prof.user_id));
    }),
  );

  app.post(
    '/api/scheduling/pro/time-off',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      const id = blockTime(prof, String(req.body?.start ?? ''), String(req.body?.end ?? ''), str(req.body?.reason, 200) ?? null);
      res.status(201).json({ id });
    }),
  );

  app.delete(
    '/api/scheduling/pro/time-off/:id',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      if (!schedRepo.deleteTimeOff(prof.user_id, Number(req.params.id))) throw new SchedulingError('Ese bloqueo no existe.');
      res.json({ ok: true });
    }),
  );

  /** Calendar feed: every appointment (any status) + blocks in the range. */
  app.get(
    '/api/scheduling/pro/calendar',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      const { from, to } = range(req, 42);
      res.json({
        appointments: schedRepo.listForProfessional(prof.user_id, from, to).map(apptView),
        time_off: schedRepo.timeOff(prof.user_id, from, to),
      });
    }),
  );

  app.get(
    '/api/scheduling/pro/slots',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      res.json(slotsFor(prof, str(req.query.from, 10), int(req.query.days) ?? 7));
    }),
  );

  app.post(
    '/api/scheduling/pro/appointments',
    pro,
    h(async (req, res) => {
      const actor = me(req);
      const prof = ensureProfessional(actor);
      const a = await scheduleByProfessional(actor, prof, Number(req.body?.clientId), String(req.body?.start ?? ''), int(req.body?.duration_minutes), str(req.body?.reason, 300) ?? null);
      res.status(201).json(apptView(a));
    }),
  );

  for (const action of ['confirm', 'reject', 'cancel'] as const) {
    app.post(
      `/api/scheduling/pro/appointments/:id/${action}`,
      pro,
      h(async (req, res) => {
        const actor = me(req);
        const id = Number(req.params.id);
        const reason = str(req.body?.reason, 300) ?? null;
        const a =
          action === 'confirm' ? await confirmAppointment(actor, id) : action === 'reject' ? await rejectAppointment(actor, id, reason) : await cancelAppointment(actor, id, reason);
        res.json(apptView(a));
      }),
    );
  }

  app.put(
    '/api/scheduling/pro/appointments/:id/notes',
    pro,
    h((req, res) => res.json(apptView(setAppointmentNotes(me(req), Number(req.params.id), str(req.body?.notes, 2000) ?? null)))),
  );

  app.get(
    '/api/scheduling/pro/clients',
    pro,
    h((req, res) => {
      const prof = ensureProfessional(me(req));
      const rows = schedRepo.clientsOfProfessional(prof.user_id);
      const unique = [...new Map(rows.map((c) => [c.client_user_id, c])).values()];
      res.json(unique.map((c) => ({ id: c.client_user_id, name: c.client_name, phone: c.client_jid.split('@')[0], via_group: c.group_name ?? null, since: c.created_at })));
    }),
  );

  app.post(
    '/api/scheduling/pro/clients',
    pro,
    rateLimit({ capacity: 10, windowMs: 60 * 60_000, keyFn: (req) => `share:${req.panelUser?.id}`, message: 'Compartiste demasiados accesos en poco tiempo; intenta más tarde.' }),
    h(async (req, res) => {
      const actor = me(req);
      const prof = ensureProfessional(actor);
      const r = await shareAccess(actor, { professionalId: prof.user_id }, String(req.body?.phone ?? ''), str(req.body?.name, 80) ?? null);
      res.status(201).json({ client: { id: r.client.id, name: r.client.name, phone: r.client.jid.split('@')[0] }, notified: r.notified, forwardText: r.forwardText });
    }),
  );

  app.delete(
    '/api/scheduling/pro/clients/:clientId',
    pro,
    h((req, res) => {
      const actor = me(req);
      const prof = ensureProfessional(actor);
      if (!removeClient(actor, prof, Number(req.params.clientId))) throw new SchedulingError('Ese cliente no tiene acceso directo contigo (puede venir por un grupo).');
      res.json({ ok: true });
    }),
  );

  // ================= Client =================
  const client = requirePermission('scheduling.client');

  app.get(
    '/api/scheduling/client/professionals',
    client,
    h((req, res) => res.json(bookableProfessionals(userId(req)).map((p) => ({ id: p.user_id, name: p.display_name, specialty: p.specialty, slot_minutes: p.slot_minutes })))),
  );

  app.get(
    '/api/scheduling/client/slots',
    client,
    h((req, res) => {
      const prof = bookableProfessionals(userId(req)).find((p) => p.user_id === int(req.query.professionalId));
      if (!prof) throw new SchedulingError('No tienes acceso a ese profesional.');
      res.json(slotsFor(prof, str(req.query.from, 10), int(req.query.days) ?? 7));
    }),
  );

  app.get(
    '/api/scheduling/client/appointments',
    client,
    h((req, res) => res.json(schedRepo.listForClient(userId(req), addDays(nowLocal(), -90)).map(apptView))),
  );

  app.post(
    '/api/scheduling/client/appointments',
    client,
    rateLimit({ capacity: 10, windowMs: 60 * 60_000, keyFn: (req) => `book:${req.panelUser?.id}` }),
    h(async (req, res) => {
      const actor = me(req);
      const prof = bookableProfessionals(actor.id).find((p) => p.user_id === int(req.body?.professionalId));
      if (!prof) throw new SchedulingError('No tienes acceso a ese profesional.');
      const a = await requestAppointment(actor, prof, String(req.body?.start ?? ''), str(req.body?.reason, 300) ?? null);
      res.status(201).json(apptView(a));
    }),
  );

  app.post(
    '/api/scheduling/client/appointments/:id/cancel',
    client,
    h(async (req, res) => {
      const a = schedRepo.getAppointment(Number(req.params.id));
      if (!a || a.client_user_id !== userId(req)) throw new SchedulingError('Esa cita no es tuya.');
      res.json(apptView(await cancelAppointment(me(req), a.id, str(req.body?.reason, 300) ?? null)));
    }),
  );

  // ================= Appointment detail & attachments (either participant) =================
  app.get(
    '/api/scheduling/appointments/:id',
    requirePermission('scheduling.professional', 'scheduling.client'),
    h((req, res) => {
      const a = assertParticipant(req, Number(req.params.id));
      const isClientView = a.client_user_id === userId(req) && a.professional_id !== userId(req);
      res.json({
        appointment: { ...apptView(a), notes: isClientView ? undefined : a.notes }, // private notes stay with the professional
        events: schedRepo.events(a.id),
        files: filesFor('appointment', a.id).map((f) => ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size_bytes, owner: f.owner_user_id, created_at: f.created_at })),
      });
    }),
  );

  app.post(
    '/api/scheduling/appointments/:id/files',
    requirePermission('scheduling.professional', 'scheduling.client'),
    uploadLimiter,
    uploadConcurrency,
    (req, res, next) => uploadMiddleware(req, res, (err?: unknown) => (err ? next(err) : next())),
    h(async (req, res) => {
      const a = assertParticipant(req, Number(req.params.id));
      if (filesFor('appointment', a.id).length >= 20) throw new UploadError('Esta cita ya tiene el máximo de 20 archivos.');
      const stored = await persistUploads(req, userId(req), 'appointment', a.id);
      res.status(201).json(stored.map((f) => ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size_bytes })));
    }),
  );

  app.get(
    '/api/files/:id',
    h((req, res) => {
      const f = getFile(Number(req.params.id));
      if (!f) return void res.status(404).json({ error: 'Archivo no encontrado.' });
      const uid = userId(req);
      const allowed = f.owner_user_id === uid || req.panelUser?.role === 'admin' || (f.purpose === 'appointment' && f.ref_id !== null && (() => {
        const a = schedRepo.getAppointment(f.ref_id!);
        return !!a && (a.professional_id === uid || a.client_user_id === uid);
      })());
      if (!allowed) return void res.status(404).json({ error: 'Archivo no encontrado.' });
      res.setHeader('Content-Type', f.mime);
      // PDFs download instead of rendering inside the portal's origin (a crafted PDF can carry script).
      res.setHeader('Content-Disposition', `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.original_name)}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(absolutePath(f));
    }),
  );

  app.delete(
    '/api/files/:id',
    h(async (req, res) => {
      const f = getFile(Number(req.params.id));
      if (!f || (f.owner_user_id !== userId(req) && req.panelUser?.role !== 'admin')) return void res.status(404).json({ error: 'Archivo no encontrado.' });
      await deleteFile(f);
      res.json({ ok: true });
    }),
  );

  // ================= Admin: combined calendar + group clients =================
  app.get(
    '/api/admin/scheduling/calendar',
    requirePanelAdmin,
    h((req, res) => {
      const { from, to } = range(req, 42);
      const groupId = int(req.query.groupId);
      const profId = int(req.query.professionalId);
      const ids = groupId ? schedRepo.groupMemberIds(groupId) : profId ? [profId] : schedRepo.listProfessionals().map((p) => p.user_id);
      res.json({ appointments: schedRepo.listForProfessionals(ids, from, to).map(apptView) });
    }),
  );

  app.post(
    '/api/admin/scheduling/groups/:id/clients',
    requirePanelAdmin,
    h(async (req, res) => {
      const g = schedRepo.getGroup(Number(req.params.id));
      if (!g) throw new SchedulingError('Ese grupo no existe.');
      const r = await shareAccess(me(req), { groupId: g.id }, String(req.body?.phone ?? ''), str(req.body?.name, 80) ?? null);
      res.status(201).json({ client: { id: r.client.id, name: r.client.name }, notified: r.notified, forwardText: r.forwardText });
    }),
  );

  app.delete(
    '/api/admin/scheduling/groups/:id/clients/:clientId',
    requirePanelAdmin,
    h((req, res) => {
      schedRepo.revokeClientAccess(Number(req.params.clientId), { groupId: Number(req.params.id) });
      res.json({ ok: true });
    }),
  );
}
