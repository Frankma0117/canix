#!/usr/bin/env bash
# Installs Node.js 20 LTS and the toolchain needed to compile native dependencies
# (better-sqlite3). Run once per server.
set -euo pipefail

echo "== Installing system dependencies =="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git build-essential python3 unzip

echo "== Installing Node.js 20.x (NodeSource) =="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "== Installed versions =="
node -v
npm -v
