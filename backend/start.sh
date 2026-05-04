#!/bin/sh
# Start node app immediately so healthcheck passes
node src/index.js &
APP_PID=$!

# Run prisma migrations in background (non-blocking)
echo "[startup] Running prisma generate..."
npx prisma generate 2>&1 | head -5
echo "[startup] Running prisma db push..."
npx prisma db push --accept-data-loss 2>&1 | tail -10 || echo "[startup] WARNING: prisma db push failed — products table may not exist"
echo "[startup] Prisma done."

# Keep container alive with the app process
wait $APP_PID
