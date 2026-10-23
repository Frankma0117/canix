#!/usr/bin/env bash
# One-command deploy for Canix. Always run it from the root of the repo already cloned on the
# server (first time: `git clone ... /opt/canix && cd /opt/canix && ./deploy.sh`; afterwards the
# same `./deploy.sh` updates everything).
#
# Idempotent and non-destructive on purpose:
#   - Never touches .env, data/ or auth_info/ (all gitignored).
#   - If the server's checkout has uncommitted changes, it stops BEFORE `git pull` instead of
#     risking them - a deploy must never be able to lose work.
#   - Each step (Node, audio, vision) reuses the idempotent scripts in deploy/*.sh, which skip
#     whatever is already installed/downloaded - re-running never reinstalls from scratch.
#   - Detects which supervisor (pm2 or systemd) already runs the bot on THIS server and keeps it.
#
# Usage:
#   ./deploy.sh                 # EVERYTHING: code + deps + build + migrations + audio + vision + restart
#   ./deploy.sh --no-audio      # everything except local speech-to-text / text-to-speech (Vosk + Piper)
#   ./deploy.sh --no-vision     # everything except Fashion Mode's vision microservice (CLIP)
#   ./deploy.sh --minimal       # same as --no-audio --no-vision
#
# IMPORTANT: this deploys what is on GitHub (origin/<current branch>) - push your changes first.
#
# Run it as `sudo ./deploy.sh` (or without sudo: if the repo is not writable by your user it
# re-launches itself with sudo) - the repo belongs to the 'canix' service user and the restart
# needs root.
set -euo pipefail

# The whole script lives inside main(): bash reads it COMPLETELY before running anything, so even
# if git replaces this file mid-deploy, the running copy is not corrupted.
main() {

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SELF_HASH="$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)"

if [ "$(id -u)" -ne 0 ] && [ ! -w "$SCRIPT_DIR/.git" ]; then
  echo "The repo ($SCRIPT_DIR) is not writable by $(id -un) - re-launching with sudo."
  exec sudo "$0" "$@"
fi

# Files the bot writes at runtime that must NEVER be versioned (a manual commit on the server once
# included data/canix.lock and vision-service's __pycache__).
is_runtime_junk() { grep -qE '^(data/canix\.lock|.*__pycache__/.*|.*\.pyc)$'; }

WITH_AUDIO=true
WITH_VISION=true
VISION_FAILED=false
for arg in "$@"; do
  case "$arg" in
    --with-audio|--with-vision|--with-all|--all) : ;; # already the default, accepted for old aliases
    --no-audio) WITH_AUDIO=false ;;
    --no-vision) WITH_VISION=false ;;
    --minimal) WITH_AUDIO=false; WITH_VISION=false ;;
    -h|--help)
      sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (use --no-audio, --no-vision, --minimal, --help)"
      exit 1
      ;;
  esac
done

step() { echo ""; echo "==> $1"; }

# --- 1. Node.js 20+ ----------------------------------------------------------
step "Checking Node.js"
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 20 ]; then NODE_OK=true; fi
fi
if [ "$NODE_OK" = false ]; then
  echo "Node 20+ not found (or too old), installing..."
  ./deploy/ubuntu-01-setup-node.sh
else
  echo "OK: $(node -v)"
fi

