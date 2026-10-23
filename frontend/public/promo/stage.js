// Stage of the advertising material (stage.html), driven by the server (backend/src/services/promo/promo-render.ts):
//   videos: window.stageSetup(data) once, then window.stageAt(seconds) for every frame - each frame is a pure function
//           of time (no CSS animations, no timers), so the recording is exact however slow the server is;
//   images: window.posterSetup(data) and a screenshot when window.stageReady is true.
// Video data = {mode:'video', format, total, host, feature, scenes:[{shot, text, say, start, dur, say_start, say_dur, chat, items}]}
// Image data = {mode:'image', format, layout, host, feature, headline, sub, bullets, cta, chat}

const stage = document.getElementById('stage');
let D;
let parts = [];
let fixed = {};

// ---------- helpers ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, d) => clamp((t - a) / d);
const easeOut = (x) => 1 - (1 - x) ** 3;
const back = (x) => { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const css = (el, o) => { for (const [k, v] of Object.entries(o)) el.style[k] = v; };
const sticker = (name, cls = 'sticker') => h('img', { class: cls, src: `../stickers/${name}.webp`, alt: '' });
const mark = (onGrad) => h('div', { class: `mark ${onGrad ? 'on-grad' : ''}` }, h('img', { src: '../favicon.svg', alt: '' }), 'Canix');

// Headline words; the last word or two get the brand gradient (like the site's titles).
function titleEl(text, accent = true) {
  const ws = String(text || '').split(/\s+/).filter(Boolean);
  const from = ws.length > 3 ? ws.length - 2 : ws.length - 1;
  return h('div', { class: 'title' }, ws.map((w, i) => h('span', { class: `w ${accent && i >= from ? 'hl' : ''}` }, w)));
}
function animWords(title, lt, delay = 0.15) {
  [...title.children].forEach((w, i) => {
    const p = easeOut(prog(lt, delay + i * 0.07, 0.4));
    css(w, { opacity: p, transform: `translateY(${(1 - p) * 0.5}em) scale(${0.9 + 0.1 * back(p)})` });
  });
}
// Long titles shrink until they fit their lines, so they never cover the phone or the cards.
function fitTitles(root, lines) {
  root.querySelectorAll('.title').forEach((el) => {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = size * 0.5;
    const max = typeof lines === 'function' ? lines(el) : lines;
    while ((el.scrollHeight > size * 1.08 * max + 2 || el.scrollWidth > el.clientWidth + 1) && size > min) {
      size *= 0.93;
      el.style.fontSize = `${size}px`;
    }
  });
}

// ---------- the WhatsApp phone ----------
function bubble(c) {
  const time = h('span', { class: 'meta' }, '9:41', c.from === 'me' ? h('span', { class: 'ticks' }, '✓✓') : null);
  if (c.voice) {
    const bars = Array.from({ length: 26 }, (_, i) => h('i', { style: `height:${30 + Math.round(60 * Math.abs(Math.sin(i * 1.7 + 1)))}%` }));
    return h('div', { class: `bubble ${c.from}` }, h('div', { class: 'voice' }, h('span', { class: 'play' }), h('span', { class: 'wave' }, bars), h('span', { class: 'mic' }, '🎤')), time);
  }
  return h('div', { class: `bubble ${c.from}` }, c.text, time);
}
function phone(chat, live) {
  const status = h('div', { class: 'wa-status' }, 'en línea');
  const typing = h('div', { class: 'typing' }, h('i'), h('i'), h('i'));
  const bubbles = (chat || []).map(bubble);
  const box = h('div', { class: 'wa-chat' }, bubbles, live ? typing : null);
  const el = h('div', { class: 'phone' },
    h('div', { class: 'wa-head' }, h('img', { src: '../favicon.svg', alt: '' }), h('div', null, h('div', { class: 'wa-name' }, 'Canix'), status)),
    box,
    h('div', { class: 'wa-input' }, h('span', null, 'Mensaje'), h('b', null, '🎤')));
  return { el, status, typing, bubbles, box };
}
// Shows the messages that already arrived at local time lt (they pop in) and the "escribiendo…" dots before Canix answers.
function animChat(p, chat, lt) {
  let typingOn = false;
  chat.forEach((c, i) => {
    const b = p.bubbles[i];
    const k = prog(lt, c.at, 0.35);
    b.style.display = lt >= c.at ? '' : 'none';
    css(b, { opacity: easeOut(k), transform: `scale(${0.85 + 0.15 * back(k)})` });
    if (c.typing !== undefined && lt >= c.typing && lt < c.at) typingOn = true;
  });
  p.typing.style.display = typingOn ? '' : 'none';
  [...p.typing.children].forEach((d, i) => { d.style.opacity = 0.35 + 0.65 * Math.abs(Math.sin(lt * 6 - i * 0.8)); });
  p.status.textContent = typingOn ? 'escribiendo…' : 'en línea';
}

// ---------- scenes: each returns {el, anim(localT, dur)} ----------
function hookScene(s) {
  const title = titleEl(s.text, false);
  const kicker = D.feature ? h('div', { class: 'kicker on-grad' }, `${D.feature.emoji} ${D.feature.name}`) : h('div', { class: 'kicker on-grad' }, '💬 Tu asistente en WhatsApp');
  const art = sticker(D.feature?.sticker || 'hola');
  const copy = h('div', { class: 'hook-copy on-grad' }, kicker, title);
  const el = h('div', { class: 'scene scene-hook' }, h('div', { class: 'grad' }), h('div', { class: 'hook-in' }, D.format === 'vertical' ? [art, copy] : [copy, art]));
  return { el, anim(lt) {
    animWords(title, lt, 0.2);
    css(kicker, { opacity: easeOut(prog(lt, 0.05, 0.4)) });
    const p = back(prog(lt, 0.1, 0.7));
    css(art, { transform: `translateY(${Math.sin(lt * 2.2) * 1.2}%) rotate(${(1 - p) * -14 + Math.sin(lt * 1.6) * 2}deg) scale(${0.6 + 0.4 * p})`, opacity: clamp(p * 1.5) });
  } };
}

function capBlock(s, kickerText) {
  const title = titleEl(s.text);
  const uline = h('div', { class: 'uline' });
  const kicker = kickerText ? h('div', { class: 'kicker' }, kickerText) : null;
  return { el: h('div', { class: 'cap' }, kicker, title, uline), title, uline, kicker };
}
function animCap(c, lt) {
  animWords(c.title, lt);
  c.uline.style.transform = `scaleX(${easeOut(prog(lt, 0.45, 0.5))})`;
  if (c.kicker) c.kicker.style.opacity = easeOut(prog(lt, 0, 0.4));
}

function chatScene(s) {
  const cap = capBlock(s, D.feature ? `${D.feature.emoji} ${D.feature.name}` : '💬 Así de fácil');
  const p = phone(s.chat, true);
  const el = h('div', { class: 'scene scene-chat' }, cap.el, p.el);
  return { el, anim(lt) {
    animCap(cap, lt);
    const k = easeOut(prog(lt, 0.05, 0.6));
    css(p.el, { opacity: k, transform: `translateY(${(1 - k) * 8}%) rotate(${(1 - k) * 3 + (D.format === 'vertical' ? 0 : 1.5)}deg)` });
    animChat(p, s.chat, lt);
  } };
}

function cardsScene(s, numbered) {
  const cap = capBlock(s, numbered ? '🧭 Cómo funciona' : '✨ Todo en un solo chat');
  const cards = (s.items || []).map((text, i) => {
    // "⏰ Recordatorios" → the emoji goes apart; a text without emoji keeps every word
    const m = String(text).match(/^([\p{Extended_Pictographic}\uFE0F\u200D]+)\s+(.*)$/u);
    const em = numbered ? h('span', { class: 'num' }, i + 1) : h('span', { class: 'em' }, m ? m[1] : '✨');
    return h('div', { class: 'card' }, em, m ? m[2] : text);
  });
  const grid = h('div', { class: 'cards' }, cards);
  const el = h('div', { class: `scene ${numbered ? 'scene-steps' : 'scene-features'}` }, cap.el, grid);
  return { el, anim(lt) {
    animCap(cap, lt);
    cards.forEach((c, i) => {
      const k = prog(lt, 0.4 + i * 0.28, 0.45);
      css(c, { opacity: easeOut(k), transform: `translateY(${(1 - easeOut(k)) * 40}px) scale(${0.9 + 0.1 * back(k)})` });
    });
  } };
}

function ctaScene(s) {
  const btn = h('div', { class: 'btn wa-btn' }, '💬 ', s.text || 'Pide tu demo gratis');
  const card = h('div', { class: 'cta-card' }, h('div', { class: 'big' }, 'Pruébalo gratis'), h('div', { class: 'note' }, 'Sin tarjeta · Por WhatsApp · Sin instalar nada'), btn);
  const art = sticker('vamos');
  css(art, { width: D.format === 'vertical' ? 'calc(var(--u) * 34)' : 'calc(var(--u) * 26)' });
  const el = h('div', { class: 'scene scene-cta' }, h('div', { class: 'grad' }), card, art);
  return { el, anim(lt) {
    const k = back(prog(lt, 0.05, 0.6));
    card.style.opacity = clamp(k * 1.4);
    card.style.transform = `${D.format === 'vertical' ? 'translateY(-50%)' : 'translate(-50%, -50%)'} scale(${0.85 + 0.15 * k})`;
    btn.style.transform = `scale(${1 + 0.04 * Math.sin(lt * 5)})`;
    const a = back(prog(lt, 0.4, 0.6));
    css(art, D.format === 'vertical'
      ? { left: '50%', bottom: 'calc(var(--u) * 26)', transform: `translateX(-50%) scale(${a}) rotate(${Math.sin(lt * 2) * 4}deg)` }
      : { right: 'calc(var(--u) * 12)', bottom: 'calc(var(--u) * 6)', transform: `scale(${a}) rotate(${Math.sin(lt * 2) * 4}deg)` });
  } };
}

function endScene(s) {
  const title = titleEl(s.text && s.text !== 'Canix' ? s.text : 'Tu asistente personal en WhatsApp', false);
  const logo = h('div', { class: 'mark on-grad' }, h('img', { src: '../favicon.svg', alt: '', style: 'width:calc(var(--u)*12);height:calc(var(--u)*12)' }), h('span', { style: 'font-size:calc(var(--u)*8)' }, 'Canix'));
  logo.style.position = 'relative';
  const url = h('div', { class: 'pill-url' }, `🌐 ${D.host}`);
  const art = sticker('listo');
  const copy = h('div', { class: 'on-grad', style: 'display:flex;flex-direction:column;gap:calc(var(--u)*3);align-items:' + (D.format === 'vertical' ? 'center' : 'flex-start') }, logo, title, url);
  const el = h('div', { class: 'scene scene-end' }, h('div', { class: 'grad' }), h('div', { class: 'end-in' }, D.format === 'vertical' ? [art, copy] : [copy, art]));
  return { el, anim(lt) {
    const k = back(prog(lt, 0.05, 0.6));
    css(logo, { transform: `scale(${0.7 + 0.3 * k})`, opacity: clamp(k * 1.4) });
    animWords(title, lt, 0.35);
    url.style.opacity = easeOut(prog(lt, 0.8, 0.4));
    const a = back(prog(lt, 0.3, 0.6));
    css(art, { transform: `scale(${a}) rotate(${Math.sin(lt * 1.8) * 3}deg) translateY(${Math.sin(lt * 2.4) * 1.5}%)` });
  } };
}

const BUILD = { hook: hookScene, chat: chatScene, features: (s) => cardsScene(s, false), steps: (s) => cardsScene(s, true), cta: ctaScene, end: endScene };

// Subtitles: the narration split into short chunks spread over its duration.
function chunks(s) {
  const ws = String(s.say || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = [];
  ws.forEach((w, i) => {
    cur.push(w);
    if (cur.length >= 7 || (cur.length >= 3 && /[.,;:!?]$/.test(w)) || i === ws.length - 1) { out.push(cur.join(' ')); cur = []; }
  });
  const total = out.reduce((a, c) => a + c.length, 0) || 1;
  let t = s.say_start;
  return out.map((text) => { const d = (text.length / total) * s.say_dur; const c = { text, from: t, to: t + d }; t += d; return c; });
}

function ready() {
  const imgs = [...stage.querySelectorAll('img')];
  return Promise.all([document.fonts.ready, document.fonts.load('900 80px Nunito'), document.fonts.load('600 40px Inter'),
    ...imgs.map((i) => (i.complete ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = r; i.onerror = r; })))]);
}
function setUnit() {
  document.documentElement.style.setProperty('--u', `${Math.min(innerWidth, innerHeight) / 100}px`);
}

