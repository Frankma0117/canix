# Canix en Google y en todas partes: guía de posicionamiento

Lo técnico ya está en el código (ver "Qué hace el código"). Este documento es la lista de lo que
hay que hacer **fuera** del código, en orden de impacto. Marca cada casilla al terminarla.

---

## 0. Desplegar y configurar `.env` (10 min)

1. `git push` y en el servidor `sudo ./deploy.sh`.
2. En `/opt/canix/.env` completa (y `sudo systemctl restart canix`):

```env
LEGAL_NAME=Tu nombre o razón social          # responsable de datos (obligatorio por Ley 1581)
LEGAL_ID=C.C. 123... / NIT 900...            # recomendado
LEGAL_ADDRESS=Bogotá, Colombia
CONTACT_EMAIL=hola@tu-dominio                # canal para solicitudes de datos
INDEXNOW_KEY=<salida de: openssl rand -hex 16>
GOOGLE_SITE_VERIFICATION=                    # paso 1
BING_SITE_VERIFICATION=                      # paso 2 (opcional si importas desde Google)
SOCIAL_LINKS=https://instagram.com/...,https://tiktok.com/@...   # paso 4
FACEBOOK_DOMAIN_VERIFICATION=                # solo si vas a pautar en Meta
```

3. Comprueba: `https://canix.cania.app/sitemap.xml` (6 URLs), `/robots.txt`, `/llms.txt`,
   `/privacidad`, y que `/conoce` redirige a `/`.
4. Valida los datos estructurados en <https://search.google.com/test/rich-results> y
   <https://validator.schema.org> con cada URL del sitemap.
5. Velocidad: <https://pagespeed.web.dev> con la home en móvil (meta: verde en Core Web Vitals).

## 1. Google Search Console (lo más importante)

- [ ] Entra a <https://search.google.com/search-console> con tu cuenta de Google.
- [ ] **Opción recomendada – propiedad de dominio** `cania.app`: Google te da un registro TXT; créalo
      en Hostinger (DNS → TXT, nombre `@`). Cubre todos los subdominios y sobrevive a cambios.
      **Opción rápida – prefijo de URL** `https://canix.cania.app/` → método "Etiqueta HTML" → copia
      solo el valor de `content="..."` a `GOOGLE_SITE_VERIFICATION`, reinicia y pulsa Verificar.
- [ ] Sitemaps → envía `sitemap.xml`.
- [ ] Inspección de URL → pega cada una de las 4 páginas principales → "Solicitar indexación".
- [ ] En 1–2 semanas revisa "Páginas" (qué se indexó y por qué no) y "Rendimiento" (búsquedas reales).

## 2. Bing Webmaster Tools (alimenta Bing, ChatGPT Search, Copilot, DuckDuckGo y Yahoo)

- [ ] <https://www.bing.com/webmasters> → "Importar desde Google Search Console" (verifica solo).
- [ ] Con `INDEXNOW_KEY` configurado, cada vez que cambie el texto de una página el bot avisa solo a
      Bing/Yandex al arrancar (verás `[SEO] IndexNow: ...` en el log).

## 3. Perfil de Empresa en Google (Google Maps + panel a la derecha en búsquedas)

- [ ] <https://business.google.com> → "Negocio de servicio en una zona" (sin dirección pública).
- [ ] Nombre exacto **Canix**, categoría principal "Empresa de software" (o "Desarrollador de software"),
      zona: Colombia / tu ciudad, web `https://canix.cania.app`, WhatsApp de contacto.
- [ ] Verificación (suele ser por video). Sube logo (`logo-canix.png`), portada y fotos/stickers.
- [ ] Pide **reseñas reales** a tus primeros clientes: es el factor local más fuerte.
      *Nunca* inventes reseñas ni las marques en la web sin que existan.

## 4. Perfiles en redes (mismo nombre, mismo logo, misma descripción, mismo link)

- [ ] Instagram, TikTok, Facebook (página), LinkedIn (página de empresa), YouTube, X.
- [ ] Bio sugerida: *"Canix 🤖 Tu asistente personal con IA en WhatsApp: recordatorios, rutinas y
      agenda de citas. Pruébalo gratis 👇"*
- [ ] Link con UTM para medirlo en Analítica del panel:
      `https://canix.cania.app/?utm_source=instagram&utm_medium=bio`
