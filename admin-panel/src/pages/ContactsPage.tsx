import { useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Contact } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

export function ContactsPage() {
  const api = useApi();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setContacts(await api.get<Contact[]>('/api/contacts'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/contacts', { name: name.trim(), phone: phone.trim(), notes: notes.trim() || undefined });
      setName('');
      setPhone('');
      setNotes('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este contacto?')) return;
    await api.del(`/api/contacts/${id}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Contactos</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Nuevo contacto
        </Button>
      </div>

      <p className="mb-4 text-sm text-gray-dark">
        Guárdalos para poder pedirle al bot "envíale un mensaje a [nombre]" sin tener que darle el número cada vez.
      </p>

      {!contacts && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {contacts && contacts.length === 0 && (
        <EmptyState icon={<Users />} title="Sin contactos todavía" />
      )}

      {contacts && contacts.length > 0 && (
        <div className="space-y-2">
          {contacts.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-ink dark:text-white">{c.name}</p>
                {c.notes && <p className="text-sm text-gray-dark">{c.notes}</p>}
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                aria-label="Eliminar"
              >
                <Trash2 size={16} />
              </button>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Nuevo contacto" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="contact-name">Nombre</Label>
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="contact-phone">Número de WhatsApp</Label>
              <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" />
            </div>
            <div>
              <Label htmlFor="contact-notes">Nota (opcional)</Label>
              <Input id="contact-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !name.trim() || !phone.trim()}>
              {saving ? 'Guardando…' : 'Guardar contacto'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
