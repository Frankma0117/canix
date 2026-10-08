/**
 * Sticker pack audit - run ON THE SERVER (that's where the real DB lives):
 *
 *   npm run stickers:audit             -> read-only report of every saved sticker
 *   npm run stickers:audit -- --export -> also writes every sticker + a gallery.html to
 *                                         data/stickers-export/ to look at them in a browser
 *   npm run stickers:audit -- --fix    -> applies the safe fixes the report lists (normalizes
 *                                         legacy labels, removes exact byte-duplicates and
 *                                         stickers WhatsApp can't resend). Never touches a
 *                                         sticker that's still waiting for its name.
 *
 * Checks each sticker against what util/stickers.ts and send-sticker.tool.ts need to actually
 * send it: WebP format (see isWebp), WhatsApp's 512x512 / 100KB static / 500KB animated limits,
 * a normalized label, and which automatic moment (celebration / buenas noches) it would cover.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/pool.js';
import { initSchema } from '../db/init.js';
import { normalizeStickerLabel, isWebp } from '../db/repositories/stickers.repo.js';
import { TODO_DONE_KEYWORDS, ROUTINE_DONE_KEYWORDS, NIGHT_KEYWORDS } from '../util/stickers.js';

interface Row {
  id: number;
  label: string | null;
  data: Buffer;
  mimetype: string;
  created_at: string;
}

interface WebpInfo {
  width: number;
  height: number;
  animated: boolean;
}

/** Reads canvas size + animation flag straight from the RIFF header (VP8X / VP8 / VP8L). */
function webpInfo(b: Buffer): WebpInfo | null {
  if (!isWebp(b) || b.length < 30) return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      animated: (b[20] & 0x02) !== 0,
      width: b.readUIntLE(24, 3) + 1,
      height: b.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === 'VP8 ') return { animated: false, width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const b1 = b[22], b2 = b[23], b3 = b[24];
    return {
      animated: false,
      width: (b[21] | ((b1 & 0x3f) << 8)) + 1,
      height: ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1,
    };
  }
  return null;
}

const squash = (s: string) => normalizeStickerLabel(s).replace(/_/g, '');
const matches = (label: string, keys: readonly string[]) => keys.some((k) => squash(label).includes(squash(k)));
const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;

const args = new Set(process.argv.slice(2));
const doFix = args.has('--fix');
const doExport = args.has('--export');

initSchema();
const rows = db.prepare('SELECT id, label, data, mimetype, created_at FROM stickers ORDER BY id').all() as Row[];
console.log(`\n=== Auditoría de stickers (${rows.length} en la base ${db.name}) ===\n`);
if (rows.length === 0) {
  console.log('No hay ningún sticker guardado. Mándale uno al bot desde el número administrador y ponle nombre.');
  process.exit(0);
}

const firstIdByBytes = new Map<string, number>();
const toDelete: { id: number; why: string }[] = [];
const toRename: { id: number; from: string; to: string }[] = [];
let errors = 0;
let warnings = 0;

for (const r of rows) {
  const problems: string[] = [];
  const notes: string[] = [];
  const info = webpInfo(r.data);

  if (!info) {
    problems.push(`❌ formato no WebP (${r.mimetype}) - WhatsApp no deja reenviarlo`);
    toDelete.push({ id: r.id, why: 'formato no reenviable' });
  } else {
    notes.push(`${info.width}x${info.height}`, info.animated ? 'animado' : 'estático', kb(r.data.length));
    if (info.width !== 512 || info.height !== 512) problems.push(`⚠️ tamaño ${info.width}x${info.height} (WhatsApp espera 512x512)`);
    const limit = info.animated ? 500 * 1024 : 100 * 1024;
    if (r.data.length > limit) problems.push(`⚠️ pesa ${kb(r.data.length)} (límite ${kb(limit)}) - puede llegar en blanco`);
  }

  const key = r.data.toString('base64');
  const dupOf = firstIdByBytes.get(key);
  if (dupOf !== undefined) {
    problems.push(`⚠️ es exactamente el mismo sticker que el #${dupOf}`);
    toDelete.push({ id: r.id, why: `duplicado de #${dupOf}` });
  } else firstIdByBytes.set(key, r.id);

  if (r.label === null) {
    problems.push(`⏳ sin nombre (recibido ${r.created_at}) - el próximo texto del admin le pone nombre`);
  } else {
    const norm = normalizeStickerLabel(r.label);
    if (!norm) problems.push('❌ el nombre queda vacío al normalizarlo (solo emojis/símbolos) - la IA no puede pedirlo');
    else if (norm !== r.label) {
      problems.push(`⚠️ nombre antiguo sin normalizar → quedaría "${norm}"`);
      toRename.push({ id: r.id, from: r.label, to: norm });
    }
    if (matches(r.label, TODO_DONE_KEYWORDS)) notes.push('✅ tareas');
    if (matches(r.label, ROUTINE_DONE_KEYWORDS)) notes.push('🔁 rutinas');
    if (matches(r.label, NIGHT_KEYWORDS)) notes.push('🌙 cierre del día');
  }

  errors += problems.filter((p) => p.startsWith('❌')).length;
  warnings += problems.filter((p) => p.startsWith('⚠️')).length;
  console.log(`#${r.id}  "${r.label ?? '(sin nombre)'}"  [${notes.join(' · ')}]`);
  for (const p of problems) console.log(`      ${p}`);
}

