/**
 * The admin's own mascot sticker pack (copied into admin-panel/public/stickers, animated WebP) used
 * as illustrations, so the portal speaks the same visual language as the bot on WhatsApp.
 */
export type StickerName =
  | 'hola'
  | 'control'
  | 'vamos'
  | 'agendado'
  | 'llamada'
  | 'tareas'
  | 'nota'
  | 'meta'
  | 'rutina'
  | 'compras'
  | 'idea'
  | 'evento'
  | 'revisando'
  | 'trabajando'
  | 'hecho'
  | 'progreso'
  | 'confianza'
  | 'cafe'
  | 'noches'
  | 'paciencia'
  | 'premio'
  | 'listo'
  | 'mensaje'
  | 'enfoque';

export function Sticker({ name, size = 120, float, className = '' }: { name: StickerName; size?: number; float?: boolean; className?: string }) {
  return (
    <img
      src={`./stickers/${name}.webp`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={`select-none drop-shadow-[0_12px_20px_rgba(27,33,96,0.18)] ${float ? 'animate-float' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A sticker that fits the time of day - for greetings. */
export function greetingSticker(date = new Date()): { sticker: StickerName; greeting: string } {
  const h = date.getHours();
  if (h < 12) return { sticker: 'cafe', greeting: 'Buenos días' };
  if (h < 19) return { sticker: 'vamos', greeting: 'Buenas tardes' };
  return { sticker: 'noches', greeting: 'Buenas noches' };
}
