import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, ExternalLink, Check, Clapperboard } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { LibraryResponse, MediaItem, MediaKind } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { useToast } from '../components/molecules/Toast.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input, Select } from '../components/atoms/Input.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { StarRating } from '../components/atoms/StarRating.tsx';
import { GroupedTable, type Column } from '../components/organisms/GroupedTable.tsx';
import { MediaItemForm, draftOf, type MediaDraft } from '../components/organisms/library/MediaItemForm.tsx';
import { MEDIA_KIND_INFO, MEDIA_KINDS } from '../config/media.ts';
import { safeHref } from '../utils/url.ts';

type KindTab = MediaKind | 'all';
type Status = 'pending' | 'done' | 'all';
type Grouping = 'list' | 'genre' | 'creator' | 'kind' | 'status' | 'none';

const GROUPINGS: { id: Grouping; label: string }[] = [
  { id: 'list', label: 'Por lista' },
  { id: 'genre', label: 'Por género' },
  { id: 'creator', label: 'Por autor / artista' },
  { id: 'kind', label: 'Por tipo' },
  { id: 'status', label: 'Por estado' },
  { id: 'none', label: 'Sin agrupar' },
];

function groupKey(item: MediaItem, grouping: Grouping): string {
  if (grouping === 'genre') return item.genre?.trim() || 'Sin género';
  if (grouping === 'creator') return item.creator?.trim() || 'Sin autor';
  if (grouping === 'kind') return `${MEDIA_KIND_INFO[item.kind].emoji} ${MEDIA_KIND_INFO[item.kind].label}`;
  if (grouping === 'status') return item.checked ? 'Ya los viste / escuchaste' : 'Pendientes';
  return item.list_name;
}

/**
 * The media library: movies, series, music, books, games and podcasts in one table, grouped the
 * way the person wants (list, genre, artist/author...). Everything saved through WhatsApp ("este
 * link es una película sobre...") shows up here, and what's still pending is what Canix suggests
 * when asked "¿qué película puedo ver?".
 */
