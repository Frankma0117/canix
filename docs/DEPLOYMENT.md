# Deployment

Production runs on one Ubuntu server: the repo at `/opt/canix`, the bot as the systemd service
`canix` (user `canix`), the optional vision service as `canix-vision`, nginx with Let's Encrypt in
front. The process must run 24/7 (it holds the WhatsApp session and the scheduler).

## `./deploy.sh` - first install and every update

```bash
# first time
git clone https://github.com/Frankma0117/canix.git /opt/canix
cd /opt/canix && sudo ./deploy.sh

# every update (deploys what is pushed to GitHub - push first)
cd /opt/canix && sudo ./deploy.sh
```

It is idempotent and non-destructive: it never touches `.env`, `data/` or `auth_info/`, stops before
`git pull` if the server checkout has uncommitted changes, and re-launches itself when the update
brought a new version of the script. Steps:

1. Node 20+ (installs it if missing).
2. `git pull` (runtime junk like `data/canix.lock` is discarded; real local commits are merged).
3. `npm ci` in `backend/`; `npm ci && npm run build` in `frontend/` (builds into `/public`).
4. Removes leftovers of the old single-package layout (`node_modules/` and `admin-panel/` at the
   root, `public/conoce/`) when present.
5. Creates `.env` from `.env.example` on the first run.
6. `npm run db:migrate`.
7. Local speech (Vosk + Piper, `deploy/ubuntu-04-setup-audio.sh`) and the vision service
   (`ubuntu-05`/`06`); a failure there is reported but doesn't stop the deploy.
8. Fixes ownership for the `canix` user, stops every running bot instance (supervisor and strays
   whose working directory is the repo or `backend/`), and restarts with the supervisor already in
   use (systemd preferred, pm2 otherwise; pm2 on a first install).
9. Prints status, recent logs (the QR the first time) and warnings for missing configuration.

Flags: `--no-audio`, `--no-vision`, `--minimal`.

The supervisor runs `npm run start` at the repo root, which starts `backend/`. Runtime paths are
resolved from the repo root (`backend/src/config/paths.ts`), so `data/`, `auth_info/`, `models/`,
`bin/` and `.env` stay where they always were.

## One-time server setup

| Script | When |
| --- | --- |
| `deploy/ubuntu-01-setup-node.sh` | Node 20 + build tools (deploy.sh runs it when needed) |
| `deploy/ubuntu-03-setup-service.sh` | install `deploy/canix.service` (systemd) |
| `deploy/ubuntu-07-setup-nginx.sh <domain>` | nginx + HTTPS for the portal (needs the DNS A record) |
| `deploy/ubuntu-08-setup-landing.sh <subdomain>` | the public site on its own (sub)domain, sets `LANDING_URL` |
| `deploy/ubuntu-09-unify-domain.sh <old> <new> [--remove]` | move everything to one domain (old one redirects 301 or is removed) |

With one domain (`LANDING_URL` = `PANEL_URL`), the public site is at `/` and the portal at `/app`.

## Configuration

All settings are environment variables, documented in [`.env.example`](../.env.example) and read in
`backend/src/config/env.ts`. The minimum is the LLM (`AI_*`). Fashion Mode needs
`FASHION_MODE_ENABLED=true` plus DigitalOcean Spaces; calls need Twilio and a public https
`PANEL_URL`; the natural voice needs `FISH_AUDIO_API_KEY`. Restart after changing `.env`
(`sudo systemctl restart canix`).

## Vision service

```bash
deploy/ubuntu-05-setup-vision.sh                 # venv, dependencies, preloads the model, prints free RAM
sudo deploy/ubuntu-06-setup-vision-service.sh    # systemd unit canix-vision
curl http://127.0.0.1:8008/health                # {"ok":true,"model_ready":true}
```

Then `FASHION_MODE_ENABLED=true` and restart. Check RAM first - see [VISION_SERVICE.md](VISION_SERVICE.md).

## Useful commands

```bash
sudo systemctl status canix            # state
sudo journalctl -u canix -f            # live logs (QR, errors)
sudo systemctl restart canix
sudo journalctl -u canix-vision -f
```

## Production notes

- **State**: `data/` and `auth_info/` - back them up (see [DATABASE.md](DATABASE.md#backups)).
  Copying `auth_info/<WA_SESSION>` to another machine moves the WhatsApp link with it - never run
  both.
- **QR**: the first time, scan from the logs or from the portal (Administración → Conexión WhatsApp).
- **Never expose port 3000**: only nginx on 443.
- After this release's restructure the first deploy also removes the old root `node_modules/`;
  nothing else changes for the server.
