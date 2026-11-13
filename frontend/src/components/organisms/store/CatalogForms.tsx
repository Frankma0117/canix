import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { StoreCategory, StoreProduct, StorePromotion } from '../../../types/store.ts';
import { WEEKDAY_SHORT } from '../../../utils/dates.ts';
import { money } from '../../../utils/store.ts';
import { Modal } from '../Modal.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Select, Textarea } from '../../atoms/Input.tsx';

export interface ProductDraft {
  id?: number;
  name: string;
  price: string;
  category_id: string;
  description: string;
  details: string;
  available: boolean;
  featured: boolean;
  image_url: string | null;
  /** A new photo picked in this form, uploaded after the product is saved. */
  file: File | null;
  removeImage: boolean;
}

export function productDraftOf(p: StoreProduct | null, categoryId?: number | null): ProductDraft {
  return {
    id: p?.id,
    name: p?.name ?? '',
    price: p ? String(p.price) : '',
    category_id: String(p?.category_id ?? categoryId ?? ''),
    description: p?.description ?? '',
    details: p?.details ?? '',
    available: p ? !!p.available : true,
    featured: !!p?.featured,
    image_url: p?.image_url ?? null,
    file: null,
    removeImage: false,
  };
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-[var(--color-primary)]" />
      <span>
        <span className="font-semibold text-ink dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-gray-dark">{hint}</span>}
      </span>
    </label>
  );
}

