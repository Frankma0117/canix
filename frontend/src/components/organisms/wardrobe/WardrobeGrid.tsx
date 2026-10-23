import { useEffect, useState } from 'react';
import { Heart, Trash2, Shirt, Pencil, HelpCircle } from 'lucide-react';
import { errMsg, type Api } from '../../../services/api.ts';
import type { GarmentCard, WardrobeTaxonomy } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { FilterChip } from '../../molecules/wardrobe/FilterChip.tsx';
import { GarmentEditor } from './GarmentEditor.tsx';
import { pretty } from '../../../utils/wardrobe.ts';

export const PAGE = 60;

export function WardrobeGrid({ api, taxonomy, version, onChanged, onError }: { api: Api; taxonomy: WardrobeTaxonomy | null; version: number; onChanged: () => void; onError: (e: string | null) => void }) {
  const [rows, setRows] = useState<GarmentCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [type, setType] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  async function load(offset = 0) {
    try {
      const data = await api.get<{ total: number; rows: GarmentCard[] }>(`/api/garments?limit=${PAGE}&offset=${offset}${type ? `&type=${type}` : ''}`);
      setRows((prev) => (offset ? [...prev, ...data.rows] : data.rows));
      setTotal(data.total);
    } catch (e) {
      onError(errMsg(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, version]);

  async function toggleFav(g: GarmentCard) {
    setRows(rows.map((r) => (r.id === g.id ? { ...r, favorite: !r.favorite } : r)));
    await api.put(`/api/garments/${g.id}/favorite`, { favorite: !g.favorite }).catch((e) => onError(errMsg(e)));
  }

  async function remove(g: GarmentCard) {
    if (!confirm('¿Borrar esta prenda de tu armario? No se puede deshacer.')) return;
    try {
      await api.del(`/api/garments/${g.id}`);
      setRows(rows.filter((r) => r.id !== g.id));
      setTotal((t) => (t ? t - 1 : t));
      onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  const shown = onlyFav ? rows.filter((r) => r.favorite) : rows;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={!type} onClick={() => setType('')}>
          Todo
        </FilterChip>
        {taxonomy?.types.map((t) => (
          <FilterChip key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
            {t.label}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-gray-medium sm:block dark:bg-white/10" />
        <FilterChip active={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>
          <Heart size={13} fill={onlyFav ? 'currentColor' : 'none'} /> Favoritas
        </FilterChip>
      </div>

      {total === 0 && <EmptyState icon={<Shirt />} title={type ? 'No tienes prendas de este tipo' : 'Tu armario está vacío'} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((g) => (
          <Card key={g.id} className="group overflow-hidden">
            <div className="relative aspect-square bg-gray-light dark:bg-white/5">
              <button className="block h-full w-full" onClick={() => setEditing(g.id)} aria-label="Ver y editar">
                <img src={g.image_url} alt={g.short_description ?? g.category_label} loading="lazy" className="h-full w-full object-cover" />
              </button>
              {g.needs_review && (
                <span className="absolute left-2 top-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                    <HelpCircle size={12} /> Por revisar
                  </span>
                </span>
              )}
              <button
                onClick={() => toggleFav(g)}
                className={`absolute right-2 top-2 rounded-full bg-white/90 p-1.5 ${g.favorite ? 'text-error' : 'text-gray-dark'}`}
                aria-label="Favorita"
              >
                <Heart size={15} fill={g.favorite ? 'currentColor' : 'none'} />
              </button>
              <div className="absolute bottom-2 right-2 hidden gap-1.5 group-hover:flex">
                <button onClick={() => setEditing(g.id)} className="rounded-full bg-white/90 p-1.5 text-ink" aria-label="Editar">
                  <Pencil size={15} />
                </button>
                <button onClick={() => remove(g)} className="rounded-full bg-white/90 p-1.5 text-error" aria-label="Borrar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{g.category_label}</p>
              <p className="truncate text-xs text-gray-dark">{pretty(g.color) || 'sin color'}</p>
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

      {editing !== null && taxonomy && (
        <GarmentEditor
          api={api}
          taxonomy={taxonomy}
          garmentId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
