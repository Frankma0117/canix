import './landing.css';

/**
 * Landing page behavior: theme, nav, scroll reveals, the free-demo form, and first-party
 * analytics (pageview + which sections people read + what they click) sent to /api/public/track.
 */

// ---------- theme (follows the device - the landing has no toggle) ----------
const media = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', media.matches);
applyTheme();
media.addEventListener('change', applyTheme);

// ---------- analytics ----------
function sessionId(): string {
  try {
    let s = sessionStorage.getItem('canix_s');
    if (!s) {
      s = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('canix_s', s);
    }
    return s;
  } catch {
    return 'na';
  }
}
const params = new URLSearchParams(location.search);
const base = {
  path: location.pathname,
  session: sessionId(),
  utm_source: params.get('utm_source') ?? undefined,
  utm_medium: params.get('utm_medium') ?? undefined,
  utm_campaign: params.get('utm_campaign') ?? undefined,
};

function track(type: string, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({ ...base, type, ...extra });
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.('/api/public/track', blob)) {
    fetch('/api/public/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}

track('pageview', { referrer: document.referrer || undefined });

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
  if (el) track('click', { label: el.dataset.track });
});

document.querySelectorAll<HTMLDetailsElement>('details[data-faq]').forEach((d) =>
  d.addEventListener('toggle', () => d.open && track('faq', { label: d.dataset.faq })),
);

// Sections actually read (half on screen) - once each per visit.
const seen = new Set<string>();
const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      const name = (en.target as HTMLElement).dataset.section!;
      if (en.isIntersecting && !seen.has(name)) {
        seen.add(name);
        track('section', { label: name });
      }
    }
  },
  { threshold: 0.45 },
);
document.querySelectorAll('[data-section]').forEach((s) => sectionObserver.observe(s));

// ---------- reveal on scroll ----------
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add('visible');
        revealObserver.unobserve(en.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
);
document.querySelectorAll('.reveal').forEach((el, i) => {
  (el as HTMLElement).style.transitionDelay = `${(i % 3) * 80}ms`;
  revealObserver.observe(el);
});

// ---------- nav ----------
const nav = document.querySelector<HTMLElement>('[data-nav]')!;
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 10);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const menu = document.querySelector<HTMLElement>('[data-menu]');
menuBtn?.addEventListener('click', () => {
  const open = menu!.classList.toggle('hidden') === false;
  menuBtn.setAttribute('aria-expanded', String(open));
  nav.classList.add('scrolled');
});
menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => menu.classList.add('hidden')));

// ---------- free demo ----------
const form = document.querySelector<HTMLFormElement>('[data-demo-form]');
const errorBox = document.querySelector<HTMLElement>('[data-demo-error]');
const submit = document.querySelector<HTMLButtonElement>('[data-demo-submit]');
const dialog = document.querySelector<HTMLDialogElement>('[data-demo-dialog]');

let startedForm = false;
form?.addEventListener('input', () => {
  if (!startedForm) {
    startedForm = true;
    track('demo_start');
  }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  errorBox!.classList.add('hidden');
  if (name.length < 2) {
    errorBox!.textContent = 'Escribe tu nombre para crear la demo.';
    errorBox!.classList.remove('hidden');
    return;
  }
  submit!.disabled = true;
  submit!.textContent = 'Creando tu demo…';
  try {
    const res = await fetch('/api/public/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, interest: data.get('interest') || undefined, website: data.get('website') || undefined }),
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; whatsappUrl?: string; botWhatsapp?: string; error?: string };
    if (!res.ok || !body.code) throw new Error(body.error ?? 'No pudimos crear la demo. Intenta de nuevo.');
    dialog!.querySelector('[data-demo-code]')!.textContent = body.code;
    dialog!.querySelector<HTMLAnchorElement>('[data-demo-whatsapp]')!.href = body.whatsappUrl!;
    dialog!.querySelector('[data-bot-number]')!.textContent = `+${body.botWhatsapp}`;
    dialog!.showModal();
    form.reset();
  } catch (err) {
    errorBox!.textContent = (err as Error).message;
    errorBox!.classList.remove('hidden');
  } finally {
    submit!.disabled = false;
    submit!.textContent = 'Crear mi demo gratis';
  }
});

dialog?.querySelector('[data-demo-whatsapp]')?.addEventListener('click', () => track('click', { label: 'demo_whatsapp' }));
dialog?.querySelector('[data-copy-code]')?.addEventListener('click', (e) => {
  navigator.clipboard?.writeText(dialog.querySelector('[data-demo-code]')!.textContent ?? '');
  (e.currentTarget as HTMLButtonElement).textContent = '¡Copiado!';
});
dialog?.querySelector('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (e) => e.target === dialog && dialog.close());