export function ProductForm({ initial, categories, onCancel, onSave }: { initial: ProductDraft; categories: StoreCategory[]; onCancel: () => void; onSave: (draft: ProductDraft) => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const shown = preview ?? (draft.removeImage ? null : draft.image_url);
  const valid = draft.name.trim() && draft.price !== '';

  function pick(file: File | undefined) {
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setDraft((d) => ({ ...d, file, removeImage: false }));
  }

  return (
    <Modal title={draft.id ? 'Editar producto' : 'Nuevo producto'} description="El asistente ofrece el producto con este nombre, precio y descripción." onClose={onCancel} size="md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setSaving(true);
          await onSave(draft).finally(() => setSaving(false));
        }}
      >
        <div className="flex gap-4">
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-medium bg-gray-light text-gray-dark transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:border-white/15 dark:bg-white/5"
              aria-label={shown ? 'Cambiar la foto' : 'Agregar una foto'}
            >
              {shown ? <img src={shown} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={26} />}
            </button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            {shown && (
              <button
                type="button"
                className="mt-1.5 flex w-28 items-center justify-center gap-1 text-xs font-semibold text-gray-dark hover:text-error"
                onClick={() => {
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                  setDraft((d) => ({ ...d, file: null, removeImage: true }));
                }}
              >
                <Trash2 size={12} /> Quitar foto
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <Label htmlFor="p-name">Nombre</Label>
              <Input id="p-name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="Hamburguesa doble carne" autoFocus required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-price">Precio</Label>
                <Input id="p-price" inputMode="numeric" value={draft.price} onChange={(e) => set('price', digits(e.target.value))} placeholder="25000" required />
                {draft.price && <Hint>{money(Number(draft.price))}</Hint>}
              </div>
              <div>
                <Label htmlFor="p-cat">Categoría</Label>
                <Select id="p-cat" value={draft.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="p-desc">Descripción</Label>
          <Textarea id="p-desc" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={500} placeholder="Lo que el cliente lee junto a la foto: qué trae, tamaño, sabor." />
        </div>
        <div>
          <Label htmlFor="p-details">Detalles para el asistente</Label>
          <Textarea id="p-details" rows={2} value={draft.details} onChange={(e) => set('details', e.target.value)} maxLength={1500} placeholder="Ingredientes, opciones, alérgenos, qué se puede quitar o cambiar." />
          <Hint>El asistente lo usa para responder preguntas; no se envía tal cual.</Hint>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Check checked={draft.available} onChange={(v) => set('available', v)} label="Disponible" hint="Desmárcalo cuando se agote: no se podrá pedir." />
          <Check checked={draft.featured} onChange={(v) => set('featured', v)} label="Destacado" hint="El asistente lo sugiere primero." />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!valid}>
            Guardar producto
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface PromotionDraft {
  id?: number;
  title: string;
  description: string;
  product_id: string;
  promo_price: string;
  weekdays: number[];
  start_date: string;
  end_date: string;
  active: boolean;
}

export function promotionDraftOf(p: StorePromotion | null): PromotionDraft {
  return {
    id: p?.id,
    title: p?.title ?? '',
    description: p?.description ?? '',
    product_id: String(p?.product_id ?? ''),
    promo_price: p?.promo_price != null ? String(p.promo_price) : '',
    weekdays: p?.weekdays ?? [],
    start_date: p?.start_date ?? '',
    end_date: p?.end_date ?? '',
    active: p ? !!p.active : true,
  };
}

/** Monday first, the way a week is read here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function PromotionForm({ initial, products, onCancel, onSave }: { initial: PromotionDraft; products: StoreProduct[]; onCancel: () => void; onSave: (draft: PromotionDraft) => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const product = products.find((p) => String(p.id) === draft.product_id);
  const priceTooHigh = !!product && draft.promo_price !== '' && Number(draft.promo_price) >= product.price;
  const valid = draft.title.trim() && !priceTooHigh && (!draft.product_id || draft.promo_price !== '');

  return (
    <Modal title={draft.id ? 'Editar promoción' : 'Nueva promoción'} description="El asistente la ofrece los días en que aplica y cobra el precio especial." onClose={onCancel} size="md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setSaving(true);
          await onSave(draft).finally(() => setSaving(false));
        }}
      >
        <div>
          <Label htmlFor="pr-title">Título</Label>
          <Input id="pr-title" value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={120} placeholder="Martes de doble carne" autoFocus required />
        </div>
        <div>
          <Label htmlFor="pr-desc">Descripción</Label>
          <Textarea id="pr-desc" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={500} placeholder="Qué incluye y sus condiciones." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pr-product">Producto en promoción</Label>
            <Select id="pr-product" value={draft.product_id} onChange={(e) => set('product_id', e.target.value)}>
              <option value="">Ninguno (solo anuncio)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price)}
                </option>
              ))}
            </Select>
            {!draft.product_id && <Hint>Sin producto, el asistente la menciona pero no cambia ningún precio.</Hint>}
          </div>
          {draft.product_id && (
            <div>
              <Label htmlFor="pr-price">Precio en promoción</Label>
              <Input id="pr-price" inputMode="numeric" value={draft.promo_price} onChange={(e) => set('promo_price', digits(e.target.value))} placeholder="20000" required />
              {priceTooHigh ? (
                <p className="mt-1.5 text-xs font-semibold text-red-700 dark:text-red-300">Debe ser menor que el precio normal ({money(product.price)}).</p>
              ) : (
                draft.promo_price && product && <Hint>{money(Number(draft.promo_price))} · ahorra {money(product.price - Number(draft.promo_price))}</Hint>
              )}
            </div>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold text-ink dark:text-white/85">Días en que aplica</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => {
              const on = draft.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('weekdays', on ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d])}
                  className={`rounded-xl px-3 py-1.5 text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
                    on ? 'bg-primary text-white' : 'bg-gray-medium/50 text-gray-dark hover:bg-gray-medium dark:bg-white/10 dark:hover:bg-white/15'
                  }`}
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              );
            })}
          </div>
          <Hint>{draft.weekdays.length === 0 || draft.weekdays.length === 7 ? 'Sin marcar ninguno, aplica todos los días.' : 'Solo los días marcados.'}</Hint>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pr-start">Desde (opcional)</Label>
            <Input id="pr-start" type="date" value={draft.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pr-end">Hasta (opcional)</Label>
            <Input id="pr-end" type="date" value={draft.end_date} min={draft.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} />
          </div>
        </div>
        <Check checked={draft.active} onChange={(v) => set('active', v)} label="Promoción activa" hint="Desactívala para pausarla sin borrarla." />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!valid}>
            Guardar promoción
          </Button>
        </div>
      </form>
    </Modal>
  );
}
