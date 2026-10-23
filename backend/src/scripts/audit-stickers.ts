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
 * Checks each sticker against what shared/utils/stickers.ts and send-sticker.tool.ts need to actually
 * send it: WebP format (see isWebp), WhatsApp's 512x512 / 100KB static / 500KB animated limits,
 * a normalized label, and which moments (services/stickers/sticker-moments.ts) it covers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../database/connection.js';
import { initSchema } from '../database/migrate.js';
import { normalizeStickerLabel, isWebp } from '../models/stickers.model.js';
import { momentsOf } from '../services/stickers/stickers.service.js';
import { STICKER_MOMENTS } from '../services/stickers/sticker-moments.js';
import { fromRoot } from '../config/paths.js';

interface Row {
  id: number;
  label: string | null;
  data: Buffer;
  mimetype: string;
  moments: string | null;
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

const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;

const args = new Set(process.argv.slice(2));
const doFix = args.has('--fix');
const doExport = args.has('--export');

initSchema();
const rows = db.prepare('SELECT id, label, data, mimetype, moments, created_at FROM stickers ORDER BY id').all() as Row[];
console.log(`\n=== Sticker audit (${rows.length} in database ${db.name}) ===\n`);
if (rows.length === 0) {
  console.log('No stickers saved. Send one to the bot from the admin number and give it a name.');
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
    problems.push(`❌ not WebP (${r.mimetype}) - WhatsApp won't resend it`);
    toDelete.push({ id: r.id, why: 'format cannot be resent' });
  } else {
    notes.push(`${info.width}x${info.height}`, info.animated ? 'animated' : 'static', kb(r.data.length));
    if (info.width !== 512 || info.height !== 512) problems.push(`⚠️ size ${info.width}x${info.height} (WhatsApp expects 512x512)`);
    const limit = info.animated ? 500 * 1024 : 100 * 1024;
    if (r.data.length > limit) problems.push(`⚠️ weighs ${kb(r.data.length)} (limit ${kb(limit)}) - may arrive blank`);
  }

  const key = r.data.toString('base64');
  const dupOf = firstIdByBytes.get(key);
  if (dupOf !== undefined) {
    problems.push(`⚠️ exact same sticker as #${dupOf}`);
    toDelete.push({ id: r.id, why: `duplicate of #${dupOf}` });
  } else firstIdByBytes.set(key, r.id);

  if (r.label === null) {
    problems.push(`⏳ unnamed (received ${r.created_at}) - the admin's next text names it`);
  } else {
    const norm = normalizeStickerLabel(r.label);
    if (!norm) problems.push('❌ the label is empty once normalized (only emojis/symbols) - the AI cannot ask for it');
    else if (norm !== r.label) {
      problems.push(`⚠️ legacy label not normalized → would become "${norm}"`);
      toRename.push({ id: r.id, from: r.label, to: norm });
    }
    const moments = momentsOf({ label: r.label, moments: r.moments });
    notes.push(moments.length ? `moments: ${moments.join(', ')}${r.moments ? '' : ' (suggested)'}` : 'no moment');
  }

  errors += problems.filter((p) => p.startsWith('❌')).length;
  warnings += problems.filter((p) => p.startsWith('⚠️')).length;
  console.log(`#${r.id}  "${r.label ?? '(unnamed)'}"  [${notes.join(' · ')}]`);
  for (const p of problems) console.log(`      ${p}`);
}

const labeled = rows.filter((r) => r.label);
const byLabel = new Map<string, number[]>();
for (const r of labeled) {
  const k = normalizeStickerLabel(r.label!);
  byLabel.set(k, [...(byLabel.get(k) ?? []), r.id]);
}
const pool = (moment: string) => [...new Set(labeled.filter((r) => momentsOf({ label: r.label, moments: r.moments }).includes(moment)).map((r) => r.label!))];
const report = (title: string, labels: string[], missing: string) =>
  console.log(labels.length ? `${title}: OK (${labels.join(', ')})` : `${title}: NONE - ${missing}`);

console.log('\n=== Summary ===');
console.log(`Named: ${labeled.length} · unnamed: ${rows.length - labeled.length} · errors: ${errors} · warnings: ${warnings}`);
console.log(`Names the AI sees: ${[...byLabel.keys()].filter(Boolean).join(', ') || '(none)'}`);
for (const [k, ids] of byLabel) if (ids.length > 1) console.log(`ℹ️ "${k}" has ${ids.length} stickers (${ids.map((i) => `#${i}`).join(', ')}) - one is picked at random, for variety.`);
for (const m of STICKER_MOMENTS) report(m.label, pool(m.key), 'no sticker for this moment - assign one in the portal (Stickers).');

if (doExport) {
  const dir = fromRoot('data', 'stickers-export');
  fs.mkdirSync(dir, { recursive: true });
  const cards: string[] = [];
  for (const r of rows) {
    const name = `${r.id}_${r.label ? normalizeStickerLabel(r.label) || 'unnamed' : 'unnamed'}.webp`;
    fs.writeFileSync(path.join(dir, name), r.data);
    cards.push(`<figure><img src="${name}"><figcaption>#${r.id} ${r.label ?? '(unnamed)'}</figcaption></figure>`);
  }
  fs.writeFileSync(
    path.join(dir, 'gallery.html'),
    `<!doctype html><meta charset="utf-8"><title>Stickers</title><style>body{font-family:sans-serif;display:flex;flex-wrap:wrap;gap:16px;padding:16px;background:#e5ddd5}figure{margin:0;background:#fff;padding:8px;border-radius:8px;text-align:center}img{width:160px;height:160px;object-fit:contain}</style>${cards.join('')}`,
  );
  console.log(`\n📁 Exported to ${dir} (open gallery.html to see them).`);
}

if (toDelete.length || toRename.length) {
  console.log('\n=== Safe fixes available ===');
  for (const d of toDelete) console.log(`- delete #${d.id} (${d.why})`);
  for (const r of toRename) console.log(`- rename #${r.id} "${r.from}" → "${r.to}"`);
  if (doFix) {
    const del = db.prepare('DELETE FROM stickers WHERE id = ?');
    const ren = db.prepare('UPDATE stickers SET label = ? WHERE id = ?');
    db.transaction(() => {
      for (const d of toDelete) del.run(d.id);
      for (const r of toRename) ren.run(r.to, r.id);
    })();
    console.log('✅ Fixes applied.');
  } else console.log('(Nothing changed. Run with --fix to apply them.)');
} else console.log('\n✅ Nothing to fix automatically.');
