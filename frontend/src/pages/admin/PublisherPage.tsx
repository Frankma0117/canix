import { useCallback, useEffect, useState } from 'react';
import { CalendarX, ExternalLink, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../../services/api.ts';
import type { PostStatus, PublisherPost, PublisherResponse } from '../../types/publisher.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Card } from '../../components/atoms/Card.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';
import { BrandForm } from '../../components/organisms/publisher/BrandForm.tsx';
import { ConnectionsPanel } from '../../components/organisms/publisher/ConnectionsPanel.tsx';
import { AssetGenerator } from '../../components/organisms/publisher/AssetGenerator.tsx';
import { MediaGenerator } from '../../components/organisms/publisher/MediaGenerator.tsx';
import { AutomationPanel } from '../../components/organisms/publisher/AutomationPanel.tsx';
import { StudioPanel } from '../../components/organisms/publisher/StudioPanel.tsx';
import { PostComposer } from '../../components/organisms/publisher/PostComposer.tsx';

type Tab = 'queue' | 'new' | 'studio' | 'auto' | 'brand' | 'accounts';

const STATUS: Record<PostStatus, { label: string; tone: string }> = {
  draft: { label: 'Borrador', tone: 'bg-gray-medium text-gray-dark dark:bg-white/10' },
  scheduled: { label: 'Programada', tone: 'bg-primary/10 text-primary-dark dark:text-white' },
  publishing: { label: 'Enviando…', tone: 'bg-primary/10 text-primary-dark dark:text-white' },
  published: { label: 'Publicada', tone: 'bg-success/10 text-success' },
  partial: { label: 'Parcial', tone: 'bg-warning/10 text-warning' },
  failed: { label: 'Falló', tone: 'bg-error/10 text-error' },
};
const GROUPS: { id: string; title: string; match: PostStatus[] }[] = [
  { id: 'attention', title: 'Necesitan atención', match: ['failed', 'partial'] },
  { id: 'scheduled', title: 'Programadas', match: ['scheduled', 'publishing'] },
  { id: 'draft', title: 'Borradores', match: ['draft'] },
  { id: 'published', title: 'Publicadas', match: ['published'] },
];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * Publisher: prepares, schedules and sends videos and images to this project's own social accounts,
 * with SEO per network. Admin only. Phase 1 works with the simulated provider; the real networks plug in later.
 */
export function PublisherPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<PublisherResponse | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublisherPost | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<PublisherResponse>('/api/admin/publisher'));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  // While something is going out or waiting its turn, keep the queue fresh.
  const active = data?.posts.some((p) => p.status === 'scheduled' || p.status === 'publishing');
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [active, load]);

  async function act(id: number, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
      setAsking(null);
    }
  }

  async function prepare(assetId: string) {
    try {
      const post = await api.post<PublisherPost>('/api/admin/publisher/posts', { asset: assetId });
      await load();
      setEditing(post);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const connected = data?.connections.filter((c) => c.connected).length ?? 0;

  return (
    <Page title="Publicador" eyebrow="Redes sociales" sticker="vamos" wide description="Prepara, programa y publica tus videos e imágenes en las cuentas de este proyecto, con los textos y hashtags pensados para cada red.">
      {error && <Notice tone="error">{error}</Notice>}
      {data && connected === 0 && <Notice tone="info">Empieza conectando una red en la pestaña «Cuentas». Por ahora funciona la conexión simulada, para probar todo el flujo.</Notice>}

      <Tabs<Tab>
        tabs={[
          { id: 'queue', label: '🗓️ Cola', count: data?.posts.length },
          { id: 'new', label: '✨ Nueva', count: data?.assets.length },
          { id: 'studio', label: '🎨 Estudio' },
          { id: 'auto', label: '⚡ Automático', count: data?.awaiting || undefined },
          { id: 'brand', label: '🗣️ Marca' },
          { id: 'accounts', label: '🔗 Cuentas', count: connected },
        ]}
        active={tab}
        onChange={setTab}
      />

      {!data && <Skeleton className="h-64" />}

      {data && tab === 'queue' && (
        <>
          {data.posts.length === 0 && <EmptyState sticker="idea" title="Todavía no hay publicaciones" description="Elige un video o una imagen aprobados en «Nueva» y prepara su publicación." />}
          {GROUPS.map((g) => {
            const list = data.posts.filter((p) => g.match.includes(p.status));
            if (!list.length) return null;
            return (
              <section key={g.id} className="mb-8">
                <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">
                  {g.title} <span className="text-gray-dark">({list.length})</span>
                </h2>
                <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((p) => (
                    <Card key={p.id} className="overflow-hidden">
                      <div className="flex gap-3 p-4">
                        {p.mediaType === 'video' ? (
                          <video src={p.mediaUrl} poster={p.thumbnailUrl} muted playsInline preload="metadata" className="h-24 w-16 shrink-0 rounded-xl bg-black object-cover" />
                        ) : (
                          <img src={p.thumbnailUrl || p.mediaUrl} alt="" className="h-24 w-16 shrink-0 rounded-xl object-cover" />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                          <p className="mt-1 line-clamp-2 font-display font-extrabold text-ink dark:text-white">{p.title}</p>
                          {p.scheduledAt && p.status !== 'published' && <p className="text-xs text-gray-dark">{when(p.scheduledAt)}</p>}
                          {p.publishedAt && <p className="text-xs text-gray-dark">Salió {when(p.publishedAt)}</p>}
                        </div>
                      </div>
                      {p.targets.length > 0 && (
                        <ul className="space-y-1 border-t border-gray-medium px-4 py-3 text-xs dark:border-white/10">
                          {p.targets.map((t) => (
                            <li key={t.platform} className="flex flex-wrap items-center gap-x-2">
                              <span className="font-semibold text-ink dark:text-white">{t.name}</span>
                              <span className={t.status === 'published' ? 'text-success' : t.status === 'failed' ? 'text-error' : 'text-gray-dark'}>
                                {t.status === 'published' ? 'publicada' : t.status === 'failed' ? 'falló' : t.attempts ? `reintentando (${t.attempts})` : 'en espera'}
                              </span>
                              {t.url && (
                                <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-dark hover:underline dark:text-white">
                                  Ver <ExternalLink size={11} />
                                </a>
                              )}
                              {t.error && t.status !== 'published' && <span className="w-full text-error">{t.error}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-2 border-t border-gray-medium px-4 py-3 dark:border-white/10">
                        {['draft', 'scheduled', 'failed', 'partial'].includes(p.status) && (
                          <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                            <Pencil size={13} /> Editar
                          </Button>
                        )}
                        {(p.status === 'failed' || p.status === 'partial') && (
                          <Button size="sm" variant="soft" loading={busy === p.id} onClick={() => act(p.id, () => api.post(`/api/admin/publisher/posts/${p.id}/retry`), 'Listo: se reintentó.')}>
                            <RotateCw size={13} /> Reintentar
                          </Button>
                        )}
                        {p.status === 'scheduled' && (
                          <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => act(p.id, () => api.post(`/api/admin/publisher/posts/${p.id}/unschedule`), 'Listo: volvió a borrador.')}>
                            <CalendarX size={13} /> Cancelar
                          </Button>
                        )}
                        {p.status !== 'publishing' &&
                          (asking === p.id ? (
                            <span className="ml-auto flex items-center gap-1.5 text-xs">
                              ¿Borrar?
                              <Button size="sm" variant="danger" loading={busy === p.id} onClick={() => act(p.id, () => api.del(`/api/admin/publisher/posts/${p.id}`), 'Borrada.')}>
                                Sí
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                                No
                              </Button>
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" className="ml-auto" aria-label="Borrar" onClick={() => setAsking(p.id)}>
                              <Trash2 size={13} />
                            </Button>
                          ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {data && tab === 'new' && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">Material aprobado</h2>
            {data.assets.length === 0 ? (
              <EmptyState sticker="idea" title="No hay material aprobado" description="Crea un video o unas imágenes abajo y apruébalos en «Videos y publicidad». Luego aparecen aquí para publicarlos." />
            ) : (
              <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.assets.map((a) => (
                  <Card key={a.id} className="overflow-hidden">
                    {a.media === 'video' ? <video src={a.url} poster={a.poster} muted playsInline preload="metadata" className="aspect-[9/16] w-full bg-black object-cover" /> : <img src={a.url} alt={a.title} className="aspect-square w-full object-cover" />}
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-semibold text-ink dark:text-white">{a.title || 'Sin título'}</p>
                      <Button className="mt-2 w-full" size="sm" onClick={() => void prepare(a.id)}>
                        Preparar publicación
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
          <AssetGenerator api={api} onChanged={() => void load()} onPrepare={(id) => void prepare(id)} />
          <MediaGenerator api={api} cap={data.generation.cap} used={data.generation.used} textAi={data.generation.textAi} onCreated={() => void load()} />
        </div>
      )}

      {data && tab === 'studio' && (
        <StudioPanel
          api={api}
          onUse={(designId) => {
            void prepare(`d${designId}`).then(() => setTab('queue'));
          }}
        />
      )}
      {tab === 'auto' && <AutomationPanel api={api} onChanged={() => void load()} />}
      {data && tab === 'brand' && <BrandForm api={api} brand={data.brand} onSaved={() => void load()} />}
      {data && tab === 'accounts' && <ConnectionsPanel api={api} connections={data.connections} onChange={() => void load()} />}

      {data && editing && <PostComposer api={api} post={editing} connections={data.connections} textAi={data.generation.textAi} onClose={() => setEditing(null)} onChange={() => void load()} />}
    </Page>
  );
}
