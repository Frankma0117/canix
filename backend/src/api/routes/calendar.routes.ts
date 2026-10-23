import type { Express, Request } from 'express';
import { calendarEvents } from '../../services/calendar/calendar.service.js';
import { h, userId } from '../http-helpers.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function permissionCheck(req: Request): (permission: string) => boolean {
  if (req.panelUser?.role === 'admin') return () => true;
  return (permission) => !!req.panelPermissions?.has(permission);
}

/** The portal's agenda calendar - open to every signed-in person; each kind of event is filtered by permission. */
export function registerCalendarRoutes(app: Express): void {
  app.get(
    '/api/calendar',
    h((req, res) => {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? '');
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return void res.status(400).json({ error: 'Rango de fechas inválido.' });
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days > 62) return void res.status(400).json({ error: 'El rango máximo es de 62 días.' });
      res.json(calendarEvents(userId(req), from, to, permissionCheck(req)));
    }),
  );
}
