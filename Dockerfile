# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Raise Node heap so npm itself does not OOM on large dependency trees.
# This was the root cause of "Exit handler never called!" in build logs.
ENV NODE_OPTIONS="--max-old-space-size=512" \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_PROGRESS=false \
    NODE_ENV=production

COPY package*.json ./

# Use `npm ci` when a lockfile exists (reproducible, faster).
# Falls back to `npm install` when no lockfile yet.
RUN if [ -f package-lock.json ]; then \
      echo "[docker] package-lock.json found — using npm ci"; \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      echo "[docker] no lockfile — using npm install"; \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# ─── Stage 2: Lean production image ──────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256"

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public

EXPOSE 3000

# Docker-level healthcheck — second safety net alongside Railway's own check.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://localhost:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["node", "src/server.js"]
