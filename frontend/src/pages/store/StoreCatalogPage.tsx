import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageOff, Pencil, Plus, Search, Star, Tag, Trash2 } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import type { CatalogResponse, Store, StoreCategory, StoreProduct, StorePromotion } from '../../types/store.ts';
import { WEEKDAY_SHORT } from '../../utils/dates.ts';
import { money } from '../../utils/store.ts';
import { hashParam } from '../../utils/navigation.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { ConfirmDialog } from '../../components/organisms/store/ConfirmDialog.tsx';
import { ProductForm, PromotionForm, productDraftOf, promotionDraftOf, type ProductDraft, type PromotionDraft } from '../../components/organisms/store/CatalogForms.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button, IconButton } from '../../components/atoms/Button.tsx';
import { Input } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

type TabId = 'products' | 'promotions' | 'categories';
type Doomed = { kind: 'product' | 'promotion' | 'category'; id: number; name: string };

/** Catálogo: what the assistant can offer and at what price - products, promotions and categories. */
export function StoreCatalogPage({ view }: { view?: 'products' | 'promotions' }) {
  const promos = view === 'promotions';
  return (
    <StoreFrame
      title={promos ? 'Promociones' : 'Productos'}
      description={promos ? 'La promoción del día: un producto a precio especial los días que elijas. El asistente la ofrece y cobra ese precio.' : 'Lo que el asistente puede ofrecer, con precio, foto y detalles. Los precios que cobra salen siempre de aquí.'}
    >
      {(store) => <Catalog store={store} view={view} />}
    </StoreFrame>
  );
}

