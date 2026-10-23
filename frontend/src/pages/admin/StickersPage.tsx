import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Upload, Smile } from 'lucide-react';
import { useApi, errMsg } from '../../services/api.ts';
import type { StickerPackResponse } from '../../types/index.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Input, Select } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';
import { PackStickerCard, type StickerChanges } from '../../components/organisms/stickers/PackStickerCard.tsx';

type Filter = 'all' | 'suggested' | 'none' | 'paused';

/**
 * The bot's sticker pack. Each sticker says which moments it fits - the bot sends one on its own
 * when that moment happens (an action done, a greeting, the end of the day...), rotating so the
 * least recently used goes out - and an optional note on when to use it, which the assistant reads
 * to send it in conversation. New stickers get moments suggested from their name until set here.
 */
export function StickersPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<StickerPackResponse | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [moment, setMoment] = useState('');
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<StickerPackResponse>('/api/admin/stickers'));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function change(id: number, changes: StickerChanges) {
    try {
      await api.patch(`/api/admin/stickers/${id}`, changes);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function remove(id: number) {
    if (!confirm('¿Borrar este sticker del paquete?')) return;
    await api.del(`/api/admin/stickers/${id}`).catch((e) => setError(errMsg(e)));
    await load();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const result = await api.upload<{ created: number[]; skipped: string[] }>('/api/admin/stickers', [...files]);
      toast.success(`${result.created.length} sticker(s) agregados${result.skipped.length ? ` · omitidos: ${result.skipped.join(', ')}` : ''}`);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const stickers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.stickers ?? [])
      .filter((s) => (filter === 'suggested' ? s.momentsSuggested && s.moments.length > 0 : filter === 'none' ? s.moments.length === 0 : filter === 'paused' ? !s.active : true))
      .filter((s) => !moment || s.moments.includes(moment))
      .filter((s) => !needle || (s.label ?? '').includes(needle) || (s.usage ?? '').toLowerCase().includes(needle));
  }, [data, filter, moment, q]);

  const uncovered = (data?.moments ?? []).filter((m) => !data?.coverage[m.key]);
  const count = (f: Filter) => (data?.stickers ?? []).filter((s) => (f === 'suggested' ? s.momentsSuggested && s.moments.length > 0 : f === 'none' ? s.moments.length === 0 : f === 'paused' ? !s.active : true)).length;

  return (
    <Page
      title="Stickers"
      eyebrow="Tu paquete de stickers"
      sticker="hola"
      wide
      description="Marca en qué momentos encaja cada sticker y, si quieres, escribe cuándo usarlo. Canix los manda solo en esos momentos y rota para no repetir siempre los mismos."
      actions={
        <>
          <input ref={fileInput} type="file" accept=".webp,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
          <Button onClick={() => fileInput.current?.click()} loading={uploading}>
            <Upload size={16} /> Subir .webp
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {data && uncovered.length > 0 && (
        <Notice tone="warning">
          <strong>Momentos sin ningún sticker:</strong> {uncovered.map((m) => m.label).join(', ')}. En esos momentos no se manda nada hasta que les asignes uno.
        </Notice>
      )}
      <Notice tone="info">También puedes agregarlos mandándole el sticker a Canix por WhatsApp desde tu número: tu siguiente mensaje le pone el nombre.</Notice>

      <Tabs<Filter>
        tabs={[
          { id: 'all', label: 'Todos', count: count('all') },
          { id: 'suggested', label: 'Por confirmar', count: count('suggested') },
          { id: 'none', label: 'Sin momento', count: count('none') },
          { id: 'paused', label: 'Pausados', count: count('paused') },
        ]}
        active={filter}
        onChange={setFilter}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input icon={<Search size={16} />} placeholder="Buscar por nombre o uso…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={moment} onChange={(e) => setMoment(e.target.value)} aria-label="Momento">
          <option value="">Todos los momentos</option>
          {data?.moments.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({data.coverage[m.key] ?? 0})
            </option>
          ))}
        </Select>
      </div>

      {!data && <Skeleton className="h-64" />}
      {data && stickers.length === 0 && <EmptyState icon={<Smile />} title="No hay stickers aquí" description="Sube archivos .webp o mándaselos a Canix por WhatsApp." />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {data &&
          stickers.map((s) => (
            <PackStickerCard key={s.id} api={api} sticker={s} moments={data.moments} onChange={(c) => change(s.id, c)} onDelete={() => remove(s.id)} />
          ))}
      </div>
    </Page>
  );
}
