import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, ImagePlus, SendHorizontal, X } from 'lucide-react';
import type { ChatMessage } from '../../../types/store.ts';
import { time12 } from '../../../utils/dates.ts';
import { IconButton } from '../../atoms/Button.tsx';
import { AuthedImage } from './StoreFrame.tsx';

/** WhatsApp markup (*negrilla*, _cursiva_, ~tachado~) rendered as it looks in the customer's chat. */
function waText(text: string): ReactNode[] {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith('~') && part.endsWith('~')) return <s key={i}>{part.slice(1, -1)}</s>;
    return part;
  });
}

const SENDER: Record<string, string> = { bot: 'Asistente', agent: 'Equipo', system: 'Aviso del pedido' };

function Bubble({ message, perspective }: { message: ChatMessage; perspective: 'business' | 'customer' }) {
  if (message.internal) {
    return (
      <li className="mx-auto max-w-[85%] rounded-xl bg-gray-medium/50 px-3 py-1.5 text-center text-xs leading-relaxed text-gray-dark dark:bg-white/10">
        {message.body}
        <span className="ml-2 tabular-nums opacity-70">{time12(message.created_at)}</span>
      </li>
    );
  }
  const fromCustomer = message.role === 'customer';
  // The side that is "mine" depends on who is looking: the business in Conversaciones, the customer in the test chat.
  const mine = perspective === 'customer' ? fromCustomer : !fromCustomer;
  const tone = fromCustomer
    ? 'bg-white text-ink ring-1 ring-gray-medium/70 dark:bg-white/10 dark:text-white dark:ring-white/10'
    : message.role === 'agent'
      ? 'bg-emerald-600 text-white'
      : message.role === 'system'
        ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-50 dark:ring-amber-300/20'
        : 'bg-primary text-white';
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm sm:max-w-[70%] ${tone} ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}>
        {!fromCustomer && <p className="mb-0.5 text-[11px] font-bold opacity-80">{SENDER[message.role]}</p>}
        {message.media_url && <AuthedImage src={message.media_url} alt={fromCustomer ? 'Imagen enviada por el cliente' : 'Foto del producto'} className="mb-1.5 max-h-64 w-full min-w-40 rounded-xl object-cover" />}
        {message.body && <p className="whitespace-pre-wrap break-words">{waText(message.body)}</p>}
        <p className="mt-0.5 text-right text-[10px] tabular-nums opacity-70">{time12(message.created_at)}</p>
      </div>
    </li>
  );
}

/**
 * A conversation and its composer. Used by Conversaciones (a person of the business writes) and by
 * "Probar el bot" (the person plays the customer, and can attach a receipt photo).
 */
export function ChatThread({
  messages,
  perspective,
  onSend,
  allowImage,
  placeholder,
  waiting,
  empty,
  disabledReason,
}: {
  messages: ChatMessage[];
  perspective: 'business' | 'customer';
  onSend: (text: string, file: File | null) => Promise<void>;
  allowImage?: boolean;
  placeholder: string;
  /** Shows "escribiendo…" while the assistant is working on its answer. */
  waiting?: boolean;
  empty?: ReactNode;
  disabledReason?: string;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastId = messages[messages.length - 1]?.id ?? 0;

  // Stays at the bottom as messages arrive.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, waiting]);
  useEffect(() => setFile(null), [disabledReason]);

  async function submit() {
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    try {
      await onSend(body, file);
      setText('');
      setFile(null);
    } catch {
      // the caller shows the error; what was typed stays in the box
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-gray-light/70 px-3 py-4 sm:px-5 dark:bg-black/20">
        {messages.length === 0 && !waiting ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-dark">{empty}</div>
        ) : (
          <ol className="space-y-2">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} perspective={perspective} />
            ))}
            {waiting && (
              <li className={`flex ${perspective === 'customer' ? 'justify-start' : 'justify-end'}`}>
                <span className="flex items-center gap-2 rounded-2xl bg-primary/10 px-3.5 py-2 text-sm text-primary-dark dark:bg-primary/25 dark:text-white">
                  <Bot size={15} /> El asistente está escribiendo…
                </span>
              </li>
            )}
          </ol>
        )}
      </div>

      {disabledReason ? (
        <p className="border-t border-gray-medium/70 px-4 py-3 text-center text-sm text-gray-dark dark:border-white/10">{disabledReason}</p>
      ) : (
        <form
          className="border-t border-gray-medium/70 bg-white px-3 py-3 dark:border-white/10 dark:bg-[var(--surface)]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {file && (
            <p className="mb-2 flex items-center gap-2 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-primary-dark dark:bg-primary/20 dark:text-white">
              <ImagePlus size={14} /> <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} aria-label="Quitar la imagen">
                <X size={14} />
              </button>
            </p>
          )}
          <div className="flex items-end gap-2">
            {allowImage && (
              <>
                <IconButton type="button" label="Adjuntar una imagen (por ejemplo, un comprobante)" onClick={() => fileInput.current?.click()} className="shrink-0">
                  <ImagePlus size={19} />
                </IconButton>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={placeholder}
              aria-label={placeholder}
              className="max-h-32 min-h-[42px] flex-1 resize-none rounded-2xl border border-gray-medium bg-white px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-gray-dark/70 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <button
              type="submit"
              disabled={sending || (!text.trim() && !file)}
              aria-label="Enviar"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-white transition-[transform,background-color,opacity] duration-150 hover:bg-primary-dark active:scale-[0.97] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25"
            >
              <SendHorizontal size={18} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
