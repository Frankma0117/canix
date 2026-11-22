import { useEffect, useRef } from 'react';

type StageData = { total: number; host: string; feature: unknown; scenes: Record<string, unknown>[] };
type StageWindow = Window & { stageSetup?: (d: object) => void; stageAt?: (t: number) => void; stageReady?: boolean };

const SIZE = { vertical: [1080, 1920], landscape: [1920, 1080] } as const;

/**
 * Live preview of a video: the same stage the server photographs frame by frame, played here in the
 * browser (no recording, no cost, no sound). It uses the saved timeline with the texts the administrator
 * is editing, so a change can be judged before asking for the real recording.
 */
export function StagePreview({ stage, format, texts, audio, original, sound }: { stage: StageData; format: 'vertical' | 'landscape'; texts: { text: string; say: string }[]; audio?: { scenes: (string | null)[]; music: string | null } | null; original: string[]; sound: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [w, h] = SIZE[format];
  const shown = format === 'vertical' ? 220 : 440;
  const scale = shown / w;
  const data = { ...stage, format, scenes: stage.scenes.map((s, i) => ({ ...s, text: texts[i]?.text ?? s.text, say: texts[i]?.say ?? s.say })) };
  const key = JSON.stringify([format, texts]);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let raf = 0;
    let stopped = false;
    let stopAudio = () => undefined as void;
    const start = () => {
      const win = el.contentWindow as StageWindow | null;
      if (!win?.stageSetup) return;
      win.stageSetup(data);
      const t0 = performance.now();
      // Narration already recorded (only for scenes whose text was not edited) and the music, quiet underneath.
      const clips = stage.scenes.map((s, i) => {
        const url = audio?.scenes[i];
        if (!url || texts[i]?.say !== original[i]) return null;
        const a = new Audio(url);
        a.preload = 'auto';
        return { a, at: Number(s.say_start ?? s.start ?? 0), played: false };
      });
      const bed = audio?.music ? new Audio(audio.music) : null;
      if (bed) {
        bed.volume = 0.18;
        bed.loop = true;
        void bed.play().catch(() => undefined);
      }
      let last = 0;
      const tick = () => {
        if (stopped) return;
        const t = ((performance.now() - t0) / 1000) % stage.total;
        if (t < last) clips.forEach((c) => c && ((c.played = false), c.a.pause()));
        last = t;
        clips.forEach((c) => {
          if (!c) return;
          c.a.muted = !soundRef.current;
          if (!c.played && t >= c.at) {
            c.played = true;
            c.a.currentTime = 0;
            if (t - c.at < 1) void c.a.play().catch(() => undefined);
          }
        });
        if (bed) bed.muted = !soundRef.current;
        if (win.stageReady && win.stageAt) win.stageAt(t);
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopAudio = () => {
        clips.forEach((c) => c?.a.pause());
        bed?.pause();
      };
    };
    el.addEventListener('load', start);
    if (el.contentDocument?.readyState === 'complete') start();
    return () => {
      stopped = true;
      stopAudio();
      cancelAnimationFrame(raf);
      el.removeEventListener('load', start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="mx-auto overflow-hidden rounded-xl bg-[#0b0e24]" style={{ width: shown, height: h * scale }}>
      <iframe ref={frame} key={key} title="Vista previa" src="/promo/stage.html" scrolling="no" style={{ width: w, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
    </div>
  );
}
