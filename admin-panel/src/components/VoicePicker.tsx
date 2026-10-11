import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Play, Square } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import { Notice } from './ui/Page.tsx';
import { Button } from './ui/Button.tsx';
import { useToast } from './ui/Toast.tsx';

interface Voice {
  key: string;
  gender: 'male' | 'female';
  name: string;
  style: string;
}

/**
 * Choose the natural voice Canix uses in voice notes and calls: listen to each one and keep the
 * one you like. Only shown to people with the paid "Voz natural" extra.
 */
export function VoicePicker() {
  const api = useApi();
  const toast = useToast();
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [samples, setSamples] = useState(true);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());

  useEffect(() => {
    api
      .get<{ voices: Voice[]; current: string | null; samplesAvailable: boolean }>('/api/voices')
      .then((d) => {
        setVoices(d.voices);
        setCurrent(d.current);
        setSamples(d.samplesAvailable);
      })
      .catch((e) => setError(errMsg(e)));
    const cache = urls.current;
    return () => {
      audio.current?.pause();
      cache.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [api]);

  function stop() {
    audio.current?.pause();
    setPlayingKey(null);
  }

  async function listen(v: Voice) {
    if (playingKey === v.key) return stop();
    stop();
    setError(null);
    setLoadingKey(v.key);
    try {
      let url = urls.current.get(v.key);
      if (!url) {
        url = await api.fileUrl(`/api/voices/${v.key}/sample`);
        urls.current.set(v.key, url);
      }
      const player = new Audio(url);
      audio.current = player;
      player.onended = () => setPlayingKey(null);
      await player.play();
      setPlayingKey(v.key);
    } catch {
      setError(`No se pudo reproducir la muestra de ${v.name}. Intenta de nuevo en un momento.`);
    } finally {
      setLoadingKey(null);
    }
  }

  async function choose(v: Voice) {
    setSavingKey(v.key);
    setError(null);
    try {
      await api.put('/api/voices', { voice: v.key });
      setCurrent(v.key);
      toast.success(`Listo: Canix te hablará con la voz de ${v.name}.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSavingKey(null);
    }
  }

  const group = (gender: Voice['gender'], title: string) => (
    <fieldset className="mt-4">
      <legend className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-gray-dark">{title}</legend>
      <ul className="space-y-2">
        {(voices ?? [])
          .filter((v) => v.gender === gender)
          .map((v) => {
            const selected = current === v.key;
            return (
              <li
                key={v.key}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                  selected ? 'border-primary bg-primary/5 dark:bg-primary/15' : 'border-gray-medium/70 dark:border-white/10'
                }`}
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-semibold text-ink dark:text-white">
                    {v.name} <span className="font-normal text-gray-dark">· {v.key}</span>
                  </p>
                  <p className="text-xs text-gray-dark">{v.style.charAt(0).toUpperCase() + v.style.slice(1)}</p>
                </div>
                {samples && (
                  <Button variant="secondary" size="sm" onClick={() => listen(v)} disabled={loadingKey !== null} aria-label={`${playingKey === v.key ? 'Detener' : 'Escuchar'} la voz de ${v.name}`}>
                    {loadingKey === v.key ? <Loader2 size={14} className="animate-spin" /> : playingKey === v.key ? <Square size={14} /> : <Play size={14} />}
                    {playingKey === v.key ? 'Detener' : 'Escuchar'}
                  </Button>
                )}
                <Button
                  variant={selected ? 'primary' : 'soft'}
                  size="sm"
                  aria-pressed={selected}
                  disabled={selected || savingKey !== null}
                  loading={savingKey === v.key}
                  onClick={() => choose(v)}
                >
                  {selected && <Check size={14} />} {selected ? 'Tu voz' : 'Elegir'}
                </Button>
              </li>
            );
          })}
      </ul>
    </fieldset>
  );

  return (
    <div>
      <p className="font-display text-lg font-semibold text-ink dark:text-white">Voz de Canix</p>
      <p className="text-sm text-gray-dark">
        Escucha las voces y elige con cuál te responde Canix en las notas de voz y en las llamadas. También puedes pedírselo por WhatsApp: "¿qué voces hay?".
      </p>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!voices && !error && <p className="mt-3 text-sm text-gray-dark">Cargando voces…</p>}
      {voices && (
        <>
          {group('female', 'Voces de mujer')}
          {group('male', 'Voces de hombre')}
        </>
      )}
    </div>
  );
}
