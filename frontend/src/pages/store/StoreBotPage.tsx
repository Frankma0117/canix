import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, UserRound } from 'lucide-react';
import { errMsg, useApi } from '../../services/api.ts';
import { usePolling, type StoresState } from '../../services/store.tsx';
import type { ChatMessage, Store, ThreadResponse } from '../../types/store.ts';
import { hashParam } from '../../utils/navigation.ts';
import { money, ORDER_STATUS } from '../../utils/store.ts';
import { StoreFrame } from '../../components/organisms/store/StoreFrame.tsx';
import { ChatThread } from '../../components/organisms/store/ChatThread.tsx';
import { AttentionForm, BusinessForm } from '../../components/organisms/store/StoreSettings.tsx';
import { StoreWhatsApp } from '../../components/organisms/store/StoreWhatsApp.tsx';
import { StoreTeam } from '../../components/organisms/store/StoreTeam.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button } from '../../components/atoms/Button.tsx';

type TabId = 'test' | 'attention' | 'business' | 'whatsapp' | 'team';
const TABS: TabId[] = ['test', 'attention', 'business', 'whatsapp', 'team'];

/** Asistente: try it, tell it how to attend, the business facts, its WhatsApp number and the team. */
export function StoreBotPage() {
  return (
    <StoreFrame title="Asistente" description="Pruébalo como si fueras un cliente, dile cómo atender y conecta el WhatsApp del negocio.">
      {(store, stores) => <Bot store={store} stores={stores} />}
    </StoreFrame>
  );
}

function Bot({ store, stores }: { store: Store; stores: StoresState }) {
  const [tab, setTab] = useState<TabId>(() => {
    const asked = hashParam('tab') as TabId | null;
    return asked && TABS.includes(asked) ? asked : 'test';
  });
  return (
    <>
      <Tabs
        tabs={[
          { id: 'test' as TabId, label: 'Probar' },
          { id: 'attention' as TabId, label: 'Cómo atiende' },
          { id: 'business' as TabId, label: 'Negocio y pagos' },
          { id: 'whatsapp' as TabId, label: store.connection.connected ? 'WhatsApp' : 'WhatsApp · desconectado' },
          { id: 'team' as TabId, label: 'Equipo' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'test' && <TestChat store={store} />}
      {tab === 'attention' && <AttentionForm store={store} onSaved={stores.reload} />}
      {tab === 'business' && <BusinessForm store={store} onSaved={stores.reload} />}
      {tab === 'whatsapp' && <StoreWhatsApp store={store} />}
      {tab === 'team' && <StoreTeam store={store} />}
    </>
  );
}

const SUGGESTIONS = ['Hola, ¿qué promociones tienen hoy?', 'Mándame el menú', 'Quiero 2 hamburguesas dobles, una sin cebolla', 'Necesito hablar con una persona'];

/**
 * The test chat: you write as a customer would on WhatsApp, the real assistant answers, and the
 * order it takes shows up in Pedidos (marked as a test). Nothing is sent to WhatsApp.
 */
function TestChat({ store }: { store: Store }) {
  const api = useApi();
  const base = `/api/stores/${store.id}/simulator`;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  // Sent, and the server hasn't reported the assistant's turn yet (bridges the first poll).
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = justSent || !!thread?.typing;

  const load = useCallback(async () => {
    try {
      const res = await api.get<ThreadResponse>(base);
      setThread(res);
      setJustSent(false);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api, base]);
  useEffect(() => void load(), [load]);
  usePolling(load, waiting ? 1_200 : 5_000, [load, waiting]);

  async function send(text: string, file: File | null) {
    setError(null);
    try {
      if (file) {
        const fd = new FormData();
        fd.append('files', file, file.name);
        fd.append('text', text);
        await api.uploadForm(`${base}/message`, fd);
      } else {
        await api.post(`${base}/message`, { text });
      }
      setJustSent(true);
      await load();
    } catch (err) {
      setError(errMsg(err));
      throw err;
    }
  }

  async function action(path: string, body?: unknown) {
    try {
      await api.post(`${base}/${path}`, body);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const customer = thread?.customer;
  const messages: ChatMessage[] = thread?.messages ?? [];
  const order = thread?.orders[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
      <div className="flex h-[calc(100dvh-17rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-medium/70 px-4 py-2.5 dark:border-white/10">
          <p className="min-w-0 flex-1 text-sm font-bold text-ink dark:text-white">
            Chat de prueba · {store.assistant_name || 'Asistente'}
            {customer?.mode === 'human' && <span className="ml-2 font-normal text-amber-700 dark:text-amber-300">(en manos de una persona)</span>}
          </p>
          {customer?.mode === 'human' ? (
            <Button size="sm" variant="ghost" onClick={() => void action('handoff', { mode: 'bot' })}>
              Devolver al asistente
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void action('reset')} disabled={!customer}>
            <RotateCcw size={14} /> Empezar de nuevo
          </Button>
        </header>
        {error && (
          <div className="px-4 pt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ChatThread
            messages={messages}
            perspective="customer"
            allowImage
            waiting={waiting}
            placeholder="Escribe como lo haría un cliente"
            onSend={send}
            disabledReason={!store.bot_enabled ? 'El asistente está apagado. Actívalo en “Cómo atiende” para probarlo.' : undefined}
            empty={
              <div className="space-y-3">
                <p>Escribe como lo haría un cliente por WhatsApp. El asistente responde con tu catálogo y tus indicaciones reales.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s, null).catch(() => {})}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-primary-dark ring-1 ring-primary/25 transition-colors hover:bg-secondary dark:bg-white/10 dark:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <div>
          <h3 className="font-bold text-ink dark:text-white">Cómo probarlo</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-gray-dark">
            <li>Pide como escribe la gente: “2 dobles sin cebolla y una coca”.</li>
            <li>Pide fotos o el menú: llegan como en WhatsApp.</li>
            <li>Confirma el pedido y adjunta la foto de un comprobante con el botón de imagen.</li>
            <li>El pedido aparece en Pedidos marcado como prueba: confírmalo y envíalo para ver los avisos aquí.</li>
          </ul>
        </div>
        {order && (
          <div className="rounded-2xl border border-gray-medium/70 bg-white p-4 dark:border-white/10 dark:bg-[var(--surface)]">
            <p className="text-xs font-semibold text-gray-dark">Último pedido de prueba</p>
            <p className="mt-1 flex items-center justify-between gap-2">
              <span className="font-bold tabular-nums text-ink dark:text-white">
                {order.label} · {money(order.total)}
              </span>
              <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
            </p>
            <a href="#/store-orders" className="mt-2 inline-block text-xs font-semibold text-primary underline underline-offset-2">
              Verlo en Pedidos
            </a>
          </div>
        )}
        {customer?.mode !== 'human' && customer && (
          <Button size="sm" variant="secondary" onClick={() => void action('handoff', { mode: 'human' })}>
            <UserRound size={14} /> Simular “pasar a una persona”
          </Button>
        )}
      </aside>
    </div>
  );
}
