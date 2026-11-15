#!/bin/sh
# Loads the PC's cache (deploy/out/arcnave-cache.tar, made by deploy/pack-cache.ps1) into the server's cache volume, once.
# Files the server already has are kept. Run on the server, in ~/arcnave/deploy, after the first "docker compose up":
#   sh load-cache.sh ~/arcnave-cache.tar compose.tunnel.yaml      (or compose.yaml for the Caddy setup)
set -e
TAR=${1:-$HOME/arcnave-cache.tar}
COMPOSE=${2:-compose.tunnel.yaml}
[ -f "$TAR" ] || { echo "No cache file at $TAR"; exit 1; }
TAR=$(cd "$(dirname "$TAR")" && pwd)/$(basename "$TAR")
echo "Loading $TAR into the ARCNAVE cache volume (a few minutes for 2 GB)..."
docker compose -f "$COMPOSE" --env-file .env run --rm --no-deps -T \
  -v "$TAR:/in/cache.tar:ro" --entrypoint sh arcnave \
  -c 'mkdir -p /data/cache && tar -xf /in/cache.tar -C /data/cache --skip-old-files && du -sh /data/cache'
docker compose -f "$COMPOSE" --env-file .env restart arcnave
echo "Done. Every field opened on the PC now opens from this server's disk."
