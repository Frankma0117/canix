# Features

What each module does for the person using it. Example phrases are Spanish because that is how
people talk to Canix; everything works in free wording - the examples are not commands.

## Talking to Canix

- Text or **voice notes** (transcribed locally with Vosk; the answer comes back as a voice note).
- **Fixed commands** (answered without the model): `/menu`, `/menu <sección>`, `/ayuda`,
  `/reset` (clears the conversation), `/reset todo` (deletes all the person's data, asks to
  confirm), `/reset outfit`.
- **Closed questions** show 👍/👎 or numbered options under the message: reacting or answering with
  the number counts as the answer.
- **Sections** ("rutinas", "notas", "comidas"…) only show what can be done there - nothing is
  locked inside a section.
- The assistant never shows internal numbers; items are referred to by name.

## Reminders

- One-off and recurring: "recuérdame llamar al dentista mañana a las 10", "todos los lunes a las 8am".
- **Important dates** with advance notice: "el cumpleaños de mi mamá es el 12 de marzo, avísame 3 días antes".
- **Flexible windows** (a random time each day inside the window): "estirar entre 3 y 5pm".
- **Intervals**: "cada 20 minutos durante 2 horas, tomar agua".
- **Free slot**: "en algún momento revisar el carro" - scheduled in a free gap of the agenda.
- Sent to the person or to a saved contact; pause/resume one reminder or all notifications.
- Own reminders are confirmed with 👍 (done) / 👎 (not done) on the notice; answers are kept with
  their time ("marcado 2 h después del aviso").
- **Phone-call reminders and alarms** (paid extra, Twilio): "llámame mañana a las 6 para despertarme".

## Routines and habits

- Every routine has a time, a duration and a schedule: daily, certain weekdays, every N days/weeks,
  monthly on a day. "Crea una rutina de cardio lunes y jueves a las 6am, 40 minutos".
- One notice at its time, confirmed with a reaction; streak and weekly progress inside the notice.
- Exercises per routine (sets, reps, weight); moving today's occurrence; pause/resume.
- **Rewards and punishments** tied to a routine for the week, shown in the agenda and the weekly report.
- Daily **agenda** on request ("¿qué tengo hoy / mañana / el viernes?"), a good-night message after
  finishing the day's last item, and an automatic **weekly report**.

## To-dos and lists

- To-dos for today or for later, with categories and an optional link.
- **Lists** ticked off item by item (shopping, ideas…); "pásamela para copiar" gives plain text.

## Media library (movies, series, music, books, games, podcasts)

- "Guarda Interstellar en mis películas", "agrega esta canción de Bad Bunny a mi música para entrenar".
- Send a **link** and say what it is - "este link es una película sobre viajes en el tiempo": it is
  saved in the link library (category "Películas") **and** in the movies list, with its summary.
- "¿Qué película puedo ver?" - suggestions only from what is still unwatched, each with its
  summary, link and any note that mentions it. Also "series que ya vi", "mi música por género",
  "libros de García Márquez".
- Mark as seen/listened/read, rate 1-5, add notes, move between lists, delete.
- Portal: one table for the whole library, grouped by list, genre, author/artist, kind or status,
  with search, ratings and links.

## Notes

- "Anota que el aceite del carro es 5W-30 y se cambia cada 5.000 km" - saved as short key points.
- Search by text or category. Portal: table grouped by category or month.
- Notes that mention a library item show up next to it.

## Links and categories

- A link without a kind: Canix shows the existing categories, asks which one and a short description
  (it never invents categories). "Dame algo de ejercicio" picks one at random.
- Categories are shared by links, notes, reminders, to-dos and recipes.

## Meals and recipes

- Meal plan by day and slot (desayuno, onces, almuerzo, media tarde, cena).
- A meal with a time ("almuerzo a la 1pm", or "avísame" for the usual hour) sends "🍽️ Hora del
  almuerzo" at that time; with `prep_minutes` ("avísame 30 min antes para prepararlo") also
  "👩‍🍳 Toca preparar…". Editing or deleting the plan updates or removes its notices. Same from the
  portal (Comidas: click a meal to edit, "Avisarme a la hora").
- "Tengo pollo, papa y cebolla, ¿qué almuerzo?" - recipes from the ingredients, saved to the
  recipe book and optionally planned; saved recipes and food links are offered first.

## Medicamentos y belleza

- Its own module (permission `medications.manage`): medicines, vitamins, supplements, creams,
  skincare. Each has times (fixed, or "cada 8 horas desde las 6am"), optional weekdays, dose,
  instructions and a treatment length ("por 7 días" -> end date).
