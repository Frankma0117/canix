import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Send } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { Button } from './Button.tsx';
import { Sticker, type StickerName } from '../brand/Sticker.tsx';
import { useToast } from './Toast.tsx';

export interface CreatedInfo {
  /** "Recordatorio", "Rutina", "Cita"... */
  kind: string;
  /** The item's own title/name. */
  title: string;
  /** Portal section where it lives (sections.tsx id) - drives the link and the "Ver" button. */
  section: string;
  /** Extra lines shown under the title ("Mañana 8:00 a. m.", "Categoría: recetas"). */
  details?: string[];
  sticker?: StickerName;
  /** Text for "Compartir por WhatsApp" (defaults to kind + title + details). */
  shareText?: string;
  /** When set, a second share button sends it straight to this person (e.g. the client of a new
   *  appointment) - the "ábreselo a tus clientes" action. Digits with country code. */
  sharePhone?: string | null;
  sharePhoneLabel?: string;
}

const CreatedContext = createContext<((info: CreatedInfo) => void) | null>(null);

/**
 * "¡Quedó creado!" confirmation shown after creating anything in the portal: the direct link (with
 * a copy button), a button to go see it, and sharing over WhatsApp - generic, or straight to the
 * person it concerns (a professional's client).
 */
export function CreatedProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CreatedInfo | null>(null);
  const toast = useToast();
  const show = useCallback((i: CreatedInfo) => setInfo(i), []);

  const link = info ? `${window.location.origin}${window.location.pathname}#/${info.section}` : '';
  const text = info ? info.shareText ?? [`${info.kind}: ${info.title}`, ...(info.details ?? [])].join('\n') : '';

  const value = useMemo(() => show, [show]);
  return (
    <CreatedContext.Provider value={value}>
      {children}
      {info && (
        <Modal title="¡Quedó creado!" onClose={() => setInfo(null)} size="md">
          <div className="flex flex-col items-center text-center">
            <Sticker name={info.sticker ?? 'hecho'} size={120} className="animate-pop-in" />
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{info.kind}</p>
            <p className="font-display text-2xl font-black text-ink dark:text-white">{info.title}</p>
            {info.details?.map((d) => (
              <p key={d} className="text-sm text-gray-dark">
                {d}
              </p>
            ))}
          </div>

          <div className="mt-5">
            <p className="mb-1.5 text-sm font-semibold text-ink dark:text-white/85">Link directo</p>
            <div className="flex items-center gap-2 rounded-xl border border-gray-medium bg-gray-light p-1.5 pl-3 dark:border-white/10 dark:bg-white/5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-dark">{link}</span>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  toast.success('Link copiado.');
                }}
              >
                <Copy size={13} /> Copiar
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => {
                window.location.hash = `/${info.section}`;
                setInfo(null);
              }}
            >
              <ExternalLink size={16} /> Ver lo que creé
            </Button>
            <Button variant="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>
              <MessageCircle size={16} /> Compartir por WhatsApp
            </Button>
            {info.sharePhone && (
              <Button
                variant="soft"
                className="sm:col-span-2"
                onClick={() => window.open(`https://wa.me/${info.sharePhone!.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}
              >
                <Send size={16} /> {info.sharePhoneLabel ?? 'Enviárselo a la persona'}
              </Button>
            )}
          </div>
          <button onClick={() => setInfo(null)} className="mx-auto mt-4 flex items-center gap-1.5 text-sm font-semibold text-gray-dark hover:text-primary">
            <Check size={15} /> Listo, seguir creando
          </button>
        </Modal>
      )}
    </CreatedContext.Provider>
  );
}

export function useCreated(): (info: CreatedInfo) => void {
  const ctx = useContext(CreatedContext);
  if (!ctx) throw new Error('useCreated debe usarse dentro de <CreatedProvider>');
  return ctx;
}
