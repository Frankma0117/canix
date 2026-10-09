import { useEffect, useMemo, useState } from 'react';
import { Eye, Users, Rocket, CheckCircle2, MessageCircle, ExternalLink, Copy, Table2, BarChart3, Link2, Search } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import { Page, Notice, Tabs, StatCard, SectionTitle } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label, Select } from '../../components/ui/Input.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { ColumnChart, BarList, Funnel, DataTable } from '../../components/charts/Charts.tsx';
import { goTo } from '../../lib/sections.tsx';

interface Report {
  days: number;
  landingUrl: string;
  totals: { pageviews: number; visitors: number; demoRequests: number; demoActivated: number; demoConverted: number; contactClicks: number; demoWhatsappClicks: number };
  funnel: { step: string; value: number }[];
  daily: { day: string; pageviews: number; visitors: number; demos: number }[];
  referrers: { name: string; n: number }[];
  campaigns: { name: string; n: number }[];
  devices: { name: string; n: number }[];
  sections: { name: string; n: number }[];
  clicks: { name: string; n: number }[];
  demoRequests: { code: string; name: string; interest: string | null; status: string; created_at: string; activated_at: string | null; user_id: number | null; demo_status: string | null; demo_expires_at: string | null }[];
}

const SECTION_NAMES: Record<string, string> = {
  hero: 'Portada',
  como_funciona: 'Cómo funciona',
  funciones: 'Funciones',
  modos: 'Modos',
  profesionales: 'Para profesionales',
  portal: 'Portal web y equipos',
  planes: 'Planes',
  demo: 'Demo gratis',
  seguridad: 'Seguridad',
  preguntas: 'Preguntas frecuentes',
  contacto: 'Contacto final',
};

function clickName(label: string): string {
  if (label.startsWith('contact_')) {
    const where: Record<string, string> = { nav: 'menú', hero: 'portada', pro: 'profesionales', final: 'final', footer: 'pie de página', float: 'botón flotante', plan_personal: 'plan personal', plan_pro: 'plan profesional', plan_teams: 'plan equipos' };
    return `Contáctanos (${where[label.slice(8)] ?? label.slice(8)})`;
  }
  return { demo_whatsapp: 'Abrir WhatsApp para activar demo', hero_demo: 'Probar gratis (portada)', nav_demo: 'Probar gratis (menú)', final_demo: 'Probar gratis (final)', nav_login: 'Ingresar (menú)', menu_login: 'Ingresar (menú móvil)' }[label] ?? label;
}

/** Local 'YYYY-MM-DD' for the last N days (oldest first), so empty days still show as 0. */
function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

