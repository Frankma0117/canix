import { CheckCircle2, Search } from 'lucide-react';
import { Card } from '../../atoms/Card.tsx';

export function SeoCard({ landing }: { landing: string }) {
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
