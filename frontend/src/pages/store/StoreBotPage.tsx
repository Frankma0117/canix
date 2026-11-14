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
import { Badge } from '../../components/atoms/Badge.tsx';
import { Button } from '../../components/atoms/Button.tsx';

export type BotTab = 'test' | 'attention' | 'business' | 'whatsapp' | 'team';
type TabId = BotTab;
const TABS: TabId[] = ['test', 'attention', 'business', 'whatsapp', 'team'];

const PAGES: Record<BotTab, { title: string; description: string }> = {
  test: { title: 'Probar el asistente', description: 'Escríbele como si fueras un cliente. Responde con tu catálogo y tus indicaciones reales; no se envía nada a WhatsApp.' },
  attention: { title: 'Cómo atiende', description: 'El tono, los horarios, cuándo pasa a una persona y qué avisos recibes.' },
  business: { title: 'Datos y pagos', description: 'Dirección, medios de pago, costo de envío y los datos que el asistente da a tus clientes.' },
  whatsapp: { title: 'WhatsApp del negocio', description: 'El número por el que tus clientes te escriben. Vincúlalo escaneando un QR.' },
  team: { title: 'Equipo', description: 'Las personas que administran este negocio y sus accesos.' },
};

/**
 * One section of the business's assistant settings. Each is its own menu entry (`tab`); with no
 * `tab` (old links like #/store-bot?tab=whatsapp) it keeps the previous tabbed page.
 */
export function StoreBotPage({ tab }: { tab?: BotTab }) {
  const legacy = (hashParam('tab') as TabId | null) ?? 'test';
  const only = tab ?? (TABS.includes(legacy) ? legacy : 'test');
  const meta = PAGES[only];
  return (
    <StoreFrame title={meta.title} description={meta.description}>
      {(store, stores) => <Bot store={store} stores={stores} tab={only} />}
    </StoreFrame>
  );
}

function Bot({ store, stores, tab }: { store: Store; stores: StoresState; tab: TabId }) {
  return (
    <>
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
