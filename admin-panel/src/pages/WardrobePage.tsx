import { useEffect, useState } from 'react';
import { Heart, Trash2, Shirt } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { GarmentCard } from '../lib/types.ts';
import { Page, Notice } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';

const PAGE = 60;

export function WardrobePage() {
  const api = useApi();
  const [rows, setRows] = useState<GarmentCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(offset = 0) {
    try {
      const data = await api.get<{ total: number; rows: GarmentCard[] }>(`/api/garments?limit=${PAGE}&offset=${offset}`);
      setRows((prev) => (offset ? [...prev, ...data.rows] : data.rows));
      setTotal(data.total);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleFav(g: GarmentCard) {
    setRows(rows.map((r) => (r.id === g.id ? { ...r, favorite: !r.favorite } : r)));
    await api.put(`/api/garments/${g.id}/favorite`, { favorite: !g.favorite }).catch((e) => setError(errMsg(e)));
  }

  async function remove(g: GarmentCard) {
    if (!confirm('¿Borrar esta prenda de tu armario? No se puede deshacer.')) return;
    try {
      await api.del(`/api/garments/${g.id}`);
      setRows(rows.filter((r) => r.id !== g.id));
      setTotal((t) => (t ? t - 1 : t));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const shown = onlyFav ? rows.filter((r) => r.favorite) : rows;
  return (
    <Page
      title="Mi armario"
      wide
      description="Para agregar prendas, mándale la foto al bot por WhatsApp en modo Fashion - la analiza y te pide confirmar."
      actions={
        <Button variant={onlyFav ? 'primary' : 'secondary'} onClick={() => setOnlyFav(!onlyFav)}>
          <Heart size={15} /> Favoritas
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {total === 0 && <EmptyState icon={<Shirt />} title="Tu armario está vacío" />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((g) => (
          <Card key={g.id} className="group overflow-hidden">
            <div className="relative aspect-square bg-gray-light dark:bg-white/5">
              <img src={g.image_url} alt={g.short_description ?? g.category} loading="lazy" className="h-full w-full object-cover" />
              <button
                onClick={() => toggleFav(g)}
                className={`absolute right-2 top-2 rounded-full bg-white/90 p-1.5 ${g.favorite ? 'text-error' : 'text-gray-dark'}`}
                aria-label="Favorita"
              >
                <Heart size={15} fill={g.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => remove(g)}
                className="absolute bottom-2 right-2 hidden rounded-full bg-white/90 p-1.5 text-error group-hover:block"
                aria-label="Borrar"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-medium capitalize text-ink dark:text-white">{g.category}</p>
              <p className="truncate text-xs text-gray-dark">{g.short_description ?? g.color ?? ''}</p>
            </div>
          </Card>
        ))}
      </div>
      {total !== null && rows.length < total && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => load(rows.length)}>
            Cargar más ({rows.length}/{total})
          </Button>
        </div>
      )}
    </Page>
  );
}
