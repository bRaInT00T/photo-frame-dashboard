# Build from the repository root: docker compose -f hub/compose.yaml up -d --build
FROM node:22-alpine AS dashboard
WORKDIR /src/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY hub/package.json hub/package-lock.json ./
RUN npm ci --omit=dev
COPY hub/server.mjs ./
# Defaults; compose.yaml mounts your own config.json over this.
COPY hub/config.example.json ./config.json
COPY --from=dashboard /src/dashboard/dist ./dist
ENV DIST=/app/dist PORT=8430 NODE_ENV=production
USER node
EXPOSE 8430
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8430/healthz || exit 1
CMD ["node", "server.mjs"]