# --- 2. Code -------------------------------------------------------------------
step "Updating code"
if [ -d .git ]; then
  # Git refuses to touch a repo whose owner differs from the current user ("dubious ownership"),
  # which happens here because some steps run under sudo. This path is the deploy target itself,
  # not untrusted input, so it is always safe to trust it.
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -xF "$SCRIPT_DIR" >/dev/null; then
    git config --global --add safe.directory "$SCRIPT_DIR"
  fi
  # "Dirty" runtime-only files (the bot's lock, Python caches) are discarded - nobody's work.
  # Any other uncommitted change stops the deploy.
  JUNK_DIRTY="$(git status --porcelain | awk '{print $2}' | while read -r f; do echo "$f" | is_runtime_junk && echo "$f"; done || true)"
  if [ -n "$JUNK_DIRTY" ]; then
    echo "Discarding runtime file changes: $(echo $JUNK_DIRTY)"
    echo "$JUNK_DIRTY" | xargs -r git checkout -- 2>/dev/null || true
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "There are uncommitted local changes in $SCRIPT_DIR - NOT updating the code so they are not"
    echo "lost. Check 'git status' there, keep or discard those changes, and run again:"
    echo "  ./deploy.sh $*"
    exit 1
  fi

  git fetch origin
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$(git rev-list "origin/$BRANCH..HEAD")" ]; then
    # Commits that only exist on the server. If they only touch runtime junk, the server is reset
    # to GitHub; if they carry real changes, they are merged so nothing is lost.
    LOCAL_ONLY_FILES="$(git diff --name-only "origin/$BRANCH...HEAD")"
    if [ -z "$(echo "$LOCAL_ONLY_FILES" | grep -v '^$' | while read -r f; do echo "$f" | is_runtime_junk || echo "$f"; done)" ]; then
      echo "The server had its own commits with runtime files only - aligning with origin/$BRANCH."
      git reset -q --hard "origin/$BRANCH"
    else
      echo "The server has its own commits with real changes - merging origin/$BRANCH:"
      echo "$LOCAL_ONLY_FILES" | sed 's/^/   /'
      git merge --no-edit "origin/$BRANCH"
    fi
  else
    git merge --ff-only "origin/$BRANCH"
  fi
  echo "Code at: $(git log --oneline -1)"
  # When this update brought a new version of this very script, re-launch it: bash reads the file
  # while running it, and continuing with the old version (or a mix) left half-done deploys.
  if [ "$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)" != "$SELF_HASH" ] && [ -z "${CANIX_DEPLOY_REEXEC:-}" ]; then
    echo "deploy.sh changed with this update - re-launching the new version."
    export CANIX_DEPLOY_REEXEC=1
    exec bash "$SCRIPT_DIR/deploy.sh" "$@"
  fi
else
  echo "$SCRIPT_DIR is not a git repo - skipping git pull (files uploaded via scp/rsync?)."
fi

# --- 3. Dependencies + build -----------------------------------------------------
step "Backend: dependencies"
(cd backend && npm ci)

step "Frontend: dependencies + build"
(cd frontend && npm ci && npm run build)

# Leftovers from the single-package layout (before backend/ and frontend/ existed): the old
# dependency folders and the old build folder of the public site. All untracked and regenerated
# above in their new places, so removing them is safe.
step "Removing leftovers from the previous layout"
for stale in node_modules admin-panel public/conoce; do
  if [ -e "$SCRIPT_DIR/$stale" ] && ! git ls-files --error-unmatch "$stale" >/dev/null 2>&1; then
    echo "Removing $stale"
    rm -rf "${SCRIPT_DIR:?}/$stale"
  fi
done

# --- 4. .env ---------------------------------------------------------------------
FIRST_ENV_SETUP=false
if [ ! -f .env ]; then
  step ".env does not exist, copying it from .env.example"
  cp .env.example .env
  FIRST_ENV_SETUP=true
fi

mkdir -p data

# --- 5. Database migrations -------------------------------------------------------
step "Applying database migrations"
(cd backend && npm run db:migrate)

# No pipes into `grep -q`: with `set -o pipefail`, grep -q closes the pipe on the first match, the
# left-hand command dies of SIGPIPE and the whole pipeline "fails" - that is how systemd was never
# detected and the deploy ended up restarting root's pm2 (2026-10).
has_pm2_cania() {
  command -v pm2 >/dev/null 2>&1 || return 1
  local list
  list="$(pm2 jlist 2>/dev/null || true)"
  [[ "$list" == *'"name":"cania"'* ]]
}
has_systemd_canix() { systemctl cat canix.service >/dev/null 2>&1; }
detect_supervisor() {
  # systemd wins when present: it runs as the 'canix' user (not root) and starts with the server.
  # Having a 'cania' in pm2 AS WELL is exactly what left two bots on the same WhatsApp session in
  # production (2026-10) - see step 7.9, which removes it from pm2.
  if has_systemd_canix; then
    echo "systemd"
  elif has_pm2_cania; then
    echo "pm2"
  else
    echo "none"
  fi
}
SUPERVISOR="$(detect_supervisor)"

# --- 6. Audio: transcription + voice (optional) ------------------------------------
if [ "$WITH_AUDIO" = true ]; then
  step "Local transcription/voice (Vosk + Piper)"
  ./deploy/ubuntu-04-setup-audio.sh
fi

