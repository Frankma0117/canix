#!/usr/bin/env bash
# Descarga y deja listo todo lo que canix necesita para transcribir notas de voz (Vosk) y
# responder con audio (Piper) - ambos locales, sin IA/tokens. Correr despues de
# ubuntu-02-deploy.sh (necesita /opt/canix ya instalado). Seguro de re-correr: si algo ya
# esta descargado, lo omite.
set -euo pipefail

# unzip no viene instalado por defecto en varias imagenes minimas de Ubuntu (curl casi siempre
# si, pero se revisa igual por si acaso).
missing_pkgs=""
command -v unzip >/dev/null 2>&1 || missing_pkgs="$missing_pkgs unzip"
command -v curl >/dev/null 2>&1 || missing_pkgs="$missing_pkgs curl"
if [ -n "$missing_pkgs" ]; then
  echo "== Instalando dependencias que faltan:$missing_pkgs =="
  sudo apt-get update
  sudo apt-get install -y $missing_pkgs
fi

APP_DIR="/opt/canix"
cd "$APP_DIR"

VOSK_MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"
VOSK_MODEL_DIR="$APP_DIR/models/vosk-es"

PIPER_VOICE="es_ES-davefx-medium"
PIPER_VOICE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium"
PIPER_DIR="$APP_DIR/bin/piper"

echo "== Modelo de Vosk (transcripcion de audios, espanol, ~40MB) =="
if [ -d "$VOSK_MODEL_DIR" ]; then
  echo "Ya existe $VOSK_MODEL_DIR, omito descarga."
else
  mkdir -p "$APP_DIR/models"
  curl -fL -o /tmp/vosk-es.zip "$VOSK_MODEL_URL"
  unzip -q /tmp/vosk-es.zip -d "$APP_DIR/models"
  rm /tmp/vosk-es.zip
  # el zip trae una carpeta con nombre versionado (vosk-model-small-es-0.42/) - normalizarla
  extracted="$(find "$APP_DIR/models" -maxdepth 1 -type d -name 'vosk-model-small-es-*' | head -1)"
  mv "$extracted" "$VOSK_MODEL_DIR"
  echo "Listo: $VOSK_MODEL_DIR"
fi

echo ""
echo "== Binario de Piper (respuesta por voz, ultima version, linux x64) =="
if [ -d "$PIPER_DIR" ]; then
  echo "Ya existe $PIPER_DIR, omito descarga."
else
  mkdir -p "$APP_DIR/bin"
  piper_asset_url="$(curl -fsSL https://api.github.com/repos/rhasspy/piper/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*piper_linux_x86_64\.tar\.gz"' \
    | grep -o 'https://[^"]*')"
  if [ -z "$piper_asset_url" ]; then
    echo "No pude resolver la URL de Piper automaticamente (revisa tu conexion o descargalo a mano"
    echo "de https://github.com/rhasspy/piper/releases y descomprimelo en $PIPER_DIR)."
  else
    curl -fL -o /tmp/piper.tar.gz "$piper_asset_url"
    tar -xzf /tmp/piper.tar.gz -C "$APP_DIR/bin"   # extrae directo a bin/piper/ (trae sus .so junto al binario, no lo muevas suelto)
    rm /tmp/piper.tar.gz
    echo "Listo: $PIPER_DIR/piper"
  fi
fi

echo ""
echo "== Voz en español de Piper ($PIPER_VOICE) =="
mkdir -p "$APP_DIR/models/piper-voices"
voice_path="$APP_DIR/models/piper-voices/$PIPER_VOICE.onnx"
if [ -f "$voice_path" ]; then
  echo "Ya existe la voz, omito descarga."
else
  curl -fL -o "$voice_path" "$PIPER_VOICE_URL_BASE/$PIPER_VOICE.onnx"
  curl -fL -o "$voice_path.json" "$PIPER_VOICE_URL_BASE/$PIPER_VOICE.onnx.json"
  echo "Listo: $voice_path"
fi

echo ""
echo "== Agrega esto a $APP_DIR/.env: =="
echo "VOSK_MODEL_PATH=$VOSK_MODEL_DIR"
echo "PIPER_BIN_PATH=$PIPER_DIR/piper"
echo "PIPER_VOICE_PATH=$voice_path"
echo ""
echo "Luego: sudo systemctl restart canix"
