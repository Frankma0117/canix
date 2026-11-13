import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, MessagesSquare, UserRound } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import { usePolling } from '../../services/store.tsx';
import type { ChatMessage, Conversation, Store, ThreadResponse } from '../../types/store.ts';
import { money, ORDER_STATUS, shortWhen } from '../../utils/store.ts';
import { hashParam } from '../../utils/navigation.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { ChatThread } from '../../components/organisms/store/ChatThread.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Avatar } from '../../components/atoms/Avatar.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

/**
 * Conversaciones: every chat of the business' number. The assistant answers by itself; when a
 * customer needs a person the chat is flagged here, and whoever writes takes it over.
 */
export function StoreChatsPage() {
  return (
    <StoreFrame title="Conversaciones" description="Los chats del WhatsApp del negocio. El asistente responde solo; cuando un cliente necesita a una persona, el chat queda marcado y al escribirle lo tomas tú.">
      {(store) => <Chats store={store} />}
    </StoreFrame>
  );
}

function Chats({ store }: { store: Store }) {
  const api = useApi();
  const toast = useToast();
  const base = `/api/stores/${store.id}/conversations`;
  const [list, setList] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<number | null>(() => Number(hashParam('c')) || null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  const loadList = useCallback(async () => {
    try {
      setList(await api.get<Conversation[]>(base));
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  usePolling(loadList, 8_000, [loadList]);

  const loadThread = useCallback(
    async (reset = false) => {
      if (!selected) return;
      try {
        const after = reset ? 0 : lastId.current;
        const res = await api.get<ThreadResponse>(`${base}/${selected}/messages?after=${after}`);
        lastId.current = res.messages[res.messages.length - 1]?.id ?? after;
        setThread((prev) => (reset || !prev ? res : { ...res, messages: mergeMessages(prev.messages, res.messages) }));
        setError(null);
      } catch (err) {
        setError(errMsg(err));
      }
    },
    [api, base, selected],
  );
  useEffect(() => {
    lastId.current = 0;
    setThread(null);
    void loadThread(true);
  }, [loadThread]);
  usePolling(() => loadThread(), 4_000, [loadThread]);

  async function setMode(mode: 'bot' | 'human') {
    try {
      await api.post(`${base}/${selected}/mode`, { mode });
      toast.success(mode === 'bot' ? 'El asistente vuelve a atender este chat.' : 'Tomaste la conversación: el asistente queda en pausa aquí.');
      await Promise.all([loadThread(), loadList()]);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  if (!list) return error ? <Notice tone="error">{error}</Notice> : <Skeleton className="h-96" />;
  if (list.length === 0 && !selected) {
    return <EmptyState icon={<MessagesSquare size={36} className="text-primary" />} title="Aún no hay conversaciones" description="Cuando un cliente le escriba al WhatsApp del negocio, su chat aparece aquí." />;
  }

  const customer = thread?.customer ?? list.find((c) => c.id === selected) ?? null;

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid h-[calc(100dvh-15rem)] min-h-[28rem] overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft lg:grid-cols-[20rem_1fr] dark:border-white/10 dark:bg-[var(--surface)]">
        <ul className={`min-h-0 overflow-y-auto border-gray-medium/70 lg:border-r dark:border-white/10 ${selected ? 'hidden lg:block' : ''}`}>
          {list.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelected(c.id)}
                aria-current={c.id === selected}
                className={`flex w-full items-start gap-3 border-b border-gray-medium/50 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/25 dark:border-white/10 ${
                  c.id === selected ? 'bg-secondary dark:bg-primary/20' : 'hover:bg-gray-light dark:hover:bg-white/5'
                }`}
              >
                <Avatar name={c.name} seed={c.id} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-ink dark:text-white">{c.name ?? (c.phone ? `+${c.phone}` : 'Cliente')}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-dark">{shortWhen(c.last_message_at).split(',').pop()}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-dark">{c.last_message_preview}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {c.mode === 'human' && <Badge tone="warning">Espera a una persona</Badge>}
                    {c.open_orders > 0 && <Badge tone="brand">Pedido en curso</Badge>}
                    {c.unread > 0 && <Badge tone="info">{c.unread} sin leer</Badge>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <section className={`min-h-0 flex-col ${selected ? 'flex' : 'hidden lg:flex'}`}>
          {!selected || !customer ? (
            <p className="m-auto px-6 text-center text-sm text-gray-dark">Elige una conversación para leerla.</p>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-gray-medium/70 px-3.5 py-2.5 dark:border-white/10">
                <button className="rounded-lg p-1.5 text-gray-dark hover:bg-gray-medium/60 lg:hidden" onClick={() => setSelected(null)} aria-label="Volver a la lista">
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink dark:text-white">{customer.name ?? 'Cliente'}</p>
                  <p className="truncate text-xs text-gray-dark">
                    {customer.phone ? `+${customer.phone}` : 'Número aún no visible'}
                    {thread?.orders[0] && ` · Pedido ${thread.orders[0].label}: ${ORDER_STATUS[thread.orders[0].status].label.toLowerCase()} (${money(thread.orders[0].total)})`}
                  </p>
                </div>
                {customer.mode === 'human' ? (
                  <Button size="sm" variant="secondary" onClick={() => void setMode('bot')}>
                    <Bot size={15} /> Devolver al asistente
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => void setMode('human')}>
                    <UserRound size={15} /> Tomar la conversación
                  </Button>
                )}
              </header>
              {customer.mode === 'human' && (
                <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
                  El asistente está en pausa en este chat{customer.handoff_reason ? `. Motivo: ${customer.handoff_reason}` : '.'}
                </p>
              )}
              <div className="min-h-0 flex-1">
                {!thread ? (
                  <Skeleton className="m-4 h-40" />
                ) : (
                  <ChatThread
                    messages={thread.messages}
                    waiting={thread.typing && customer.mode === 'bot'}
                    perspective="business"
                    placeholder={customer.mode === 'human' ? 'Escríbele al cliente' : 'Escríbele al cliente (tomas la conversación)'}
                    onSend={async (text) => {
                      try {
                        await api.post(`${base}/${selected}/messages`, { text });
                        await Promise.all([loadThread(), loadList()]);
                      } catch (err) {
                        setError(errMsg(err));
                        throw err;
                      }
                    }}
                  />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function mergeMessages(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const known = new Set(prev.map((m) => m.id));
  return [...prev, ...next.filter((m) => !known.has(m.id))];
}