# --- 7. Fashion Mode vision microservice (optional) -------------------------------
if [ "$WITH_VISION" = true ]; then
  step "Vision microservice (Fashion Mode)"
  # A separate, optional service: if its install fails, it is reported at the end but the bot is
  # still deployed and restarted.
  if ./deploy/ubuntu-05-setup-vision.sh && sudo ./deploy/ubuntu-06-setup-vision-service.sh; then
    VISION_FAILED=false
  else
    VISION_FAILED=true
    echo "WARNING: the vision microservice failed to install - continuing with the bot deploy."
  fi
fi

# --- 7.2 Recording browser for the admin's "Videos y publicidad" (optional) --------
# A failure here only leaves that section off (the portal says so); the bot is deployed anyway.
step "Recording browser (Videos y publicidad)"
bash ./deploy/ubuntu-10-setup-promo.sh || echo "WARNING: the recording browser failed to install - 'Videos y publicidad' stays off."

# --- 7.5 Ownership for the service user (systemd only) ----------------------------
# Under systemd the bot runs as the dedicated "canix" user, but everything above ran as whoever
# connected over SSH, so new files (data/canix.lock, data/*.db, node_modules) get ANOTHER owner and
# the service crash-loops on EACCES (happened on 2026-08-20). Re-applied on every deploy.
if [ "$SUPERVISOR" = "systemd" ] && id canix &>/dev/null && [ "$(id -un)" != "canix" ]; then
  step "Fixing ownership for the 'canix' service user"
  sudo chown -R canix:canix "$SCRIPT_DIR"
fi

# --- 7.9 A single instance ---------------------------------------------------------
# Two bots on the same WhatsApp session step on each other (duplicated messages, lost replies).
# Before restarting: stop the supervisor and kill any other bot process whose working directory is
# this repo (or its backend/ folder), whoever owns it.
step "Stopping bot instances (including manual/duplicated ones)"
case "$SUPERVISOR" in
  pm2) pm2 stop cania >/dev/null 2>&1 || true ;;
  systemd)
    sudo systemctl stop canix || true
    if has_pm2_cania; then
      echo "There was a 'cania' in pm2 besides the systemd service - removing it from pm2 (systemd only)."
      pm2 delete cania >/dev/null 2>&1 || true
      pm2 save >/dev/null 2>&1 || true
    fi
    ;;
esac
bot_pids() {
  for pid in $(pgrep -f 'src/index\.ts' || true); do
    [ "$pid" = "$$" ] && continue
    local cwd
    cwd="$(sudo readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$SCRIPT_DIR" ] || [ "$cwd" = "$SCRIPT_DIR/backend" ]; then echo "$pid"; fi
  done
}
STRAY="$(bot_pids | tr '\n' ' ')"
if [ -n "${STRAY// /}" ]; then
  echo "Stopping stray bot processes: $STRAY"
  sudo kill $STRAY 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(bot_pids)" ] && break; sleep 1; done
  STILL="$(bot_pids | tr '\n' ' ')"
  [ -n "${STILL// /}" ] && { echo "They ignored SIGTERM, forcing: $STILL"; sudo kill -9 $STILL 2>/dev/null || true; }
else
  echo "No stray instances."
fi
sudo rm -f "$SCRIPT_DIR/data/canix.lock"

# --- 8. (Re)start the bot - keeps whichever supervisor is in use ------------------
step "Restarting the bot"
case "$SUPERVISOR" in
  pm2)
    echo "pm2 detected (existing 'cania' process) - restarting with it."
    pm2 restart cania
    pm2 save
    ;;
  systemd)
    echo "systemd service 'canix' detected - restarting with it."
    sudo systemctl restart canix
    ;;
  none)
    echo "The bot is not running yet (neither pm2 nor systemd) - first start, using pm2"
    echo "(simplest to begin with; see docs/DEPLOYMENT.md to use systemd instead)."
    if ! command -v pm2 >/dev/null 2>&1; then
      sudo npm install -g pm2
    fi
    pm2 start ecosystem.config.cjs
    pm2 save
    ;;
esac

# --- 9. Status + recent logs ----------------------------------------------------------
step "Status"
if [ "$SUPERVISOR" = "systemd" ]; then
  sudo systemctl --no-pager status canix || true
else
  pm2 status || true
fi

step "Recent logs (the QR code shows up here the first time)"
if [ "$SUPERVISOR" = "systemd" ]; then
  sudo journalctl -u canix -n 25 --no-pager || true
