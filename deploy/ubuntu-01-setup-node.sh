#!/usr/bin/env bash
# Instala Node.js 20 LTS y las herramientas necesarias para compilar
# dependencias nativas (better-sqlite3). Correr una sola vez por servidor.
set -euo pipefail

echo "== Instalando dependencias del sistema =="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git build-essential python3

echo "== Instalando Node.js 20.x (NodeSource) =="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "== Version instalada =="
node -v
npm -v
