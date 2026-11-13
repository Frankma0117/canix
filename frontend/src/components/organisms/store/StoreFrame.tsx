import { useEffect, useState, type ReactNode } from 'react';
import { Store as StoreIcon } from 'lucide-react';
import { useApi } from '../../../services/api.ts';
import { useAuth } from '../../../services/auth.tsx';
import { useStores, type StoresState } from '../../../services/store.tsx';
import type { Store } from '../../../types/store.ts';
import { goTo } from '../../../utils/navigation.ts';
import { Page } from '../../templates/Page.tsx';
import { Notice } from '../../molecules/Notice.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Select } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';

/**
 * Frame shared by every "Pedidos" section: resolves which business is being managed (with a
 * picker when the person manages several) and renders the section for it.
 */
export function StoreFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: (store: Store) => ReactNode;
  children: (store: Store, stores: StoresState) => ReactNode;
}) {
  const stores = useStores();
  const { user } = useAuth();
  const { data, store, error } = stores;

  return (
    <Page
      title={store && data && data.stores.length === 1 ? `${title} · ${store.name}` : title}
      description={description}
      wide
      actions={
        store && (
          <>
            {data && data.stores.length > 1 && (
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-dark">
                <StoreIcon size={16} aria-hidden />
                <span className="sr-only">Negocio</span>
                <Select value={store.id} onChange={(e) => stores.select(Number(e.target.value))} className="!w-auto !py-2">
                  {data.stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {actions?.(store)}
          </>
        )
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <Skeleton className="h-72" />
      ) : !store ? (
        <EmptyState
          icon={<StoreIcon size={40} className="text-primary" />}
          title="Todavía no hay un negocio"
          description={
            user?.role === 'admin'
              ? 'Crea el primer negocio (o el de demostración, que ya trae catálogo y fotos) para empezar a recibir pedidos.'
              : 'El administrador aún no te ha asignado un negocio. Pídele que te agregue al equipo.'
          }
          action={user?.role === 'admin' ? <Button onClick={() => goTo('admin-stores')}>Ir a Negocios</Button> : undefined}
        />
      ) : (
        // Keyed by store: switching business resets the section's own state.
        <div key={store.id}>{children(store, stores)}</div>
      )}
    </Page>
  );
}

/** An image that needs the session to be fetched (payment receipts, photos customers sent). */
export function AuthedImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isProtected = src.startsWith('/api/');

  useEffect(() => {
    if (!isProtected) return;
    let objectUrl: string | null = null;
    let active = true;
    api
      .fileUrl(src)
      .then((u) => {
        objectUrl = u;
        if (active) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, src, isProtected]);

  if (failed) return <div className={`flex items-center justify-center bg-gray-medium/50 text-xs text-gray-dark ${className}`}>No se pudo cargar la imagen</div>;
  const shown = isProtected ? url : src;
  if (!shown) return <Skeleton className={className} />;
  return (
    <a href={shown} target="_blank" rel="noreferrer" title="Abrir en tamaño completo">
      <img src={shown} alt={alt} className={className} />
    </a>
  );
}
