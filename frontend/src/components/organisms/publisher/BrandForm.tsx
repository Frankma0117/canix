import { useState } from 'react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PublisherBrand } from '../../../types/publisher.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Select, Textarea } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';

/** How this project talks on social media: feeds the SEO suggestions. */
export function BrandForm({ api, brand, onSaved }: { api: Api; brand: PublisherBrand; onSaved: () => void }) {
  const toast = useToast();
  const [b, setB] = useState({ ...brand, hashtags: brand.hashtags.map((t) => `#${t}`).join(' '), keywords: brand.keywords.join(', ') });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof b>(key: K, value: (typeof b)[K]) => setB((cur) => ({ ...cur, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      await api.put('/api/admin/publisher/brand', {
        ...b,
        hashtags: b.hashtags.split(/[\s,]+/).filter(Boolean),
        keywords: b.keywords.split(',').map((k) => k.trim()).filter(Boolean),
      });
      toast.success('Listo: los próximos textos usan este perfil.');
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">Perfil de marca</h2>
      <p className="mb-4 mt-1 text-sm text-gray-dark">Así habla este proyecto en redes. La IA y las plantillas lo usan para escribir títulos, descripciones y hashtags.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="br-name">Nombre de la marca</Label>
          <Input id="br-name" value={b.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="br-lang">Idioma</Label>
          <Select id="br-lang" value={b.language} onChange={(e) => set('language', e.target.value)}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="br-tone">Tono de voz</Label>
          <Textarea id="br-tone" rows={2} value={b.tone} maxLength={300} onChange={(e) => set('tone', e.target.value)} placeholder="Cercano, claro y con humor suave; sin tecnicismos." />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="br-aud">Público</Label>
          <Input id="br-aud" value={b.audience} maxLength={300} onChange={(e) => set('audience', e.target.value)} placeholder="Emprendedores que atienden clientes por WhatsApp" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="br-cta">Llamada a la acción habitual</Label>
          <Input id="br-cta" value={b.cta} maxLength={200} onChange={(e) => set('cta', e.target.value)} placeholder="Pruébalo gratis en WhatsApp" />
        </div>
        <div>
          <Label htmlFor="br-tags">Hashtags de la marca</Label>
          <Input id="br-tags" value={b.hashtags} onChange={(e) => set('hashtags', e.target.value)} placeholder="#canix #asistenteia" />
        </div>
        <div>
          <Label htmlFor="br-kw">Palabras clave (SEO)</Label>
          <Input id="br-kw" value={b.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="asistente en WhatsApp, recordatorios" />
          <Hint>Separadas por comas.</Hint>
        </div>
      </div>
      <Button className="mt-4" onClick={save} loading={busy}>
        Guardar perfil
      </Button>
    </Card>
  );
}
