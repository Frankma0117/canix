#!/usr/bin/env bash
# Downloads everything Canix needs to transcribe voice notes (Vosk) and answer with audio (Piper) -
# both local, no AI/tokens - and writes the 4 resulting variables straight into .env. Downloads TWO
# Piper voices (male default + female) so set_voice_gender ("quiero voz de mujer") works with no
# extra steps. Needs /opt/canix with a .env already created (the first ./deploy.sh does that).
# Safe to re-run: whatever is already downloaded (or already correct in .env) is skipped.
set -euo pipefail

# unzip is missing from several minimal Ubuntu images (curl is almost always there, checked anyway).
missing_pkgs=""
command -v unzip >/dev/null 2>&1 || missing_pkgs="$missing_pkgs unzip"
command -v curl >/dev/null 2>&1 || missing_pkgs="$missing_pkgs curl"
if [ -n "$missing_pkgs" ]; then
  echo "== Installing missing dependencies:$missing_pkgs =="
  sudo apt-get update
  sudo apt-get install -y $missing_pkgs
fi

APP_DIR="/opt/canix"
cd "$APP_DIR"

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE does not exist yet - run ./deploy.sh (no flags) first so it is created from"
  echo ".env.example. Without .env there is nowhere to write the audio variables."
  exit 1
fi

VOSK_MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
VOSK_MODEL_DIR="$APP_DIR/models/vosk-es"

PIPER_VOICE="es_ES-davefx-medium"
PIPER_VOICE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium"
# Female voice (Spanish, Argentina - the best rated female Spanish voice in Piper's catalog) for
# PIPER_VOICE_PATH_FEMALE. For another accent, swap these two variables for any other voice under
# https://huggingface.co/rhasspy/piper-voices (es/ folder) and run the script again.
PIPER_VOICE_FEMALE="es_AR-daniela-high"
PIPER_VOICE_FEMALE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high"
PIPER_DIR="$APP_DIR/bin/piper"

# Upserts KEY=VALUE in .env - replaces the line when it exists (earlier manual config, or a re-run
# of this script), appends it otherwise. '#' as the sed delimiter because values are file paths.
set_env_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

echo "== Vosk model (voice-note transcription, Spanish, ~40MB) =="
if [ -d "$VOSK_MODEL_DIR" ]; then
  echo "$VOSK_MODEL_DIR already exists, skipping download."
else
  mkdir -p "$APP_DIR/models"
  curl -fL -o /tmp/vosk-es.zip "$VOSK_MODEL_URL"
  unzip -q /tmp/vosk-es.zip -d "$APP_DIR/models"
  rm /tmp/vosk-es.zip
  # the zip holds a versioned folder (vosk-model-small-es-0.42/) - normalize its name
  extracted="$(find "$APP_DIR/models" -maxdepth 1 -type d -name 'vosk-model-small-es-*' | head -1)"
  mv "$extracted" "$VOSK_MODEL_DIR"
  echo "Done: $VOSK_MODEL_DIR"
fi
set_env_var VOSK_MODEL_PATH "$VOSK_MODEL_DIR"

echo ""
echo "== Piper binary (voice replies, latest release, linux x64) =="
piper_ok=false
if [ -d "$PIPER_DIR" ]; then
  echo "$PIPER_DIR already exists, skipping download."
  piper_ok=true
else
  mkdir -p "$APP_DIR/bin"
  piper_asset_url="$(curl -fsSL https://api.github.com/repos/rhasspy/piper/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*piper_linux_x86_64\.tar\.gz"' \
    | grep -o 'https://[^"]*')"
  if [ -z "$piper_asset_url" ]; then
    echo "Could not resolve Piper's URL automatically (check the connection, or download it by hand"
    echo "from https://github.com/rhasspy/piper/releases and extract it into $PIPER_DIR)."
  else
    curl -fL -o /tmp/piper.tar.gz "$piper_asset_url"
    tar -xzf /tmp/piper.tar.gz -C "$APP_DIR/bin"   # extracts to bin/piper/ (its .so files sit next to the binary - don't move it alone)
    rm /tmp/piper.tar.gz
    echo "Done: $PIPER_DIR/piper"
    piper_ok=true
  fi
fi
if [ "$piper_ok" = true ]; then
  set_env_var PIPER_BIN_PATH "$PIPER_DIR/piper"
fi

echo ""
echo "== Piper Spanish voice ($PIPER_VOICE) =="
mkdir -p "$APP_DIR/models/piper-voices"
voice_path="$APP_DIR/models/piper-voices/$PIPER_VOICE.onnx"
if [ -f "$voice_path" ]; then
  echo "Voice already present, skipping download."
else
  curl -fL -o "$voice_path" "$PIPER_VOICE_URL_BASE/$PIPER_VOICE.onnx"
  curl -fL -o "$voice_path.json" "$PIPER_VOICE_URL_BASE/$PIPER_VOICE.onnx.json"
  echo "Done: $voice_path"
fi
set_env_var PIPER_VOICE_PATH "$voice_path"

echo ""
echo "== Piper female voice ($PIPER_VOICE_FEMALE) =="
voice_female_path="$APP_DIR/models/piper-voices/$PIPER_VOICE_FEMALE.onnx"
if [ -f "$voice_female_path" ]; then
  echo "Voice already present, skipping download."
else
  curl -fL -o "$voice_female_path" "$PIPER_VOICE_FEMALE_URL_BASE/$PIPER_VOICE_FEMALE.onnx"
  curl -fL -o "$voice_female_path.json" "$PIPER_VOICE_FEMALE_URL_BASE/$PIPER_VOICE_FEMALE.onnx.json"
  echo "Done: $voice_female_path"
fi
set_env_var PIPER_VOICE_PATH_FEMALE "$voice_female_path"

echo ""
echo "== .env updated (VOSK_MODEL_PATH, PIPER_BIN_PATH$([ "$piper_ok" = true ] || echo ' [skipped, see above]'), PIPER_VOICE_PATH, PIPER_VOICE_PATH_FEMALE) =="
if [ "$piper_ok" = true ]; then
  echo "All set, with the male (default) and female voices ready. Restart the bot so it picks up"
  echo "the new values:"
  echo "  sudo systemctl restart canix   # or: pm2 restart cania"
  echo ""
  echo "Each user picks their voice by telling the bot something like \"quiero que me hables con voz"
  echo "de mujer\" (set_voice_gender tool) - no need to touch .env again for that."
else
  echo "The Piper binary is missing (see above) - once it is in $PIPER_DIR, run this script again so"
  echo "it writes PIPER_BIN_PATH, then restart the bot."
fi
