import { useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';

export function UtmBuilder({ base }: { base: string }) {
  const toast = useToast();
  const [source, setSource] = useState('instagram');
  const [medium, setMedium] = useState('social');
  const [campaign, setCampaign] = useState('');
  const slug = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = `${base}?utm_source=${slug(source) || 'otro'}&utm_medium=${slug(medium) || 'otro'}${campaign.trim() ? `&utm_campaign=${slug(campaign)}` : ''}`;
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
        <Link2 size={18} className="text-primary" /> Generador de links con seguimiento
      </p>
      <p className="mb-4 mt-1 text-sm text-gray-dark">Crea un link distinto para cada lugar donde publiques (Instagram, un grupo, un anuncio) y mira arriba cuál trae más visitas.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Dónde lo publicas</Label>
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {['instagram', 'facebook', 'tiktok', 'whatsapp', 'google', 'linkedin', 'youtube', 'email', 'otro'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={medium} onChange={(e) => setMedium(e.target.value)}>
            {['social', 'anuncio', 'grupo', 'estado', 'bio', 'mensaje', 'otro'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Campaña (opcional)</Label>
          <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="lanzamiento-octubre" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-medium bg-gray-light p-1.5 pl-3 dark:border-white/10 dark:bg-white/5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-dark">{url}</span>
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            toast.success('Link con seguimiento copiado.');
          }}
        >
          <Copy size={13} /> Copiar
        </Button>
      </div>
    </Card>
  );
}