function Catalog({ store, view }: { store: Store; view?: 'products' | 'promotions' }) {
  const api = useApi();
  const toast = useToast();
  const base = `/api/stores/${store.id}`;
  const [tab, setTab] = useState<TabId>(() => view ?? (hashParam('tab') === 'promotions' ? 'promotions' : 'products'));
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState<ProductDraft | null>(null);
  const [promotion, setPromotion] = useState<PromotionDraft | null>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get<CatalogResponse>(`${base}/catalog`));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  useEffect(() => void load(), [load]);

  async function run(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    setError(null);
    try {
      await action();
      if (done) toast.success(done);
      await load();
      return true;
    } catch (err) {
      setError(errMsg(err));
      return false;
    }
  }

  async function saveProduct(draft: ProductDraft) {
    const body = { name: draft.name, price: Number(draft.price), category_id: draft.category_id || null, description: draft.description, details: draft.details, available: draft.available, featured: draft.featured };
    const ok = await run(async () => {
      const id = draft.id ?? (await api.post<{ id: number }>(`${base}/products`, body)).id;
      if (draft.id) await api.patch(`${base}/products/${id}`, body);
      if (draft.file) await api.upload(`${base}/products/${id}/image`, [draft.file]);
      else if (draft.removeImage && draft.image_url) await api.del(`${base}/products/${id}/image`);
    }, 'Producto guardado.');
    if (ok) setProduct(null);
  }

  async function savePromotion(draft: PromotionDraft) {
    const body = {
      title: draft.title,
      description: draft.description,
      product_id: draft.product_id || null,
      promo_price: draft.product_id ? Number(draft.promo_price) : null,
      weekdays: draft.weekdays,
      start_date: draft.start_date || null,
      end_date: draft.end_date || null,
      active: draft.active,
    };
    const ok = await run(() => (draft.id ? api.patch(`${base}/promotions/${draft.id}`, body) : api.post(`${base}/promotions`, body)), 'Promoción guardada.');
    if (ok) setPromotion(null);
  }

  const products = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.products ?? []).filter((p) => !q || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q));
  }, [data, query]);

  const groups = useMemo(() => {
    const categories: (StoreCategory | null)[] = [...(data?.categories ?? []), null];
    return categories
      .map((c) => ({ category: c, rows: products.filter((p) => (c ? p.category_id === c.id : p.category_id === null)) }))
      .filter((g) => g.rows.length > 0);
  }, [data, products]);

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <Skeleton className="h-72" />;

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-x-4">
        {view === 'promotions' ? (
          <span />
        ) : (
          <Tabs
            tabs={[
              { id: 'products', label: 'Productos', count: data.products.length },
              ...(view ? [] : [{ id: 'promotions' as TabId, label: 'Promociones', count: data.promotions.length }]),
              { id: 'categories', label: 'Categorías', count: data.categories.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        )}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {tab === 'products' && (
            <>
              <div className="w-56">
                <Input icon={<Search size={16} />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto" />
              </div>
              <Button onClick={() => setProduct(productDraftOf(null))}>
                <Plus size={16} /> Nuevo producto
              </Button>
            </>
          )}
          {tab === 'promotions' && (
            <Button onClick={() => setPromotion(promotionDraftOf(null))}>
              <Plus size={16} /> Nueva promoción
            </Button>
          )}
        </div>
      </div>

      {tab === 'products' &&
        (data.products.length === 0 ? (
          <EmptyState icon={<Tag size={36} className="text-primary" />} title="Aún no hay productos" description="Agrega lo que vendes con su precio y una foto. El asistente solo ofrece lo que esté aquí." action={<Button onClick={() => setProduct(productDraftOf(null))}>Agregar el primero</Button>} />
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-dark">Ningún producto coincide con “{query}”.</p>
        ) : (
          <div className="space-y-6">
            {groups.map(({ category, rows }) => (
              <section key={category?.id ?? 0}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-base font-extrabold text-ink dark:text-white">
                    {category?.name ?? 'Sin categoría'} <span className="ml-1 text-sm font-semibold text-gray-dark">{rows.length}</span>
                  </h2>
                  <Button size="sm" variant="ghost" onClick={() => setProduct(productDraftOf(null, category?.id))}>
                    <Plus size={14} /> Agregar aquí
                  </Button>
                </div>
                <ul className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
                  {rows.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      onEdit={() => setProduct(productDraftOf(p))}
                      onDelete={() => setDoomed({ kind: 'product', id: p.id, name: p.name })}
                      onToggle={() => void run(() => api.patch(`${base}/products/${p.id}`, { available: !p.available }), p.available ? `${p.name}: agotado. El asistente ya no lo ofrece.` : `${p.name}: disponible de nuevo.`)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}

      {tab === 'promotions' &&
        (data.promotions.length === 0 ? (
          <EmptyState
            icon={<Tag size={36} className="text-primary" />}
            title="Sin promociones"
            description="Crea la promoción del día: un producto a precio especial los días que elijas. El asistente la ofrece y cobra ese precio."
            action={<Button onClick={() => setPromotion(promotionDraftOf(null))}>Crear una promoción</Button>}
          />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
            {data.promotions.map((promo) => (
              <PromotionRow key={promo.id} promo={promo} onEdit={() => setPromotion(promotionDraftOf(promo))} onDelete={() => setDoomed({ kind: 'promotion', id: promo.id, name: promo.title })} />
            ))}
          </ul>
        ))}

      {tab === 'categories' && (
        <div className="max-w-xl">
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCategory.trim()) return;
              void run(() => api.post(`${base}/categories`, { name: newCategory }), 'Categoría creada.').then((ok) => ok && setNewCategory(''));
            }}
          >
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nueva categoría, ej. Bebidas" maxLength={60} aria-label="Nombre de la nueva categoría" />
            <Button type="submit" disabled={!newCategory.trim()}>
              Agregar
            </Button>
          </form>
          {data.categories.length === 0 ? (
            <p className="text-sm text-gray-dark">Las categorías ordenan el menú que el asistente envía (Hamburguesas, Bebidas, Postres…).</p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
              {data.categories.map((c) => (
                <CategoryRow
                  key={c.id}
                  category={c}
                  count={data.products.filter((p) => p.category_id === c.id).length}
                  onRename={(name) => void run(() => api.patch(`${base}/categories/${c.id}`, { name }), 'Categoría renombrada.')}
                  onDelete={() => setDoomed({ kind: 'category', id: c.id, name: c.name })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {product && <ProductForm initial={product} categories={data.categories} onCancel={() => setProduct(null)} onSave={saveProduct} />}
      {promotion && <PromotionForm initial={promotion} products={data.products} onCancel={() => setPromotion(null)} onSave={savePromotion} />}
      {doomed && (
        <ConfirmDialog
          title={`Borrar ${doomed.kind === 'product' ? 'el producto' : doomed.kind === 'promotion' ? 'la promoción' : 'la categoría'}`}
          cta="Borrar"
          onCancel={() => setDoomed(null)}
          onConfirm={async () => {
            const path = doomed.kind === 'product' ? 'products' : doomed.kind === 'promotion' ? 'promotions' : 'categories';
            await run(() => api.del(`${base}/${path}/${doomed.id}`), 'Borrado.');
            setDoomed(null);
          }}
        >
          Vas a borrar <strong className="text-ink dark:text-white">{doomed.name}</strong>.{' '}
          {doomed.kind === 'product'
            ? 'También se borran sus promociones. Los pedidos ya hechos no cambian. Si solo se agotó, márcalo como agotado.'
            : doomed.kind === 'category'
              ? 'Sus productos no se borran: quedan sin categoría.'
              : 'El producto vuelve a su precio normal.'}
        </ConfirmDialog>
      )}
    </>
  );
}

function ProductRow({ product: p, onEdit, onDelete, onToggle }: { product: StoreProduct; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const onPromo = p.current_price < p.price;
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-medium/60 px-4 py-3 last:border-b-0 dark:border-white/10 ${p.available ? '' : 'bg-gray-light/60 dark:bg-white/[0.03]'}`}>
      <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-light text-gray-dark dark:bg-white/5 ${p.available ? '' : 'opacity-60 grayscale'}`}>
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageOff size={20} aria-label="Sin foto" />}
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink dark:text-white">
          {p.name}
          {!!p.featured && <Star size={14} className="fill-amber-400 text-amber-500" aria-label="Destacado" />}
          {onPromo && <Badge tone="premium">{p.promo_title}</Badge>}
        </p>
        {p.description && <p className="mt-0.5 line-clamp-2 max-w-[70ch] text-sm text-gray-dark">{p.description}</p>}
      </div>
      <div className="w-24 text-right tabular-nums">
        <p className="font-bold text-ink dark:text-white">{money(p.current_price)}</p>
        {onPromo && <p className="text-xs text-gray-dark line-through">{money(p.price)}</p>}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          aria-pressed={!!p.available}
          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${
            p.available ? 'bg-success/10 text-emerald-700 ring-success/20 hover:bg-success/20 dark:text-emerald-300' : 'bg-gray-medium/60 text-gray-dark ring-gray-medium hover:bg-gray-medium dark:bg-white/10 dark:ring-white/10'
          }`}
          title={p.available ? 'Marcar como agotado' : 'Marcar como disponible'}
        >
          {p.available ? 'Disponible' : 'Agotado'}
        </button>
        <IconButton label={`Editar ${p.name}`} onClick={onEdit}>
          <Pencil size={16} />
        </IconButton>
        <IconButton label={`Borrar ${p.name}`} onClick={onDelete} className="hover:!text-error">
          <Trash2 size={16} />
        </IconButton>
      </div>
    </li>
  );
}

function PromotionRow({ promo, onEdit, onDelete }: { promo: StorePromotion; onEdit: () => void; onDelete: () => void }) {
  const days = promo.weekdays ? [1, 2, 3, 4, 5, 6, 0].filter((d) => promo.weekdays!.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(', ') : 'Todos los días';
  const range = promo.start_date || promo.end_date ? ` · ${promo.start_date ? `desde ${promo.start_date}` : ''}${promo.end_date ? ` hasta ${promo.end_date}` : ''}` : '';
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-medium/60 px-4 py-3 last:border-b-0 dark:border-white/10">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink dark:text-white">
          {promo.title}
          {!promo.active ? <Badge tone="neutral">Pausada</Badge> : promo.applies_today ? <Badge tone="success">Aplica hoy</Badge> : <Badge tone="neutral">Hoy no aplica</Badge>}
        </p>
        {promo.description && <p className="mt-0.5 max-w-[70ch] text-sm text-gray-dark">{promo.description}</p>}
        <p className="mt-0.5 text-xs capitalize text-gray-dark">
          {days}
          <span className="normal-case">{range}</span>
        </p>
      </div>
      {promo.product_name && promo.promo_price != null && (
        <div className="text-right text-sm tabular-nums">
          <p className="text-gray-dark">{promo.product_name}</p>
          <p>
            <span className="text-gray-dark line-through">{money(promo.product_price ?? 0)}</span> <strong className="text-ink dark:text-white">{money(promo.promo_price)}</strong>
          </p>
        </div>
      )}
      <div className="flex items-center gap-1">
        <IconButton label={`Editar ${promo.title}`} onClick={onEdit}>
          <Pencil size={16} />
        </IconButton>
        <IconButton label={`Borrar ${promo.title}`} onClick={onDelete} className="hover:!text-error">
          <Trash2 size={16} />
        </IconButton>
      </div>
    </li>
  );
}

function CategoryRow({ category, count, onRename, onDelete }: { category: StoreCategory; count: number; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(category.name);
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex items-center gap-3 border-b border-gray-medium/60 px-4 py-2.5 last:border-b-0 dark:border-white/10">
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== category.name) onRename(name.trim());
            setEditing(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Nombre de la categoría" />
          <Button type="submit" size="sm">
            Guardar
          </Button>
        </form>
      ) : (
        <>
          <p className="flex-1 text-sm font-semibold text-ink dark:text-white">{category.name}</p>
          <span className="text-xs tabular-nums text-gray-dark">
            {count} {count === 1 ? 'producto' : 'productos'}
          </span>
          <IconButton label={`Renombrar ${category.name}`} onClick={() => setEditing(true)}>
            <Pencil size={16} />
          </IconButton>
          <IconButton label={`Borrar ${category.name}`} onClick={onDelete} className="hover:!text-error">
            <Trash2 size={16} />
          </IconButton>
        </>
      )}
    </li>
  );
}
