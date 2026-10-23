export interface Contact {
  id: number;
  user_id: number;
  name: string;
  jid: string;
  lid: string | null;
  // WhatsApp's public @username handle, if known - reference/search label only, see contacts.model.ts.
  username: string | null;
  notes: string | null;
  created_at: string;
}