export function LibraryPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [kind, setKind] = useState<KindTab>('all');
  const [status, setStatus] = useState<Status>('pending');
  const [grouping, setGrouping] = useState<Grouping>('kind');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<MediaDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<LibraryResponse>('/api/library'));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => status === 'all' || (status === 'done' ? !!i.checked : !i.checked))
      .filter((i) => !needle || [i.title, i.creator, i.genre, i.summary, i.notes, i.list_name].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => groupKey(a, grouping).localeCompare(groupKey(b, grouping)) || a.title.localeCompare(b.title));
  }, [data, kind, status, q, grouping]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const i of data?.items ?? []) {
      if (i.checked && status === 'pending') continue;
      c.all = (c.all ?? 0) + 1;
      c[i.kind] = (c[i.kind] ?? 0) + 1;
    }
    return c;
  }, [data, status]);

  async function toggleDone(item: MediaItem) {
    try {
      await api.patch(`/api/library/${item.id}`, { done: !item.checked });
      toast.success(item.checked ? 'Lo dejé como pendiente' : `Marcado como ${MEDIA_KIND_INFO[item.kind].done}`);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function rate(item: MediaItem, rating: number | null) {
    await api.patch(`/api/library/${item.id}`, { rating }).catch((e) => setError(errMsg(e)));
    await load();
  }

  async function remove(item: MediaItem) {
    if (!confirm(`¿Borrar «${item.title}» de tu biblioteca?`)) return;
    await api.del(`/api/library/${item.id}`).catch((e) => setError(errMsg(e)));
    await load();
  }

  async function save(draft: MediaDraft) {
    const body = {
      kind: draft.kind,
      title: draft.title.trim(),
      creator: draft.creator.trim() || null,
      genre: draft.genre.trim() || null,
      year: draft.year ? Number(draft.year) : null,
      url: draft.url.trim() || null,
      summary: draft.summary.trim() || null,
      notes: draft.notes.trim() || null,
      list: draft.list.trim() || undefined,
      rating: draft.rating,
      done: draft.done,
    };
    try {
      if (draft.id) await api.patch(`/api/library/${draft.id}`, body);
      else await api.post('/api/library', body);
      setEditing(null);
      toast.success('Guardado en tu biblioteca');
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const columns: Column<MediaItem>[] = [
    {
      key: 'done',
      header: '',
      className: 'w-10',
      render: (i) => (
        <button
          type="button"
          onClick={() => toggleDone(i)}
          aria-label={i.checked ? 'Marcar como pendiente' : `Marcar como ${MEDIA_KIND_INFO[i.kind].done}`}
          className={`flex h-6 w-6 items-center justify-center rounded-lg border-2 transition-colors ${i.checked ? 'border-success bg-success text-white' : 'border-gray-medium hover:border-success dark:border-white/25'}`}
        >
          {!!i.checked && <Check size={14} strokeWidth={3} />}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Título',
      className: 'w-auto',
      render: (i) => (
        <div className="min-w-0">
          <p className={`font-semibold text-ink dark:text-white ${i.checked ? 'opacity-60' : ''}`}>
            {MEDIA_KIND_INFO[i.kind].emoji} {i.title}
            {i.year && <span className="ml-1 font-normal text-gray-dark">({i.year})</span>}
          </p>
          <p className="text-xs text-gray-dark md:hidden">{[i.creator, i.genre].filter(Boolean).join(' · ')}</p>
          {i.summary && <p className="mt-0.5 line-clamp-2 text-xs text-ink/70 dark:text-white/60">{i.summary}</p>}
          {i.notes && <p className="mt-0.5 text-xs text-ink/70 dark:text-white/60">📝 {i.notes}</p>}
          {i.related_notes.map((n) => (
            <p key={n.id} className="mt-0.5 line-clamp-1 text-xs text-primary-dark dark:text-indigo-200">
              💡 {n.title ? `${n.title}: ` : ''}
              {n.content}
            </p>
          ))}
        </div>
      ),
    },
    { key: 'creator', header: 'Autor / artista', hideOnMobile: true, className: 'w-40', render: (i) => <span className="text-ink/80 dark:text-white/75">{i.creator ?? '—'}</span> },
    { key: 'genre', header: 'Género', hideOnMobile: true, className: 'w-32', render: (i) => <span className="text-ink/80 dark:text-white/75">{i.genre ?? '—'}</span> },
    { key: 'list', header: 'Lista', hideOnMobile: true, className: 'w-36', render: (i) => <span className="text-xs text-gray-dark">{i.list_name}</span> },
    { key: 'rating', header: 'Calificación', hideOnMobile: true, className: 'w-32', render: (i) => <StarRating value={i.rating} onChange={(v) => rate(i, v)} size={14} /> },
    {
      key: 'actions',
      header: '',
      className: 'w-28 text-right',
      render: (i) => (
        <div className="flex justify-end gap-0.5">
          {safeHref(i.url) && (
            <a href={safeHref(i.url)} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" aria-label="Abrir link">
              <ExternalLink size={15} />
            </a>
          )}
          <button className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" onClick={() => setEditing(draftOf(i, i.kind))} aria-label="Editar">
            <Pencil size={15} />
          </button>
          <button className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error" onClick={() => remove(i)} aria-label="Borrar">
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Page
      title="Biblioteca"
      eyebrow="Películas, series, música y más"
      sticker="idea"
      wide
      description={
        <>
          Mándale a Canix un link y dile <em>«es una película sobre…»</em>: queda aquí y en tus links. Pregúntale <em>«¿qué película puedo ver?»</em> y te sugiere de lo que tienes pendiente.
        </>
      }
      actions={
        <Button onClick={() => setEditing(draftOf(null, kind === 'all' ? 'peliculas' : kind))}>
          <Plus size={16} /> Agregar
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs<KindTab>
        tabs={[{ id: 'all', label: '📚 Todo', count: counts.all ?? 0 }, ...MEDIA_KINDS.map((k) => ({ id: k, label: `${MEDIA_KIND_INFO[k].emoji} ${MEDIA_KIND_INFO[k].label}`, count: counts[k] ?? 0 }))]}
        active={kind}
        onChange={(k) => {
          setKind(k);
          if (k !== 'all' && grouping === 'kind') setGrouping('list');
        }}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input icon={<Search size={16} />} placeholder="Buscar por título, autor, género o notas…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Estado">
          <option value="pending">{kind === 'all' ? 'Pendientes' : MEDIA_KIND_INFO[kind].pending}</option>
          <option value="done">Ya {kind === 'all' ? 'vistos / escuchados' : MEDIA_KIND_INFO[kind].done}</option>
          <option value="all">Todo</option>
        </Select>
        <Select value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)} aria-label="Agrupar">
          {GROUPINGS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>

      {!data && <Skeleton className="h-48" />}
      {data && items.length === 0 && (
        <EmptyState
          icon={<Clapperboard />}
          title={q ? 'Nada coincide con tu búsqueda' : 'Todavía no hay nada aquí'}
          description="Agrega algo aquí o escríbele a Canix: «guarda Interstellar en mis películas»."
        />
      )}
      {data && items.length > 0 && (
        <GroupedTable rows={items} columns={columns} rowKey={(i) => i.id} groupOf={grouping === 'none' ? undefined : (i) => groupKey(i, grouping)} />
      )}

      {editing && data && <MediaItemForm initial={editing} lists={data.lists} onCancel={() => setEditing(null)} onSave={save} />}
    </Page>
  );
}