else
  pm2 logs cania --lines 25 --nostream || true
fi

# --- 10. Final reminders ----------------------------------------------------------------
step "Done"
if [ "$FIRST_ENV_SETUP" = true ] || ! grep -q '^AI_API_KEY=.\+' .env 2>/dev/null; then
  echo "WARNING: fill in $SCRIPT_DIR/.env (above all AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL) and"
  echo "   run ./deploy.sh again so the new values are picked up."
fi
if [ "$SUPERVISOR" = "none" ]; then
  echo "To start the bot automatically when the server reboots, run ONCE and follow its"
  echo "instructions:  pm2 startup"
fi
if [ "$WITH_VISION" = true ] && ! grep -q '^FASHION_MODE_ENABLED=true' .env 2>/dev/null; then
  echo "The vision microservice is running, but Fashion Mode is still off - once the DigitalOcean"
  echo "Spaces credentials (DO_SPACES_*) are in .env, set FASHION_MODE_ENABLED=true and run"
  echo "./deploy.sh again to restart with the flag on."
fi
if [ "$VISION_FAILED" = true ]; then
  echo "WARNING: the vision microservice (Fashion Mode) did NOT install correctly - see the error above."
  echo "   Fashion Mode keeps working by asking to classify garments by hand. Run ./deploy.sh again"
  echo "   once it is fixed."
fi
if [ "$WITH_VISION" = false ]; then
  echo "Ran with --no-vision: Fashion Mode's automatic photo classification is not installed."
  echo "Run './deploy.sh' (no flags) whenever you want to add it."
fi
if ! grep -q '^TWILIO_ACCOUNT_SID=.\+' .env 2>/dev/null || ! grep -q '^TWILIO_AUTH_TOKEN=.\+' .env 2>/dev/null || ! grep -q '^TWILIO_PHONE_NUMBER=.\+' .env 2>/dev/null; then
  echo "WARNING: call reminders (Twilio) are not configured - fill in TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN"
  echo "   and TWILIO_PHONE_NUMBER in .env (console.twilio.com). Without them, schedule_call_reminder and"
  echo "   /api/call-reminders return an error instead of calling - the rest of the bot is unaffected."
fi
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }
if [ -z "$(env_val FISH_AUDIO_API_KEY)" ]; then
  echo "WARNING: FISH_AUDIO_API_KEY is empty - the natural voice (permission 'Voz natural (IA)') is off and"
  echo "   every voice note uses local Piper. Add FISH_AUDIO_API_KEY to .env (and optionally"
  echo "   FISH_AUDIO_VOICE_MALE / FISH_AUDIO_VOICE_FEMALE, see .env.example) and run ./deploy.sh again."
fi
PANEL_URL_VAL="$(env_val PANEL_URL)"
if [[ "$PANEL_URL_VAL" =~ ^https:// ]]; then
  # The natural-voice audio of calls and Twilio's status callbacks arrive through this URL: check
  # that THIS bot answers from the internet (its own 404 for a missing audio file), not an nginx 502
  # or some other service.
  PROBE="${PANEL_URL_VAL%/}/media/call-audio/000000000000000000000000000000000000000000000000.mp3"
  CODE=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$PROBE" || true)"
    [ "$CODE" = "404" ] && break
    sleep 5
  done
  if [ "$CODE" = "404" ]; then
    echo "OK: PANEL_URL ($PANEL_URL_VAL) reaches this bot - Twilio can download the natural-voice audio."
  else
    echo "WARNING: PANEL_URL ($PANEL_URL_VAL) did not answer as this bot (HTTP $CODE). Check nginx/DNS/SSL:"
    echo "   calls will use Twilio's voice and their status may stay at \"processing\"."
  fi
elif [ -n "$PANEL_URL_VAL" ]; then
  echo "WARNING: PANEL_URL ($PANEL_URL_VAL) is not https - Twilio needs https for natural voice in calls."
fi
if ! grep -q '^PANEL_URL=https\?://.\+' .env 2>/dev/null; then
  echo "WARNING: PANEL_URL does not point to a public URL - call reminders still work, but Twilio"
  echo "   cannot report each call's real status (they stay at \"processing\"). Set it in .env"
  echo "   (https://your-domain) so /webhooks/twilio/call-status is reachable."
fi
}

main "$@"
exit $?