- [ ] Pon todas las URLs en `SOCIAL_LINKS` → Google las asocia a la marca (sameAs).
- [ ] Contenido que funciona: videos cortos grabando la pantalla del chat ("le mandé un audio y me
      creó la rutina"), uno por función. Súbelos también a YouTube Shorts.

## 5. Directorios y marketplaces (enlaces + tráfico directo)

**Herramientas de IA** (gratis o casi): There's An AI For That, Futurepedia, Toolify.ai,
AI Tools Directory, TopAI.tools, Insidr AI tools, AIxploria (en español).

**Software / SaaS:** Product Hunt (prepara un lanzamiento un martes–jueves), AlternativeTo (como
alternativa a Todoist, Google Calendar, Calendly, Habitica), SaaSHub, Capterra / GetApp / Software
Advice (un solo registro gratuito en Gartner Digital Markets), G2, Crozdesk.

**Colombia / LatAm:** Páginas Amarillas, Cylex Colombia, Hotfrog, Infobel, el directorio de tu
cámara de comercio y los gremios/asociaciones de psicólogos y odontólogos
(los directorios de proveedores para profesionales de la salud son oro para la página de citas).

Regla: el mismo nombre, descripción y URL en todos (consistencia = confianza para Google).

## 6. Contenido: lo que más posiciona a mediano plazo

Ya existen páginas para las 3 búsquedas principales. Próximas páginas/artículos sugeridos (dime y
los construyo con la misma plantilla):

- "Cómo poner recordatorios en WhatsApp" (guía; gran volumen de búsqueda)
- "Agenda para psicólogos por WhatsApp" / "para odontólogos" / "para estéticas" (una por profesión)
- "Recordatorio de medicamentos por WhatsApp"
- "Alternativas a Calendly en español" / "Canix vs Google Calendar"
- "Cómo crear un hábito en 21 días con recordatorios"

Palabras clave objetivo: asistente virtual WhatsApp, asistente personal con IA, recordatorios por
WhatsApp, bot de WhatsApp para recordatorios, agenda de citas por WhatsApp, software para agendar
citas psicólogos, app de hábitos, recordatorio de medicamentos, chatbot WhatsApp Colombia.

## 7. Dominio propio (recomendado, mejor pronto que tarde)

`canix.cania.app` funciona, pero un dominio propio (`canix.co`, `canix.com.co`, `getcanix.com`…)
es más fácil de recordar, de compartir y de construir autoridad. Si lo compras, el cambio es:
DNS A → servidor, `sudo ./deploy/ubuntu-08-setup-landing.sh nuevo-dominio`,
`sudo ./deploy/ubuntu-09-unify-domain.sh canix.cania.app nuevo-dominio` (deja redirección 301) y en
Search Console usar "Cambio de dirección". Cuanto antes, menos autoridad se mueve.

## 8. Publicidad (resultados inmediatos mientras crece el orgánico)

- **Google Ads – Búsqueda:** campañas pequeñas a "agenda de citas por whatsapp", "software citas
  psicólogos", "recordatorios whatsapp", apuntando a la página correspondiente.
- **Meta Ads (Instagram/Facebook):** videos del chat; verifica el dominio con
  `FACEBOOK_DOMAIN_VERIFICATION` en Business Manager.
- Usa siempre `?utm_source=...&utm_medium=cpc&utm_campaign=...` para verlo en Analítica.

## 9. Medir y repetir (cada mes)

- Search Console → Rendimiento: búsquedas con muchas impresiones y pocos clics → mejora el título
  y la descripción de esa página.
- Panel de Canix → Analítica: visitas, secciones leídas, demos pedidas por fuente (utm).
- Sé realista: Google tarda de **semanas a 3–6 meses** en posicionar un sitio nuevo; los enlaces
  de directorios, las reseñas y el contenido nuevo aceleran el proceso.

---

## Qué hace el código (referencia)

- Sitio público multipágina: `admin-panel/conoce/<slug>/index.html` con encabezado/pie compartidos
  (`conoce/partials/`), servidos por `src/growth/site.ts`. **Página nueva = carpeta nueva + entrada
  en `SITE_PAGES`.**
- Por página: título y descripción únicos, canonical, Open Graph/Twitter, JSON-LD (Organization,
  WebSite, SoftwareApplication, WebPage, BreadcrumbList, Service, HowTo, FAQPage).
- `sitemap.xml` con `lastmod` que solo cambia cuando cambia el texto de la página
  (`data/site-pages.json`), `robots.txt`, `llms.txt` (para ChatGPT/Perplexity/Claude), IndexNow.
- Íconos completos (favicon.ico, SVG, apple-touch, manifest), logo PNG para Google, imagen OG
  optimizada (390 KB → 104 KB).
- `/conoce/*` → 301 a la URL canónica; barras finales → 301; `/app` y `/api` con
  `X-Robots-Tag: noindex`; 404 real con marca.
- Política de privacidad (Ley 1581/2012) y términos, enlazados desde el formulario de demo.