- At each time Canix sends "💊 Toca tomar *Vitamina D*" and the person answers 👍/👎 (or says "ya me
  la tomé"; or "Tomada hoy" in the portal). Answers feed a 7-day count shown on WhatsApp ("qué
  medicamentos tengo") and in the portal.
- **Tomar agua** (kind `water`): "recuérdame tomar agua cada 2 horas de 8am a 8pm" -> 💧 Agua with
  seven notice times = a goal of seven glasses. Each 👍 to the notice, "ya me tomé un vaso" or
  "+1 vaso" in the portal counts one; notices, the list, "Tu día" and the portal show "Vas 3 de 7".
  Old daily "tomar agua" reminders are merged into it once on boot.
- **Cuidado corporal** (kind `bodycare`): faja, medias de compresión, retenedor... named by the
  action so the notice reads "🩱 Toca ponerte la faja"; putting it on and taking it off are two
  items with their own times, "cada cierto tiempo" uses every_hours.
- Pause / resume ("pausa la crema"), change times or dose, delete. Doses appear in "Tu día", the
  model's agenda context and the portal calendar.
- Before this module they were plain reminders in the category "Medicamentos y belleza": on boot
  they are moved once into the module (same times, nothing sent twice), and whoever had
  `reminders.manage` gets `medications.manage`.

## Contacts and messages

- Save contacts (also from a shared WhatsApp contact card) and send messages on the person's behalf.
- Cold messages (to someone who never wrote to the bot) are capped and spaced.

## Fashion Mode (wardrobe and outfits)

- Add garments with a **photo** (or a **PDF** with many photos). A local CLIP model or a vision LLM
  classifies type, category, colors, pattern, material, fit, style, formality…; what it is unsure
  about becomes a question in the portal ("Por revisar"). Without vision, garments are classified
  by hand with numbered options.
- Browse: "mi armario", "armario camisas blancas", favorites; mark garments as worn this week (they
  step out of suggestions until Monday).
- **Outfits** in any wording: "outfit para una boda formal con blazer azul, sin corbata",
  "un outfit con polo azul" (built around that polo), "uno que no tenga camiseta blanca" (no white top).
- Each outfit arrives as **one photo per garment, then the summary**:

  | React on a garment photo | Effect |
  | --- | --- |
  | 👎 | change only that garment, the rest stays |
  | ❤️ | build another outfit around that garment (the other pieces change) |
  | 🗑️ | it's no longer in the wardrobe - asks 👍/👎, deletes it and replaces it in the outfit |
  | 👍 | keep it fixed for "otra opción" |

  | React on the summary | Effect |
  | --- | --- |
  | 👍 | save the outfit |
  | 👎 | another option |
  | 👕 | "me lo puse" (worn this week) |

  The same in words: "cambia la camiseta", "otros zapatos", "deja solo el pantalón", "arma otro con
  la chaqueta", "ya no tengo esos tenis", "sin chaqueta", "más formal". Numbers still work
  (1 save · 2 another option · 3 back · 4 worn). Reactions work on old outfit messages too.
- Saved outfits ("mis outfits") open with their photos and accept the same reactions.
- A styling profile (preferred/avoided colors and styles, size) shapes the suggestions.

## Scheduling (appointments)

- **Professional**: weekly availability, time off, slot length, buffer, notice, reminders, auto
  confirm; calendar by week/month; confirm/reject/cancel/complete; shares booking with clients by
  number (the bot writes to them).
- **Client**: sees only free slots of their professionals, requests (pending until confirmed),
  cancels; gets a neutral booking assistant instead of the owner's personal one.
- Reminders the morning of the appointment and optionally N hours before; unconfirmed requests
  expire. Admin groups give a combined calendar.

## Portal

Sign in with the WhatsApp number and a password (sent by WhatsApp, never through the model). Each
person sees only their data and enabled modules. Sections: Inicio, **Calendario** (the whole agenda
hour by hour - routines with what was done, reminders, to-dos with dates, meals, medication doses,
calls, appointments - by week or day), Hoy, Para después, Listas, Recordatorios, Llamadas, Rutinas, Premios,
Comidas, **Medicamentos y belleza**, Recetas, Notas, **Biblioteca**, Links, Categorías, Contactos, Mi armario, agenda, cuenta.

The administrator also has: people and access (packages + allow/deny), access matrix, packages,
audit trail, usage and costs, web analytics, test mode (try WhatsApp with a reduced permission
set), scheduling groups, and the WhatsApp connection (QR, reconnect, switch number).

### Videos y publicidad (administrator only)

Advertising material for social media, made from the portal and reviewed before use
(`services/promo/`, table `promo_items`):

- **Videos** (vertical and horizontal): an ad, how Canix works, or one feature. The text model writes
  the script following `promo-copy.ts` (only the real facts of `promo-catalog.ts`; a fixed template
  without AI), Fish Audio narrates every scene with ONE voice chosen for all the videos, with
  subtitles, soft "sent/received" sounds on the chats and optional background music generated once
  with fal.ai. Typical length 25-55 s.
- **Images** (square, story, horizontal) in three designs: with a chat, with three benefits, with
  the mascot; 1-3 per request with different headlines. The texts can be corrected and the image is
  drawn again without AI.
- What is drawn: WhatsApp chats (typing dots, voice notes, blue ticks), the mascot's stickers, the
  feature cards and the brand gradient - `frontend/public/promo/stage.*`, opened from disk.
- Recording runs ONE at a time in a child process with low CPU priority (`promo-worker.ts`), so the
  bot never slows down; a restart resumes what was half-made. Files go to Spaces under
  `canix-promo/<id>/` (public-read) or `data/promo/` when Spaces isn't set.
- Costs land in "Uso y costos" (`voice.fish.promo`, `promo.text`).

## Multi-user and permissions

- The first sender is the administrator. Access is granted by the admin ("dale acceso a
  573001234567 como Juan") or from the portal; revoking deletes that person's data.
- Every feature is a permission; permissions are grouped in packages; per-person allow/deny
  overrides win (deny over allow). **Paid extras** (calls, natural voice) are granted one person at
  a time, never through packages, and their usage is logged per person.
- Free **demos** from the public site: the visitor sends a code by WhatsApp and gets the demo
  package for `DEMO_HOURS`.

## Voice

- Voice replies with Piper (local, male/female) or, for the paid permission, a natural voice from
  Fish Audio chosen among several.