const labeled = rows.filter((r) => r.label);
const byLabel = new Map<string, number[]>();
for (const r of labeled) {
  const k = normalizeStickerLabel(r.label!);
  byLabel.set(k, [...(byLabel.get(k) ?? []), r.id]);
}
const pool = (keys: readonly string[]) => [...new Set(labeled.filter((r) => matches(r.label!, keys)).map((r) => r.label!))];
const report = (title: string, labels: string[], missing: string) =>
  console.log(labels.length ? `${title}: OK (${labels.join(', ')})` : `${title}: NINGUNO - ${missing}`);

console.log('\n=== Resumen ===');
console.log(`Con nombre: ${labeled.length} · sin nombre: ${rows.length - labeled.length} · errores: ${errors} · avisos: ${warnings}`);
console.log(`Nombres que ve la IA: ${[...byLabel.keys()].filter(Boolean).join(', ') || '(ninguno)'}`);
for (const [k, ids] of byLabel) if (ids.length > 1) console.log(`ℹ️ "${k}" tiene ${ids.length} stickers (${ids.map((i) => `#${i}`).join(', ')}) - se elige uno al azar, da variedad.`);
report('✅ Al completar una tarea', pool(TODO_DONE_KEYWORDS), 'no saldrá sticker. Nombra alguno "tarea completada", "bien hecho", "celebracion"...');
report('🔁 Al marcar una rutina', pool(ROUTINE_DONE_KEYWORDS), 'no saldrá sticker. Nombra alguno "habito completado", "bien hecho"...');
report('🌙 Cierre del día', pool(NIGHT_KEYWORDS), 'nombra alguno "buenas noches" si quieres que cierre el día con sticker.');

if (doExport) {
  const dir = path.resolve('data', 'stickers-export');
  fs.mkdirSync(dir, { recursive: true });
  const cards: string[] = [];
  for (const r of rows) {
    const name = `${r.id}_${r.label ? normalizeStickerLabel(r.label) || 'sin_nombre' : 'sin_nombre'}.webp`;
    fs.writeFileSync(path.join(dir, name), r.data);
    cards.push(`<figure><img src="${name}"><figcaption>#${r.id} ${r.label ?? '(sin nombre)'}</figcaption></figure>`);
  }
  fs.writeFileSync(
    path.join(dir, 'gallery.html'),
    `<!doctype html><meta charset="utf-8"><title>Stickers</title><style>body{font-family:sans-serif;display:flex;flex-wrap:wrap;gap:16px;padding:16px;background:#e5ddd5}figure{margin:0;background:#fff;padding:8px;border-radius:8px;text-align:center}img{width:160px;height:160px;object-fit:contain}</style>${cards.join('')}`,
  );
  console.log(`\n📁 Exportados a ${dir} (abre gallery.html para verlos).`);
}

if (toDelete.length || toRename.length) {
  console.log('\n=== Correcciones seguras disponibles ===');
  for (const d of toDelete) console.log(`- borrar #${d.id} (${d.why})`);
  for (const r of toRename) console.log(`- renombrar #${r.id} "${r.from}" → "${r.to}"`);
  if (doFix) {
    const del = db.prepare('DELETE FROM stickers WHERE id = ?');
    const ren = db.prepare('UPDATE stickers SET label = ? WHERE id = ?');
    db.transaction(() => {
      for (const d of toDelete) del.run(d.id);
      for (const r of toRename) ren.run(r.to, r.id);
    })();
    console.log('✅ Correcciones aplicadas.');
  } else console.log('(Nada se cambió. Corre con --fix para aplicarlas.)');
} else console.log('\n✅ No hay nada que corregir automáticamente.');
