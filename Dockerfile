# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Raise Node heap so npm itself does not OOM on large dependency trees.
# Root cause of the original "Exit handler never called!" crash.
ENV NODE_OPTIONS="--max-old-space-size=512" \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_PROGRESS=false \
    NODE_ENV=production

# Copy only manifests — never the lockfile.
# package-lock.json is excluded via .dockerignore so Docker always runs a
# fresh `npm install`, resolving the latest compatible versions and avoiding
# the EUSAGE "lockfile out of sync" failure that killed the previous build.
# Once you run `npm install` locally and commit a fresh package-lock.json,
# change this line to: COPY package.json package-lock.json ./
COPY package.json ./

RUN npm install --omit=dev --no-audit --no-fund

# ─── Stage 2: Lean production image ──────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256"

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

EXPOSE 3000

# Docker-level healthcheck — second safety net alongside Railway's own check.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://localhost:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["node", "src/server.js"]