// ---------- videos ----------
window.stageSetup = (data) => {
  D = data;
  window.stageReady = false;
  setUnit();
  stage.className = `f-${D.format}`;
  const glowA = h('div', { class: 'glow glow-a' }), glowB = h('div', { class: 'glow glow-b' });
  const progress = h('div', { class: 'progress' });
  const brand = mark(false);
  const subs = h('div', { class: 'subs' }, h('span'));
  parts = D.scenes.map((s) => ({ s, ...(BUILD[s.shot] || hookScene)(s), subs: chunks(s) }));
  stage.replaceChildren(h('div', { class: 'bg' }), glowA, glowB, ...parts.map((p) => p.el), brand, progress, subs);
  fixed = { glowA, glowB, progress, brand, subs };
  ready().then(() => {
    fitTitles(stage, (el) => (el.closest('.scene-hook, .scene-end') ? 2 : D.format === 'vertical' ? 2 : 3));
    window.stageAt(0);
    window.stageReady = true;
  });
};

window.stageAt = (t) => {
  const { glowA, glowB, progress, brand, subs } = fixed;
  css(glowA, { left: `${55 + Math.sin(t * 0.3) * 10}%`, top: `${-25 + Math.cos(t * 0.25) * 8}%` });
  css(glowB, { left: `${-30 + Math.cos(t * 0.27) * 8}%`, top: `${45 + Math.sin(t * 0.33) * 10}%` });
  progress.style.width = `${(t / D.total) * 100}%`;
  let current = null;
  parts.forEach((p) => {
    const lt = t - p.s.start;
    const visible = lt >= 0 && lt < p.s.dur;
    const o = visible ? Math.min(easeOut(prog(lt, 0, 0.35)), 1 - prog(lt, p.s.dur - 0.25, 0.25)) : 0;
    p.el.style.opacity = o;
    p.el.style.visibility = o > 0 ? 'visible' : 'hidden';
    if (visible) { p.anim(lt, p.s.dur); current = p; }
  });
  const full = current && ['hook', 'end', 'cta'].includes(current.s.shot);
  brand.style.opacity = full ? 0 : 1;
  const chunk = current?.subs.find((c) => t >= c.from && t < c.to + 0.15);
  subs.firstChild.textContent = chunk ? chunk.text : '';
  subs.style.opacity = chunk ? 1 : 0;
};

