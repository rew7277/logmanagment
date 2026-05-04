FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_PROGRESS=false
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["node", "src/server.js"]
