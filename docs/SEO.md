# Getting Canix found: SEO checklist

The technical part is in the code (see *What the code does*). This is the list of what has to be
done **outside** the code, in order of impact. Tick each box when done.

## 0. Deploy and configure `.env` (10 min)

1. `git push`, then on the server `sudo ./deploy.sh`.
2. In `/opt/canix/.env` (then `sudo systemctl restart canix`):

```env
LEGAL_NAME=Your name or company        # data controller (required by Colombia's Ley 1581)
LEGAL_ID=C.C. 123... / NIT 900...      # recommended
LEGAL_ADDRESS=Bogotá, Colombia
CONTACT_EMAIL=hola@your-domain         # channel for personal-data requests
INDEXNOW_KEY=<output of: openssl rand -hex 16>
GOOGLE_SITE_VERIFICATION=              # step 1
BING_SITE_VERIFICATION=                # step 2 (optional when importing from Google)
SOCIAL_LINKS=https://instagram.com/...,https://tiktok.com/@...   # step 4
FACEBOOK_DOMAIN_VERIFICATION=          # only for Meta ads
```

3. Check `https://canix.cania.app/sitemap.xml` (6 URLs), `/robots.txt`, `/llms.txt`, `/privacidad`,
   and that `/conoce` redirects to `/`.
4. Validate structured data at <https://search.google.com/test/rich-results> and
   <https://validator.schema.org> for every sitemap URL.
5. Speed: <https://pagespeed.web.dev> on mobile (goal: green Core Web Vitals).

## 1. Google Search Console (the most important)

- [ ] Open <https://search.google.com/search-console>.
- [ ] **Recommended - domain property** `cania.app`: create the TXT record Google gives you at the
      DNS provider (name `@`). Covers every subdomain and survives changes.
      **Quick - URL prefix** `https://canix.cania.app/` → "HTML tag" → copy only the `content="..."`
      value into `GOOGLE_SITE_VERIFICATION`, restart and press Verify.
- [ ] Sitemaps → submit `sitemap.xml`.
- [ ] URL inspection → each of the main pages → "Request indexing".
- [ ] After 1-2 weeks, check "Pages" (what was indexed and why not) and "Performance" (real queries).

## 2. Bing Webmaster Tools (feeds Bing, ChatGPT Search, Copilot, DuckDuckGo, Yahoo)

- [ ] <https://www.bing.com/webmasters> → "Import from Google Search Console".
- [ ] With `INDEXNOW_KEY` set, every time a page's text changes the bot notifies Bing/Yandex at boot
      (`[SEO] IndexNow: ...` in the log).

## 3. Google Business Profile (Maps + the panel next to results)

- [ ] <https://business.google.com> → "Service-area business" (no public address).
- [ ] Exact name **Canix**, main category "Software company", area Colombia / your city, website,
      WhatsApp contact.
- [ ] Verification (usually by video). Upload logo (`logo-canix.png`), cover and photos/stickers.
- [ ] Ask your first customers for **real reviews** - the strongest local factor. *Never* invent
      reviews or mark them up on the site without them existing.

## 4. Social profiles (same name, logo, description and link everywhere)

- [ ] Instagram, TikTok, Facebook page, LinkedIn company page, YouTube, X.
- [ ] Suggested bio: *"Canix 🤖 Tu asistente personal con IA en WhatsApp: recordatorios, rutinas y
      agenda de citas. Pruébalo gratis 👇"*
- [ ] Link with UTM, to see it in the portal's analytics:
      `https://canix.cania.app/?utm_source=instagram&utm_medium=bio`
- [ ] Put every profile URL in `SOCIAL_LINKS` (Google links them to the brand via `sameAs`).
- [ ] Content that works: short screen recordings of the chat, one per feature; also as YouTube Shorts.

## 5. Directories and marketplaces (links + direct traffic)

**AI tools:** There's An AI For That, Futurepedia, Toolify.ai, AI Tools Directory, TopAI.tools,
Insidr AI tools, AIxploria (Spanish).

**Software / SaaS:** Product Hunt (launch Tuesday-Thursday), AlternativeTo (as an alternative to
Todoist, Google Calendar, Calendly, Habitica), SaaSHub, Capterra / GetApp / Software Advice (one
Gartner Digital Markets listing), G2, Crozdesk.

**Colombia / LatAm:** Páginas Amarillas, Cylex Colombia, Hotfrog, Infobel, your chamber of commerce,
and associations of psychologists and dentists (provider directories for health professionals are
gold for the appointments page).

Rule: the same name, description and URL everywhere (consistency = trust).

## 6. Content - what ranks in the medium term

Pages already exist for the 3 main searches. Suggested next pages, built with the same template:

- "Cómo poner recordatorios en WhatsApp" (guide; high search volume)
- "Agenda para psicólogos por WhatsApp" / "para odontólogos" / "para estéticas" (one per profession)
- "Recordatorio de medicamentos por WhatsApp"
- "Alternativas a Calendly en español" / "Canix vs Google Calendar"
- "Cómo crear un hábito en 21 días con recordatorios"

Target keywords: asistente virtual WhatsApp, asistente personal con IA, recordatorios por WhatsApp,
bot de WhatsApp para recordatorios, agenda de citas por WhatsApp, software para agendar citas
psicólogos, app de hábitos, recordatorio de medicamentos, chatbot WhatsApp Colombia.

## 7. Own domain (better sooner than later)

`canix.cania.app` works, but an own domain (`canix.co`, `canix.com.co`, `getcanix.com`…) is easier to
remember and share and builds authority. The switch: DNS A → server,
`sudo ./deploy/ubuntu-08-setup-landing.sh new-domain`,
`sudo ./deploy/ubuntu-09-unify-domain.sh canix.cania.app new-domain` (leaves a 301 redirect), and
Search Console's "Change of address".

## 8. Ads (immediate results while organic grows)

- **Google Ads - Search:** small campaigns on "agenda de citas por whatsapp", "software citas
  psicólogos", "recordatorios whatsapp", each pointing at its page.
- **Meta Ads:** chat videos; verify the domain with `FACEBOOK_DOMAIN_VERIFICATION`.
- Always tag with `?utm_source=...&utm_medium=cpc&utm_campaign=...`.

## 9. Measure and repeat (monthly)

- Search Console → Performance: queries with many impressions and few clicks → improve that page's
  title and description.
- Canix portal → Analytics: visits, sections read, demos requested by source.
- Be realistic: Google takes **weeks to 3-6 months** to rank a new site; directory links, reviews
  and new content speed it up.

## What the code does (reference)

- Multi-page public site: `frontend/landing/<slug>/index.html` with shared header/footer
  (`landing/partials/`), served by `backend/src/services/growth/site.service.ts`. **New page = new
  folder + an entry in `SITE_PAGES`.**
- Per page: unique title and description, canonical, Open Graph/Twitter, JSON-LD (Organization,
  WebSite, SoftwareApplication, WebPage, BreadcrumbList, Service, HowTo, FAQPage).
- `sitemap.xml` whose `lastmod` only changes when the page text does (`data/site-pages.json`),
  `robots.txt`, `llms.txt` (for ChatGPT/Perplexity/Claude), IndexNow.
- Full icon set (favicon.ico, SVG, apple-touch, manifest), PNG logo, optimized OG image.
- `/conoce/*` → 301 to the canonical URL; trailing slashes → 301; `/app` and `/api` with
  `X-Robots-Tag: noindex`; a real branded 404.
- Privacy policy (Ley 1581/2012) and terms, linked from the demo form.