// ---------- images ----------
window.posterSetup = (data) => {
  D = data;
  window.stageReady = false;
  setUnit();
  const onGrad = D.layout !== 'features';
  stage.className = `poster f-${D.format} l-${D.layout}`;
  const kicker = h('div', { class: `kicker ${onGrad ? 'on-grad' : ''}` }, D.feature ? `${D.feature.emoji} ${D.feature.name}` : '💬 Tu asistente en WhatsApp');
  const copy = h('div', { class: `copy ${onGrad ? 'on-grad' : ''}` },
    kicker, titleEl(D.headline, !onGrad),
    D.sub ? h('p', { class: 'sub' }, D.sub) : null,
    D.layout === 'features' && D.bullets?.length ? h('ul', { class: 'bullets' }, D.bullets.map((b) => h('li', null, b))) : null,
    h('div', { class: `btn ${onGrad ? 'white' : ''}` }, D.cta || 'Pide tu demo gratis'));
  const visual = D.layout === 'mascot' ? sticker(D.feature?.sticker || 'hola') : phone(D.chat, false).el;
  stage.replaceChildren(
    onGrad ? h('div', { class: 'grad' }) : h('div', { class: 'bg' }),
    onGrad ? null : h('div', { class: 'glow glow-a', style: 'right:-30%;top:-30%' }), onGrad ? null : h('div', { class: 'glow glow-b', style: 'left:-35%;bottom:-35%' }),
    h('div', { class: 'progress', style: 'width:100%' }),
    mark(onGrad), copy, visual,
    h('div', { class: 'foot' }, h('span', { class: 'pill-url' }, `🌐 ${D.host}`)));
  ready().then(() => {
    // the copy shrinks (headline first, then the rest) until it fits its box
    const head = copy.querySelector('.title');
    let size = parseFloat(getComputedStyle(head).fontSize);
    const min = size * 0.5;
    let k = 1;
    while ((copy.scrollHeight > copy.clientHeight + 1 || head.scrollWidth > head.clientWidth + 1) && size > min) {
      size *= 0.94; k *= 0.97;
      head.style.fontSize = `${size}px`;
      copy.style.setProperty('--k', k);
    }
    window.stageReady = true;
  });
};
