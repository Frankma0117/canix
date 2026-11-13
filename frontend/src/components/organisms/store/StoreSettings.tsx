import { useState, type ReactNode } from 'react';
import { errMsg, useApi } from '../../../services/api.ts';
import type { Store } from '../../../types/store.ts';
import { money } from '../../../utils/store.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Textarea } from '../../atoms/Input.tsx';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-[var(--color-primary)]" />
      <span>
        <span className="font-semibold text-ink dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-gray-dark">{hint}</span>}
      </span>
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-3 border-b border-gray-medium/60 py-6 first:pt-0 last:border-b-0 md:grid-cols-[15rem_1fr] dark:border-white/10">
      <div>
        <h2 className="text-base font-extrabold text-ink dark:text-white">{title}</h2>
        {hint && <p className="mt-1 text-sm leading-relaxed text-gray-dark">{hint}</p>}
      </div>
      <div className="max-w-2xl space-y-4">{children}</div>
    </section>
  );
}

/** Shared save plumbing for the two settings forms below. */
function useStoreForm<T extends object>(store: Store, initial: T, toBody: (draft: T) => Record<string, unknown>, onSaved: () => Promise<void>) {
  const api = useApi();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/stores/${store.id}`, toBody(draft));
      setSaved(draft);
      toast.success('Guardado. El asistente ya atiende con estos cambios.');
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }
  return { draft, set, dirty, saving, error, save };
}

function SaveBar({ dirty, saving }: { dirty: boolean; saving: boolean }) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-2 flex items-center gap-3 border-t border-gray-medium/60 bg-gray-light/95 px-1 py-3 dark:border-white/10 dark:bg-[#0b0e24]/95">
      <Button type="submit" loading={saving} disabled={!dirty}>
        Guardar cambios
      </Button>
      <span className="text-sm text-gray-dark">{dirty ? 'Tienes cambios sin guardar.' : 'Todo guardado.'}</span>
    </div>
  );
}

const INSTRUCTIONS_EXAMPLE = `Ejemplo:
Saluda con "¡Hola! Bienvenido a (tu negocio)". Tutea al cliente y usa mensajes cortos.
1. Si no sabe qué pedir, cuéntale la promoción del día.
2. Ofrece una bebida con cada plato, una sola vez.
3. Pide los datos de entrega en un solo mensaje.
Políticas: los domicilios tardan 40 minutos; no se aceptan devoluciones de comida…`;

/** How the assistant attends: the owner's own specification, in their words. */
export function AttentionForm({ store, onSaved }: { store: Store; onSaved: () => Promise<void> }) {
  const f = useStoreForm(
    store,
    { instructions: store.instructions ?? '', assistant_name: store.assistant_name ?? '', bot_enabled: !!store.bot_enabled },
    (d) => d,
    onSaved,
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void f.save();
      }}
    >
      {f.error && <Notice tone="error">{f.error}</Notice>}
      <Section title="Cómo atiende" hint="Escríbelo como se lo explicarías a un empleado nuevo: saludo, tono, en qué orden pregunta, qué ofrece y las políticas del negocio.">
        <div>
          <Label htmlFor="s-instructions">Especificación de atención</Label>
          <Textarea id="s-instructions" rows={16} value={f.draft.instructions} onChange={(e) => f.set('instructions', e.target.value)} maxLength={6000} placeholder={INSTRUCTIONS_EXAMPLE} className="leading-relaxed" />
          <Hint>
            {f.draft.instructions.length.toLocaleString('es-CO')} de 6.000 caracteres. Los productos, precios, horarios y datos de pago no van aquí: el asistente los toma del Catálogo y de la pestaña Negocio.
          </Hint>
        </div>
        <div className="max-w-xs">
          <Label htmlFor="s-assistant">Nombre del asistente</Label>
          <Input id="s-assistant" value={f.draft.assistant_name} onChange={(e) => f.set('assistant_name', e.target.value)} maxLength={40} placeholder="Ej. Brasi" />
          <Hint>Así se presenta. Vacío: “el asistente virtual”.</Hint>
        </div>
      </Section>
      <Section title="Estado" hint="Con el asistente apagado los mensajes siguen llegando a Conversaciones, pero nadie responde solo.">
        <Toggle checked={f.draft.bot_enabled} onChange={(v) => f.set('bot_enabled', v)} label="El asistente responde a los clientes" hint="Apágalo si prefieres atender todo a mano por un tiempo." />
      </Section>
      <Section title="Lo que nunca hace" hint="Reglas fijas del servicio, iguales para todos los negocios.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-dark">
          <li>No inventa productos ni precios: solo ofrece lo que está en el Catálogo, al precio de hoy.</li>
          <li>No confirma pedidos ni pagos: los deja “recibidos” y una persona del negocio los confirma en Pedidos.</li>
          <li>Pasa el chat a una persona cuando el cliente lo pide, hay un reclamo o no logra resolver.</li>
        </ul>
      </Section>
      <SaveBar dirty={f.dirty} saving={f.saving} />
    </form>
  );
}

/** The facts of the business the assistant answers with: hours, delivery, payments. */
export function BusinessForm({ store, onSaved }: { store: Store; onSaved: () => Promise<void> }) {
  const f = useStoreForm(
    store,
    {
      name: store.name,
      business_type: store.business_type ?? '',
      description: store.description ?? '',
      hours_text: store.hours_text ?? '',
      address: store.address ?? '',
      allows_pickup: !!store.allows_pickup,
      delivery_fee: String(store.delivery_fee),
      free_delivery_from: store.free_delivery_from != null ? String(store.free_delivery_from) : '',
      min_order: String(store.min_order),
      delivery_zones: store.delivery_zones ?? '',
      accepts_transfer: !!store.accepts_transfer,
      accepts_cash: !!store.accepts_cash,
      payment_info: store.payment_info ?? '',
    },
    (d) => ({ ...d, delivery_fee: Number(d.delivery_fee || 0), min_order: Number(d.min_order || 0), free_delivery_from: d.free_delivery_from === '' ? null : Number(d.free_delivery_from) }),
    onSaved,
  );
  const d = f.draft;
  const noPayment = !d.accepts_transfer && !d.accepts_cash;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!noPayment && d.name.trim()) void f.save();
      }}
    >
      {f.error && <Notice tone="error">{f.error}</Notice>}
      <Section title="El negocio" hint="Lo básico que el asistente sabe y cuenta cuando le preguntan.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="b-name">Nombre</Label>
            <Input id="b-name" value={d.name} onChange={(e) => f.set('name', e.target.value)} maxLength={80} required />
          </div>
          <div>
            <Label htmlFor="b-type">Tipo de negocio</Label>
            <Input id="b-type" value={d.business_type} onChange={(e) => f.set('business_type', e.target.value)} maxLength={80} placeholder="Restaurante, tienda de ropa, repostería…" />
          </div>
        </div>
        <div>
          <Label htmlFor="b-desc">Descripción</Label>
          <Textarea id="b-desc" rows={2} value={d.description} onChange={(e) => f.set('description', e.target.value)} maxLength={600} placeholder="Qué vendes y qué te hace distinto." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="b-hours">Horario de atención</Label>
            <Input id="b-hours" value={d.hours_text} onChange={(e) => f.set('hours_text', e.target.value)} maxLength={300} placeholder="Lunes a sábado de 11 a. m. a 9 p. m." />
          </div>
          <div>
            <Label htmlFor="b-address">Dirección del local</Label>
            <Input id="b-address" value={d.address} onChange={(e) => f.set('address', e.target.value)} maxLength={200} />
          </div>
        </div>
      </Section>

      <Section title="Entrega" hint="El costo del domicilio se suma solo al total del pedido.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="b-fee">Costo del domicilio</Label>
            <Input id="b-fee" inputMode="numeric" value={d.delivery_fee} onChange={(e) => f.set('delivery_fee', digits(e.target.value))} />
            <Hint>{Number(d.delivery_fee) > 0 ? money(Number(d.delivery_fee)) : 'Gratis'}</Hint>
          </div>
          <div>
            <Label htmlFor="b-free">Gratis desde</Label>
            <Input id="b-free" inputMode="numeric" value={d.free_delivery_from} onChange={(e) => f.set('free_delivery_from', digits(e.target.value))} placeholder="No aplica" />
            <Hint>{d.free_delivery_from ? `Compras desde ${money(Number(d.free_delivery_from))}` : 'Vacío: siempre se cobra.'}</Hint>
          </div>
          <div>
            <Label htmlFor="b-min">Pedido mínimo</Label>
            <Input id="b-min" inputMode="numeric" value={d.min_order} onChange={(e) => f.set('min_order', digits(e.target.value))} />
            <Hint>{Number(d.min_order) > 0 ? money(Number(d.min_order)) : 'Sin mínimo'}</Hint>
          </div>
        </div>
        <div>
          <Label htmlFor="b-zones">Zonas de cobertura</Label>
          <Textarea id="b-zones" rows={2} value={d.delivery_zones} onChange={(e) => f.set('delivery_zones', e.target.value)} maxLength={600} placeholder="Barrios o sectores a los que llegas, y a cuáles no." />
        </div>
        <Toggle checked={d.allows_pickup} onChange={(v) => f.set('allows_pickup', v)} label="El cliente puede recoger en el local" />
      </Section>

      <Section title="Pagos" hint="Cuando el cliente paga por transferencia, el asistente le da estos datos y le pide la foto del comprobante.">
        <div className="space-y-3">
          <Toggle checked={d.accepts_transfer} onChange={(v) => f.set('accepts_transfer', v)} label="Transferencia o consignación" hint="Nequi, Daviplata, Bancolombia, Bre-B…" />
          <Toggle checked={d.accepts_cash} onChange={(v) => f.set('accepts_cash', v)} label="Efectivo contra entrega" />
          {noPayment && <p className="text-sm font-semibold text-red-700 dark:text-red-300">Deja al menos un método de pago: sin ninguno no se pueden cerrar pedidos.</p>}
        </div>
        {d.accepts_transfer && (
          <div>
            <Label htmlFor="b-pay">Datos para transferir</Label>
            <Textarea id="b-pay" rows={3} value={d.payment_info} onChange={(e) => f.set('payment_info', e.target.value)} maxLength={800} placeholder="Nequi 300 123 4567 a nombre de… · Bancolombia ahorros 123-456789-01" />
            {!d.payment_info.trim() && <p className="mt-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">Sin estos datos, el asistente pasa el chat a una persona cuando alguien quiere transferir.</p>}
          </div>
        )}
      </Section>
      <SaveBar dirty={f.dirty && !noPayment} saving={f.saving} />
    </form>
  );
}
