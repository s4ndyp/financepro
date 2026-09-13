#!/bin/sh
set -e

PB_DIR="${PB_DIR:-./pb_data}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-./pb_migrations}"

mkdir -p "$PB_DIR"

echo "[PocketBase] Applying migrations..."
pocketbase migrate up \
    --dir="$PB_DIR" \
    --migrationsDir="$MIGRATIONS_DIR" \
    --automigrate=false \
    --dev=false

echo "[PocketBase] Starting server on 0.0.0.0:8090..."
exec pocketbase serve \
    --http=0.0.0.0:8090 \
    --dir="$PB_DIR" \
    --migrationsDir="$MIGRATIONS_DIR" \
    --automigrate=false \
    --dev=false
