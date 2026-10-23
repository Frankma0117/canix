# Operations

## Keeping the WhatsApp number healthy

Baileys is an unofficial client of WhatsApp Web, so there is always some risk of the number being
limited. The code enforces most of the precautions; the rest are operating habits.

**Enforced by the code**

1. **One instance only.** `data/canix.lock` refuses a second process on the same database, and
   `deploy.sh` kills strays before restarting. Two sockets on one session is a strong abuse signal.
2. **Conservative reconnection.** A few retries with exponential backoff, then it waits for a
   manual "Reconectar" in the portal. A **403** never auto-retries (it often precedes a ban); the
   portal shows "Posible bloqueo".
3. **Daily send caps** (`channels/whatsapp/send-guard.ts`, persisted in `wa_send_log`): proactive
   messages (`MAX_DAILY_PROACTIVE_MESSAGES`, default 300) and cold messages to people who never
   wrote to the bot (`MAX_DAILY_COLD_MESSAGES`, default 20). A newly linked number gets a warm-up
   ramp: 15% of the caps for 3 days, 40% until day 7, 70% until day 14. Live numbers in the portal.
4. **Cold-message spacing**: several cold sends in a row are refused if too close together.
5. **No one-way broadcast**: a recurring notice that goes unanswered twice in a row suspends itself
   and says so once; any message from the person resumes it.
6. **No backlog after downtime**: on boot, missed recurring reminders move to their next occurrence
   and missed one-off ones are marked `missed` - nothing is sent late in a burst.
7. **Human-like pacing**: a reading pause plus typing time before each reply; media one at a time.
8. **No proactive messages of its own**: the bot only sends what people scheduled (and the weekly
   report); announcements are an explicit admin action (`announce_update`).

**Operating habits**

- Use a number with real history, warm it up gradually, keep the phone with WhatsApp online now
  and then and check it still shows the linked device.
- Don't re-scan the QR without need (every new link replaces the previous one - churn is watched).
- Avoid link shorteners and low-reputation domains in messages the bot sends.
- Keep Baileys reasonably current (`npm outdated baileys` in `backend/`): an outdated protocol
  implementation is itself a signal.
- After a 403: wait, check the account in the phone app, then press "Reconectar" once.
- To switch to another number: portal → Conexión WhatsApp → "Usar otro número" (new QR; the old
  number just stops being linked to this bot).

## Daily housekeeping (automatic, silent)

| When | What |
| --- | --- |
| `DAILY_RESET_TIME` (04:00) | conversation history cleared per person (memory starts fresh each day) |
| `DAILY_DEDUP_TIME` (04:10) | duplicated routines/reminders/tasks merged |
| `WEEKLY_REPORT_DAY`/`TIME` | weekly report sent |
| boot | duplicate cleanup for everyone, missed-reminder reconciliation, routine repairs, IndexNow ping |
| continuous | wardrobe upkeep (colors, duplicate photos), vision reclassification queue |

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| Bot doesn't answer | `journalctl -u canix -f`: `[WA] Connection closed`, `[LOCK] Another Canix instance…`; portal → Conexión |
| Crash loop with `EACCES` | files owned by another user - `sudo chown -R canix:canix /opt/canix` (deploy.sh does it) |
| Duplicated replies | two instances: `pgrep -af src/index.ts` |
| Reminders not arriving | `[SCHEDULER] … held back` (send caps), `suspended` reminders, paused person (`paused_until`) |
| Garment photos not classified | `curl 127.0.0.1:8008/health`, `journalctl -u canix-vision -f`; manual flow still works |
| Calls stay "processing" | `PANEL_URL` must be public https so Twilio reaches `/webhooks/twilio/call-status` |
| Voice replies missing | `[TTS]` lines: Piper paths in `.env` (`deploy/ubuntu-04-setup-audio.sh` sets them) |

Logs are tagged by area: `[BOT] [WA] [LLM] [TOOL] [SCHEDULER] [FASHION] [PROMPT] [CHOICES] [AUTH]
[ACCESS] [CALLS] [TTS] [STT] [DEDUP] [SEO] [DEMO] [API]`.
