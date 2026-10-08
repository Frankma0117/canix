import { useEffect, useMemo, useState } from 'react';
import { BarChart3, MessageSquareText, Mic, PhoneCall, DollarSign, Settings2 } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { UsageRow } from '../../lib/types.ts';
import { operationInfo, estimateCost, useRates, usd, compact, DEFAULT_RATES, type Rates } from '../../lib/usage.ts';
import { Page, Notice, Tabs, StatCard, Avatar, SectionTitle } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';

interface PersonUsage {
  user_id: number;
  name: string | null;
  rows: UsageRow[];
  cost: number;
  paidCost: number;
}

export function UsagePage() {
  const api = useApi();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useRates();
  const [editRates, setEditRates] = useState(false);

  useEffect(() => {
    setRows(null);
    api
      .get<{ rows: UsageRow[] }>(`/api/admin/usage?days=${days}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(errMsg(e)));
  }, [api, days]);

  const people: PersonUsage[] = useMemo(() => {
    const map = new Map<number, PersonUsage>();
    for (const r of rows ?? []) {
      const p = map.get(r.user_id) ?? { user_id: r.user_id, name: r.name, rows: [], cost: 0, paidCost: 0 };
      const c = estimateCost(r, rates);
      p.rows.push(r);
      p.cost += c;
      if (operationInfo(r.operation).paid) p.paidCost += c;
      map.set(r.user_id, p);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [rows, rates]);

  const sum = (pred: (r: UsageRow) => boolean, field: 'uses' | 'input_units' | 'output_units') => (rows ?? []).filter(pred).reduce((s, r) => s + r[field], 0);
  const tokens = sum((r) => !operationInfo(r.operation).paid, 'input_units') + sum((r) => !operationInfo(r.operation).paid, 'output_units');
  const voiceChars = sum((r) => r.operation.startsWith('voice.fish'), 'input_units');
  const calls = sum((r) => r.operation === 'call.twilio', 'uses');
  const total = people.reduce((s, p) => s + p.cost, 0);
  const maxCost = Math.max(...people.map((p) => p.cost), 0.0001);

  return (
    <Page
      eyebrow="Administración"
      title="Uso y costos"
      sticker="progreso"
      wide
      description="Cuánto consume cada persona de IA, voz natural y llamadas. Los costos son estimados con tus tarifas: sirven para decidir cuánto cobrar por los extras."
      actions={
        <Button variant="secondary" onClick={() => setEditRates(true)}>
          <Settings2 size={16} /> Tarifas de estimación
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs
        active={days}
        onChange={setDays}
        tabs={[
          { id: '7', label: 'Últimos 7 días' },
          { id: '30', label: 'Últimos 30 días' },
          { id: '90', label: 'Últimos 90 días' },
        ]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<MessageSquareText size={18} />} label="Tokens de IA" value={rows ? compact(tokens) : '…'} hint="Conversación del asistente" />
        <StatCard icon={<Mic size={18} />} tone="violet" label="Caracteres de voz" value={rows ? compact(voiceChars) : '…'} hint="Voz natural (Fish Audio)" />
        <StatCard icon={<PhoneCall size={18} />} tone="cyan" label="Llamadas" value={rows ? compact(calls) : '…'} hint="Twilio" />
        <StatCard icon={<DollarSign size={18} />} tone="amber" label="Costo estimado" value={rows ? usd(total) : '…'} hint="Con las tarifas configuradas" />
      </div>

      <SectionTitle hint="Ordenado de mayor a menor costo estimado">Por persona</SectionTitle>
      {!rows && <Skeleton className="h-48 rounded-2xl" />}
      {rows && people.length === 0 && <EmptyState sticker="progreso" title="Todavía no hay consumo" description="Cuando el asistente se use, aquí verás el detalle por persona." />}
      <div className="space-y-3">
        {people.map((p) => (
          <Card key={p.user_id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={p.name} seed={p.user_id} size={42} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-extrabold text-ink dark:text-white">{p.name ?? '(sin nombre)'}</p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10">
                  <div className="brand-gradient h-full rounded-full" style={{ width: `${(p.cost / maxCost) * 100}%` }} />
                </div>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-black text-ink dark:text-white">{usd(p.cost)}</p>
                {p.paidCost > 0 && <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">{usd(p.paidCost)} en extras de pago</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.rows.map((r) => {
                const info = operationInfo(r.operation);
                return (
                  <Badge key={r.operation} tone={info.paid ? 'premium' : 'neutral'}>
                    <BarChart3 size={11} /> {info.label}: {compact(r.input_units + r.output_units)} {info.unit} · {usd(estimateCost(r, rates))}
                  </Badge>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      {editRates && <RatesModal rates={rates} onSave={(r) => { setRates(r); setEditRates(false); }} onClose={() => setEditRates(false)} />}
    </Page>
  );
}

function RatesModal({ rates, onSave, onClose }: { rates: Rates; onSave: (r: Rates) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(rates);
  const field = (key: keyof Rates, label: string, hint: string) => (
    <div>
      <Label>{label}</Label>
      <Input type="number" step="0.01" min="0" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
      <p className="mt-1 text-xs text-gray-dark">{hint}</p>
    </div>
  );
  return (
    <Modal title="Tarifas de estimación (USD)" description="Solo afectan los cálculos de esta pantalla en este navegador. Revisa los precios reales en cada proveedor." onClose={onClose} size="md">
      <div className="grid gap-4 sm:grid-cols-2">
        {field('tokenInPerM', 'IA: entrada por millón de tokens', 'DeepSeek / proveedor configurado')}
        {field('tokenOutPerM', 'IA: salida por millón de tokens', 'DeepSeek / proveedor configurado')}
        {field('fishPerMChars', 'Voz natural por millón de caracteres', 'Fish Audio')}
        {field('callEach', 'Costo promedio por llamada', 'Twilio (llamada corta)')}
      </div>
      <div className="mt-6 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_RATES)}>
          Restaurar valores
        </Button>
        <Button onClick={() => onSave(draft)}>Guardar tarifas</Button>
      </div>
    </Modal>
  );
}
