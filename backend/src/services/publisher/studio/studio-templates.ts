import { FONTS, type Design, type FormatSpec, type Identity } from './studio.types.js';

/**
 * The layouts: pure functions from (texts, identity, art, logo) to one HTML page that the
 * headless browser photographs (studio-compose.ts). Every text goes through esc(); the headline
 * and the points shrink until they fit their box (data-fit), so no word is ever cut off.
 */
const esc = (s: string | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#4B5CF6');

export interface RenderInput {
  design: Design;
  spec: FormatSpec;
  identity: Identity;
  brandName: string;
  /** data: URLs */
  art: string | null;
  logo: string | null;
}

function base(i: RenderInput, body: string, extraCss = ''): string {
  const f = FONTS[i.identity.font] ?? FONTS.modern;
  const c = i.identity.colors;
  const { width: w, height: h } = i.spec;
  const u = Math.min(w, h) / 1080; // every size is relative to the short side, so all formats keep their proportions
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.google}&display=swap">
<style>
:root{--p:${hex(c.primary)};--s:${hex(c.secondary)};--a:${hex(c.accent)};--d:${hex(c.dark)};--l:${hex(c.light)};--u:${u}px;--fw:${f.weight}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:${f.stack};color:var(--l);-webkit-font-smoothing:antialiased;position:relative;background:var(--d)}
.art{position:absolute;inset:0;background-size:cover;background-position:center}
.h{font-weight:var(--fw);line-height:1.04;letter-spacing:-0.02em;overflow:hidden}
.sub{font-weight:500;line-height:1.3;opacity:.92;overflow:hidden}
.cta{display:inline-block;background:var(--a);color:var(--d);font-weight:700;border-radius:999px;padding:calc(var(--u)*18) calc(var(--u)*40);font-size:calc(var(--u)*34)}
.logo{display:flex;align-items:center;gap:calc(var(--u)*16);font-weight:800;font-size:calc(var(--u)*38)}
.logo img{height:calc(var(--u)*78);width:auto;border-radius:calc(var(--u)*16)}
${extraCss}
</style></head><body>${body}
<script>
function fit(){document.querySelectorAll('[data-fit]').forEach(function(el){var s=parseFloat(getComputedStyle(el).fontSize),n=0;while((el.scrollHeight>el.clientHeight+s*0.3||el.scrollWidth>el.clientWidth+1)&&s>14&&n++<60){s*=0.95;el.style.fontSize=s+"px"}})}
(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){fit();window.designReady=true});setTimeout(function(){fit();window.designReady=true},9000);
</script></body></html>`;
}

const logoBlock = (i: RenderInput) => (i.logo ? `<div class="logo"><img src="${i.logo}" alt=""></div>` : i.brandName ? `<div class="logo">${esc(i.brandName)}</div>` : '');
const artStyle = (i: RenderInput) => (i.art ? `style="background-image:url('${i.art}')"` : `style="background:linear-gradient(135deg,var(--p),var(--d))"`);

export function renderHtml(i: RenderInput): string {
  const { layout } = i.design;
  const c = i.design.content;
  const { width: w, height: h } = i.spec;
  const wide = w > h * 1.15;
  const pad = 'calc(var(--u)*72)';
  const headline = esc(c.headline || i.design.title);

  if (i.design.kind === 'profile') {
    // Profile picture: the logo (or the name) centered inside the circle-safe area, on the brand color.
    const inner = i.logo ? `<img src="${i.logo}" style="width:62%;height:62%;object-fit:contain;border-radius:12%">` : `<div class="h" style="font-size:calc(var(--u)*${Math.max(120, 300 - (i.brandName.length || 1) * 12)})">${esc((i.brandName || 'A').slice(0, 2).toUpperCase())}</div>`;
    return base(i, `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,var(--p),var(--d))">${inner}</div>`);
  }

  if (layout === 'mark') {
    // Logo: the painted symbol in a rounded square, the name under it.
    return base(
      i,
      `<div style="position:absolute;inset:0;background:var(--p);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--u)*34)">
        <div style="position:relative;width:68%;aspect-ratio:1;border-radius:22%;background-size:cover;background-position:center;${i.art ? `background-image:url('${i.art}')` : 'background:linear-gradient(135deg,var(--a),var(--d))'};box-shadow:0 calc(var(--u)*24) calc(var(--u)*60) rgba(0,0,0,.28)"></div>
        <div class="h" style="font-size:calc(var(--u)*92);max-width:84%;text-align:center;max-height:calc(var(--u)*130)" data-fit>${esc(i.brandName || c.headline)}</div>
      </div>`,
    );
  }

  if (layout === 'banner') {
    // Cover: the safe area (what every device shows) holds the name and the tagline.
    const sw = i.spec.safe?.w ?? 0.8;
    const sh = i.spec.safe?.h ?? 0.8;
    return base(
      i,
      `<div class="art" ${artStyle(i)}></div>
       <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,.05) 70%)"></div>
       <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${sw * 100}%;height:${sh * 100}%;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*20)">
         <div class="h" style="font-size:calc(var(--u)*130);max-height:62%" data-fit>${headline}</div>
         ${c.sub ? `<div class="sub" style="font-size:calc(var(--u)*46);max-height:30%" data-fit>${esc(c.sub)}</div>` : ''}
       </div>`,
    );
  }

  if (layout === 'hero') {
    return base(
      i,
      `<div class="art" ${artStyle(i)}></div>
       <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 28%,rgba(0,0,0,.2) 45%,rgba(0,0,0,.82) 100%)"></div>
       <div style="position:absolute;left:${pad};top:${pad}">${logoBlock(i)}</div>
       <div style="position:absolute;left:${pad};right:${pad};bottom:${pad};display:flex;flex-direction:column;gap:calc(var(--u)*26)">
         <div style="width:calc(var(--u)*96);height:calc(var(--u)*10);border-radius:99px;background:var(--a)"></div>
         <div class="h" style="font-size:calc(var(--u)*${wide ? 96 : 112});max-height:${wide ? '45%' : 'calc(var(--u)*430)'}" data-fit>${headline}</div>
         ${c.sub ? `<div class="sub" style="font-size:calc(var(--u)*42);max-height:calc(var(--u)*130)" data-fit>${esc(c.sub)}</div>` : ''}
         ${c.cta ? `<div><span class="cta">${esc(c.cta)}</span></div>` : ''}
       </div>`,
    );
  }

  if (layout === 'split') {
    const row = wide;
    return base(
      i,
      `<div style="position:absolute;inset:0;display:flex;flex-direction:${row ? 'row' : 'column'}">
         <div style="flex:${row ? '1' : '1.05'};position:relative"><div class="art" ${artStyle(i)}></div></div>
         <div style="flex:${row ? '1' : '1'};background:var(--p);padding:${pad};display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*24);position:relative">
           <div style="position:absolute;${row ? 'top' : 'right'}:calc(var(--u)*40);${row ? 'right' : 'top'}:calc(var(--u)*40)">${logoBlock(i)}</div>
           <div class="h" style="font-size:calc(var(--u)*92);max-height:${row ? '50%' : 'calc(var(--u)*300)'}" data-fit>${headline}</div>
           ${c.sub ? `<div class="sub" style="font-size:calc(var(--u)*40);max-height:calc(var(--u)*130)" data-fit>${esc(c.sub)}</div>` : ''}
           ${c.cta ? `<div><span class="cta">${esc(c.cta)}</span></div>` : ''}
         </div>
       </div>`,
    );
  }

  if (layout === 'tip') {
    const bullets = (c.bullets ?? []).slice(0, 4);
    return base(
      i,
      `<div style="position:absolute;inset:0;background:linear-gradient(155deg,var(--p) 0%,var(--d) 100%);padding:${pad};display:flex;flex-direction:column;gap:calc(var(--u)*34)">
         <div>${logoBlock(i)}</div>
         <div class="h" style="font-size:calc(var(--u)*100);flex:0 0 auto;max-height:calc(var(--u)*${h > w ? 340 : 230})" data-fit>${headline}</div>
         <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*22);min-height:0">
           ${bullets.map((b, n) => `<div style="display:flex;align-items:center;gap:calc(var(--u)*24);background:rgba(255,255,255,.12);border-radius:calc(var(--u)*28);padding:calc(var(--u)*34);flex:0 1 auto;min-height:0"><div style="flex:0 0 calc(var(--u)*72);height:calc(var(--u)*72);border-radius:50%;background:var(--a);color:var(--d);font-weight:800;font-size:calc(var(--u)*40);display:flex;align-items:center;justify-content:center">${n + 1}</div><div class="sub" style="font-size:calc(var(--u)*44);font-weight:600;max-height:100%" data-fit>${esc(b)}</div></div>`).join('')}
         </div>
         ${c.cta ? `<div><span class="cta">${esc(c.cta)}</span></div>` : ''}
       </div>`,
    );
  }

  // quote
  return base(
    i,
    `<div style="position:absolute;inset:0;background:var(--s);color:var(--d);padding:${pad};display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*30)">
       <div style="position:absolute;top:calc(var(--u)*-60);left:calc(var(--u)*40);font-size:calc(var(--u)*620);line-height:1;color:var(--a);opacity:.35;font-weight:900">“</div>
       <div class="h" style="font-size:calc(var(--u)*104);color:var(--d);max-height:${h > w ? '56%' : '60%'};position:relative" data-fit>${headline}</div>
       ${c.sub ? `<div class="sub" style="font-size:calc(var(--u)*42);color:var(--p);max-height:calc(var(--u)*130);position:relative" data-fit>${esc(c.sub)}</div>` : ''}
       <div style="position:absolute;left:${pad};bottom:${pad};color:var(--p)">${i.logo ? `<div class="logo"><img src="${i.logo}" alt=""></div>` : `<div class="logo" style="color:var(--p)">${esc(i.brandName)}</div>`}</div>
       ${c.cta ? `<div style="position:absolute;right:${pad};bottom:${pad}"><span class="cta" style="background:var(--p);color:var(--l)">${esc(c.cta)}</span></div>` : ''}
     </div>`,
  );
}
