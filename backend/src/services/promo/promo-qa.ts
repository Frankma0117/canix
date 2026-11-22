import type { PromoScene } from '../../entities/promo.entity.js';

/**
 * Automatic quality gate of the video line (the checklist of the guide, as code). Returns warnings
 * the portal shows next to the video; an 'error' means the piece breaks a house rule and should
 * not be published as is. Pure function: no AI, no cost.
 */
export type QaIssue = { level: 'warn' | 'error'; msg: string };

const EMOJI = /\p{Extended_Pictographic}/u;
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;

export function qaVideo(scenes: (PromoScene & { dur?: number })[], total: number): QaIssue[] {
  const out: QaIssue[] = [];
  const add = (level: QaIssue['level'], msg: string) => out.push({ level, msg });
  scenes.forEach((s, i) => {
    const n = i + 1;
    const shown = [s.text, ...(s.items ?? []), s.note ?? '', ...(s.chat ?? []).map((c) => c.text)].join(' ');
    if (PHONE.test(shown) || PHONE.test(s.say)) add('error', `Escena ${n}: lleva un número de teléfono; el número va solo en el texto de la publicación.`);
    if (/…|\.\.\./.test(s.say)) add('error', `Escena ${n}: la voz lee raro los puntos suspensivos; usa coma o punto.`);
    if (EMOJI.test(s.text) || (s.items ?? []).some((x) => EMOJI.test(x) && s.shot !== 'features' && s.shot !== 'steps'))
      add('warn', `Escena ${n}: un emoji dentro del video puede salir como cuadro.`);
    if (s.dur !== undefined && s.dur < 0.8) add('warn', `Escena ${n}: dura menos de 0,8 s y no se alcanza a leer.`);
    if (s.text.length > 70) add('warn', `Escena ${n}: el texto en pantalla es largo (${s.text.length} letras).`);
  });
  if (scenes[0]?.shot !== 'hook') add('error', 'Debe empezar con un gancho.');
  if (scenes[scenes.length - 1]?.shot !== 'end') add('error', 'Debe terminar con el cierre de marca.');
  if (total > 75) add('warn', `Dura ${Math.round(total)} s: para redes conviene menos de 60 s.`);
  if (total < 12) add('warn', `Dura solo ${Math.round(total)} s.`);
  return out;
}

/** Voice text rules applied to anything typed by the administrator or the model. */
export function cleanSay(text: string): string {
  return text.replace(/…|\.{2,}/g, ',').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}
