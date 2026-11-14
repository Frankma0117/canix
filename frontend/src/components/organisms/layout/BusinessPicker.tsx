import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search, Settings2 } from 'lucide-react';
import type { Store } from '../../../types/store.ts';

const STATUS: Record<'on' | 'linked' | 'off', { dot: string; label: string }> = {
  on: { dot: 'bg-success', label: 'Conectado' },
  linked: { dot: 'bg-amber-500', label: 'Desconectado' },
  off: { dot: 'bg-gray-medium', label: 'Sin vincular' },
};
const statusOf = (s: Store) => (s.connection.connected ? 'on' : s.connection.linked ? 'linked' : 'off');
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/**
 * Business switcher: a listbox instead of the browser's native select. Shows each business with
 * its WhatsApp status and what is waiting, searches when there are many, and works with the
 * keyboard (arrows, Enter, Escape, typing to filter).
 */
export function BusinessPicker({ stores, selectedId, onSelect, onManage }: { stores: Store[]; selectedId: number; onSelect: (id: number) => void; onManage?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = stores.find((s) => s.id === selectedId) ?? stores[0]!;
  const searchable = stores.length > 6;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? stores.filter((s) => `${s.name} ${s.business_type ?? ''}`.toLowerCase().includes(q)) : stores;
  }, [stores, query]);
  // Waiting work in the OTHER businesses, so a switch is never a surprise.
  const elsewhere = stores.filter((s) => s.id !== current.id).reduce((n, s) => n + s.pendingOrders + s.humanChats, 0);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function show() {
    setQuery('');
    setCursor(Math.max(0, stores.findIndex((s) => s.id === current.id)));
    setOpen(true);
    requestAnimationFrame(() => search.current?.focus());
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  function choose(s: Store) {
    onSelect(s.id);
    close();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(shown.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = shown[cursor];
      if (s) choose(s);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            show();
          }
        }}
        className="group flex w-full items-center gap-2.5 rounded-xl border border-gray-medium/70 bg-white px-2.5 py-2 text-left shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:border-white/10 dark:bg-white/5"
      >
        <Avatar store={current} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink dark:text-white">{current.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-gray-dark">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS[statusOf(current)].dot}`} aria-hidden />
            {current.connection.connected ? `+${current.connection.phone}` : STATUS[statusOf(current)].label}
          </span>
        </span>
        {elsewhere > 0 && !open && <span className="h-2 w-2 rounded-full bg-error" title="Hay pendientes en otros negocios" aria-label="Pendientes en otros negocios" />}
        <ChevronsUpDown size={16} className="shrink-0 text-gray-dark transition-colors group-hover:text-primary" aria-hidden />
      </button>

      {open && (
        <div
          onKeyDown={onKey}
          className="absolute inset-x-0 top-full z-20 mt-1.5 origin-top animate-pop overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-xl dark:border-white/10 dark:bg-[#171b46]"
        >
          {searchable && (
            <label className="flex items-center gap-2 border-b border-gray-medium/60 px-3 py-2 dark:border-white/10">
              <Search size={15} className="text-gray-dark" aria-hidden />
              <span className="sr-only">Buscar negocio</span>
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="Buscar negocio"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-gray-dark dark:text-white"
              />
            </label>
          )}
          <ul id={listId} role="listbox" aria-label="Negocios" tabIndex={searchable ? -1 : 0} ref={(el) => {
              if (!searchable) el?.focus({ preventScroll: true });
            }} className="max-h-64 overflow-y-auto p-1.5 outline-none">
            {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-dark">Ningún negocio coincide.</li>}
            {shown.map((s, i) => {
              const selected = s.id === current.id;
              const waiting = s.pendingOrders + s.humanChats;
              return (
                <li key={s.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => choose(s)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-100 ${i === cursor ? 'bg-primary/10 dark:bg-white/10' : ''}`}
                  >
                    <Avatar store={s} small />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-ink dark:text-white">
                        <span className="truncate">{s.name}</span>
                        {!!s.is_demo && <span className="rounded bg-cyan-500/15 px-1.5 text-[10px] font-bold uppercase text-cyan-700 dark:text-cyan-300">Demo</span>}
                        {!s.active && <span className="rounded bg-gray-medium/60 px-1.5 text-[10px] font-bold uppercase text-gray-dark">Pausado</span>}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-gray-dark">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS[statusOf(s)].dot}`} aria-hidden />
                        <span className="truncate">{s.business_type ?? STATUS[statusOf(s)].label}</span>
                      </span>
                    </span>
                    {waiting > 0 && <span className="min-w-5 rounded-full bg-error px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white tabular-nums" title={`${s.pendingOrders} pedidos y ${s.humanChats} chats esperan`}>{waiting}</span>}
                    {selected && <Check size={16} className="shrink-0 text-primary" aria-label="Seleccionado" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {onManage && (
            <button
              type="button"
              onClick={() => {
                close(false);
                onManage();
              }}
              className="flex w-full items-center gap-2 border-t border-gray-medium/60 px-3.5 py-2.5 text-left text-sm font-semibold text-gray-dark transition-colors hover:bg-gray-light hover:text-primary dark:border-white/10 dark:hover:bg-white/5"
            >
              <Settings2 size={15} aria-hidden /> Administrar negocios
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ store, small }: { store: Store; small?: boolean }) {
  // A stable hue per business so they are told apart at a glance.
  const hue = [...store.name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-lg font-extrabold text-white ${small ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm'}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))` }}
    >
      {initials(store.name)}
    </span>
  );
}
