import { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useApi, errMsg } from '../../services/api.ts';
import type { PromoMedia, PromoResponse } from '../../types/promo.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { Tabs } from '../../components/molecules/Tabs.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Card } from '../../components/atoms/Card.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Label, Select } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';
import { PromoCreator } from '../../components/organisms/promo/PromoCreator.tsx';
import { PromoCard } from '../../components/organisms/promo/PromoCard.tsx';

const GROUPS = [
  { id: 'review', title: 'Por revisar', match: ['review'] },
  { id: 'working', title: 'En proceso', match: ['pending', 'working', 'error'] },
  { id: 'approved', title: 'Aprobados', match: ['approved'] },
  { id: 'rejected', title: 'Descartados', match: ['rejected'] },
];

/**
 * Videos and images to advertise Canix on social media (admin only). Drawn from the brand - WhatsApp
 * chats, the mascot, the real features - narrated with one fixed voice; the administrator reviews,
 * corrects the texts and downloads the approved ones.
 */
export function PromoPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<PromoResponse | null>(null);
  const [media, setMedia] = useState<PromoMedia>('video');
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState('');
  const [music, setMusic] = useState('');
  const [sample, setSample] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PromoResponse>('/api/admin/promo');
      setData(res);
      setVoice((v) => v || res.status.voiceKey);
      setMusic((m) => m || res.status.musicKey);
      window.clearTimeout(timer.current);
      if (res.items.some((i) => i.status === 'pending' || i.status === 'working')) timer.current = window.setTimeout(() => void load(), 4000);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  async function saveSettings() {
    try {
      await api.put('/api/admin/promo/settings', { voice, music });
      toast.success('Listo: los próximos videos usan esta voz y esta música.');
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function listen() {
    try {
      setSample(await api.fileUrl(`/api/voices/${voice}/sample`));
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const st = data?.status;
  const items = (data?.items ?? []).filter((i) => i.media === media);
  const count = (m: PromoMedia) => (data?.items ?? []).filter((i) => i.media === m).length;

  return (
    <Page
      title="Videos y publicidad"
      eyebrow="Para tus redes"
      sticker="vamos"
      wide
      description="Videos e imágenes de Canix para publicar en redes: chats de WhatsApp de verdad, la mascota y las funciones reales. Los revisas, corriges los textos si quieres y descargas los aprobados."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {st && !st.canRender && (
        <Notice tone="warning">
          Falta instalar el grabador (navegador y fuentes) en el servidor. Se instala solo al actualizar: en el servidor corre <code>cd /opt/canix && sudo ./deploy.sh</code>.
        </Notice>
      )}
      {st && st.storage === 'local' && <Notice tone="info">Los archivos se guardan en el disco del servidor porque DigitalOcean Spaces no está configurado.</Notice>}

      <Tabs<PromoMedia>
        tabs={[
          { id: 'video', label: '🎬 Videos', count: count('video') },
          { id: 'image', label: '🖼️ Imágenes', count: count('image') },
        ]}
        active={media}
        onChange={setMedia}
      />

      {!st && <Skeleton className="h-64" />}
      {st && media === 'video' && (
        <Card className="mb-6 p-5 sm:p-6">
          <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">Voz y música de todos los videos</h2>
          <p className="mb-4 mt-1 text-sm text-gray-dark">Todos los videos usan la misma voz para que la marca suene siempre igual. La música va suave, por debajo de la voz.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="promo-voice">Voz {!st.voice && <span className="font-normal text-gray-dark">(falta FISH_AUDIO_API_KEY: sin voz, solo subtítulos)</span>}</Label>
              <div className="flex gap-2">
                <Select id="promo-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {(['female', 'male'] as const).map((g) => (
                    <optgroup key={g} label={g === 'female' ? 'Mujer' : 'Hombre'}>
                      {st.voices
                        .filter((v) => v.gender === g)
                        .map((v) => (
                          <option key={v.key} value={v.key}>
                            {v.name} · {v.style}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
                <Button variant="secondary" onClick={listen} disabled={!st.voice} aria-label="Escuchar la voz">
                  <Play size={15} />
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="promo-music">Música de fondo {!st.music && <span className="font-normal text-gray-dark">(falta FAL_KEY)</span>}</Label>
              <Select id="promo-music" value={music} onChange={(e) => setMusic(e.target.value)}>
                {st.musicOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {sample && <audio className="mt-3 w-full" src={sample} controls autoPlay />}
          <Button className="mt-4" size="sm" onClick={saveSettings}>
            Guardar voz y música
          </Button>
        </Card>
      )}
      {st && <PromoCreator key={media} api={api} media={media} status={st} onCreated={() => void load()} />}

      {data && items.length === 0 && (
        <EmptyState sticker="idea" title={media === 'video' ? 'Todavía no hay videos' : 'Todavía no hay imágenes'} description="Elige qué quieres mostrar y tócale crear. Aparecen aquí para que los revises." />
      )}
      {GROUPS.map((g) => {
        const list = items.filter((i) => g.match.includes(i.status));
        if (!list.length) return null;
        return (
          <section key={g.id} className="mb-8">
            <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">
              {g.title} <span className="text-gray-dark">({list.length})</span>
            </h2>
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((i) => (
                <PromoCard key={`${i.id}-${i.status}-${Object.values(i.files)[0]?.url ?? ''}`} api={api} item={i} onChange={() => void load()} />
              ))}
            </div>
          </section>
        );
      })}
    </Page>
  );
}