export function AnalyticsPage() {
  const api = useApi();
  const toast = useToast();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get<Report>(`/api/admin/analytics?days=${days}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [api, days]);

  const series = useMemo(() => {
    const byDay = new Map((data?.daily ?? []).map((d) => [d.day, d]));
    return lastDays(Number(days)).map((day) => ({ key: day, label: shortDay(day), value: byDay.get(day)?.visitors ?? 0, pageviews: byDay.get(day)?.pageviews ?? 0, demos: byDay.get(day)?.demos ?? 0 }));
  }, [data, days]);

  const t = data?.totals;
  const landing = data?.landingUrl ?? '';
  const absLanding = landing.startsWith('http') ? landing : `${window.location.origin}${landing}`;

  return (
    <Page
      eyebrow="Administración"
      title="Analítica web"
      sticker="progreso"
      wide
      description="Quién visita tu página de venta, de dónde llega, qué lee y cuántos piden la demo o te contactan. Analítica propia: sin cookies ni servicios externos."
      actions={
        <>
          <Button onClick={() => window.open(absLanding, '_blank', 'noopener')}>
            <ExternalLink size={16} /> Ver página pública
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(absLanding);
              toast.success('Link de la página copiado.');
            }}
          >
            <Copy size={16} /> Copiar link
          </Button>
        </>
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

      <div className={`transition-opacity ${loading && data ? 'opacity-60' : ''}`}>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard icon={<Users size={18} />} label="Visitantes únicos" value={t ? t.visitors : '…'} hint="Personas distintas por día" />
          <StatCard icon={<Eye size={18} />} tone="cyan" label="Visitas" value={t ? t.pageviews : '…'} />
          <StatCard icon={<Rocket size={18} />} tone="violet" label="Pidieron demo" value={t ? t.demoRequests : '…'} />
          <StatCard icon={<CheckCircle2 size={18} />} tone="green" label="Activaron demo" value={t ? t.demoActivated : '…'} hint={t ? `${t.demoConverted} se volvieron clientes` : undefined} />
          <StatCard icon={<MessageCircle size={18} />} tone="amber" label="Clics en Contáctanos" value={t ? t.contactClicks : '…'} />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-lg font-extrabold text-ink dark:text-white">Visitantes por día</p>
                <p className="text-xs text-gray-dark">Pasa el cursor sobre una barra para ver el detalle</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTable(!table)}>
                {table ? <BarChart3 size={14} /> : <Table2 size={14} />} {table ? 'Ver gráfico' : 'Ver tabla'}
              </Button>
            </div>
            {!data ? (
              <Skeleton className="h-56" />
            ) : table ? (
              <DataTable columns={['Día', 'Visitantes', 'Visitas', 'Demos']} rows={[...series].reverse().map((s) => [s.key, s.value, s.pageviews, s.demos])} />
            ) : (
              <ColumnChart data={series} valueLabel="visitantes" height={300} />
            )}
          </Card>
          <Card className="p-5 lg:col-span-2">
            <p className="font-display text-lg font-extrabold text-ink dark:text-white">Embudo de conversión</p>
            <p className="mb-4 text-xs text-gray-dark">De visitante a cliente</p>
            {data ? <Funnel steps={data.funnel} /> : <Skeleton className="h-56" />}
          </Card>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="p-5">
            <p className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">De dónde llegan</p>
            <BarList data={(data?.referrers ?? []).map((r) => ({ name: r.name, value: r.n }))} total={t?.pageviews} />
          </Card>
          <Card className="p-5">
            <p className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">Qué secciones leen</p>
            <BarList data={(data?.sections ?? []).map((r) => ({ name: SECTION_NAMES[r.name] ?? r.name, value: r.n }))} total={t?.visitors} />
          </Card>
          <Card className="p-5">
            <p className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">Qué botones tocan</p>
            <BarList data={(data?.clicks ?? []).map((r) => ({ name: clickName(r.name), value: r.n }))} />
          </Card>
          <Card className="p-5">
            <p className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">Dispositivos</p>
            <BarList data={(data?.devices ?? []).map((r) => ({ name: r.name, value: r.n }))} total={t?.visitors} />
          </Card>
          <Card className="p-5 xl:col-span-2">
            <p className="mb-1 font-display text-lg font-extrabold text-ink dark:text-white">Campañas (UTM)</p>
            <p className="mb-4 text-xs text-gray-dark">Usa el generador de abajo para saber qué publicación o anuncio te trae visitas.</p>
            <BarList data={(data?.campaigns ?? []).map((r) => ({ name: r.name, value: r.n }))} empty="Aún no hay visitas con link de campaña." />
          </Card>
        </div>

        <SectionTitle hint="Las últimas solicitudes desde la página pública">Solicitudes de demo</SectionTitle>
        <Card className="overflow-hidden">
          {data && data.demoRequests.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-dark">Todavía nadie ha pedido una demo en este periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-light text-left text-xs font-bold uppercase tracking-wide text-gray-dark dark:bg-[#121636]">
                  <tr>
                    <th className="px-4 py-2.5">Nombre</th>
                    <th className="px-4 py-2.5">Interés</th>
                    <th className="px-4 py-2.5">Código</th>
                    <th className="px-4 py-2.5">Estado</th>
                    <th className="px-4 py-2.5">Pedida</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.demoRequests ?? []).map((d) => {
                    const state =
                      d.status === 'pending'
                        ? { label: 'Esperando WhatsApp', tone: 'warning' as const }
                        : d.demo_status === 'active'
                          ? { label: 'Demo activa', tone: 'success' as const }
                          : d.demo_status === 'expired'
                            ? { label: 'Demo vencida', tone: 'neutral' as const }
                            : d.user_id
                              ? { label: 'Cliente', tone: 'brand' as const }
                              : { label: d.status, tone: 'neutral' as const };
                    return (
                      <tr key={d.code} className="border-t border-gray-medium/50 dark:border-white/5">
                        <td className="px-4 py-2.5 font-semibold text-ink dark:text-white">
                          {d.user_id ? (
                            <button className="hover:text-primary hover:underline" onClick={() => goTo('admin-users')}>
                              {d.name}
                            </button>
                          ) : (
                            d.name
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-dark">{d.interest ?? '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{d.code}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={state.tone}>{state.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-gray-dark">{new Date(d.created_at.replace(' ', 'T') + 'Z').toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <UtmBuilder base={absLanding} />
          <SeoCard landing={absLanding} />
        </div>
      </div>
    </Page>
  );
}

function UtmBuilder({ base }: { base: string }) {
  const toast = useToast();
  const [source, setSource] = useState('instagram');
  const [medium, setMedium] = useState('social');
  const [campaign, setCampaign] = useState('');
  const slug = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = `${base}?utm_source=${slug(source) || 'otro'}&utm_medium=${slug(medium) || 'otro'}${campaign.trim() ? `&utm_campaign=${slug(campaign)}` : ''}`;
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
        <Link2 size={18} className="text-primary" /> Generador de links con seguimiento
      </p>
      <p className="mb-4 mt-1 text-sm text-gray-dark">Crea un link distinto para cada lugar donde publiques (Instagram, un grupo, un anuncio) y mira arriba cuál trae más visitas.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Dónde lo publicas</Label>
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {['instagram', 'facebook', 'tiktok', 'whatsapp', 'google', 'linkedin', 'youtube', 'email', 'otro'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={medium} onChange={(e) => setMedium(e.target.value)}>
            {['social', 'anuncio', 'grupo', 'estado', 'bio', 'mensaje', 'otro'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Campaña (opcional)</Label>
          <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="lanzamiento-octubre" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-medium bg-gray-light p-1.5 pl-3 dark:border-white/10 dark:bg-white/5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-dark">{url}</span>
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            toast.success('Link con seguimiento copiado.');
          }}
        >
          <Copy size={13} /> Copiar
        </Button>
      </div>
    </Card>
  );
}

function SeoCard({ landing }: { landing: string }) {
  const origin = landing.startsWith('http') ? new URL(landing).origin : window.location.origin;
  const items = [
    { ok: true, text: 'Título, descripción y palabras clave en español para búsquedas como “asistente virtual por WhatsApp” o “agenda de citas por WhatsApp”.' },
    { ok: true, text: 'Datos estructurados (Schema.org): software, organización y preguntas frecuentes, para resultados enriquecidos en Google.' },
    { ok: true, text: 'Imagen para compartir en redes y WhatsApp (Open Graph), sitemap y robots.txt.' },
    { ok: true, text: 'Página rápida: HTML listo para buscadores, poco JavaScript, imágenes livianas.' },
  ];
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
        <Search size={18} className="text-primary" /> Posicionamiento en Google (SEO)
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.text} className="flex gap-2 text-sm text-ink/80 dark:text-white/80">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
            {i.text}
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-xl bg-secondary/70 p-3.5 text-sm text-ink/80 dark:bg-white/5 dark:text-white/75">
        <p className="font-bold text-ink dark:text-white">Para aparecer más rápido en Google:</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li>
            Entra a <b>Google Search Console</b>, agrega tu sitio y elige verificación por “etiqueta HTML”.
          </li>
          <li>
            Pon el código en <code className="rounded bg-white px-1 dark:bg-white/10">GOOGLE_SITE_VERIFICATION</code> del .env y reinicia.
          </li>
          <li>
            Envía el sitemap: <code className="break-all rounded bg-white px-1 dark:bg-white/10">{origin}/sitemap.xml</code>
          </li>
        </ol>
      </div>
    </Card>
  );
}
