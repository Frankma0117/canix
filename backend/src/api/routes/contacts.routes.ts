import { type Express } from 'express';
import { contactsModel } from '../../models/contacts.model.js';
import { phoneToJid } from '../../shared/utils/jid.js';
import { h, userId } from '../http-helpers.js';

/** Contacts the bot can write to. */
export function registerContactRoutes(app: Express): void {
  app.get('/api/contacts', h((req, res) => res.json(contactsModel.listAll(userId(req)))));
  app.post(
    '/api/contacts',
    h((req, res) => {
      const { name, phone, notes } = req.body ?? {};
      if (!name || !phone) return res.status(400).json({ error: 'name y phone requeridos' });
      const contact = contactsModel.upsert(userId(req), name, phoneToJid(phone), notes || null);
      res.json(contact);
    }),
  );
  app.delete(
    '/api/contacts/:id',
    h((req, res) => {
      contactsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
