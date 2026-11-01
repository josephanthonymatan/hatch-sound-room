# Build from the hatch-sound-room repository root: docker build -f cloud/Dockerfile .
FROM node:24-bookworm-slim AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY cloud/package.json cloud/package-lock.json ./cloud/
RUN npm ci --prefix cloud --omit=dev --ignore-scripts
COPY cloud/*.mjs ./cloud/
COPY cloud/catalog.json cloud/NOTICE ./cloud/
COPY media/bach-partita2-allemanda-full.mp3 media/bach-partita2-allemanda.metadata.json ./media/
COPY --from=frontend /app/web/dist ./web/dist
ENV NODE_ENV=production DATA_DIR=/var/data/hatch FRONTEND_DIST=/app/web/dist PORT=3000
EXPOSE 3000
CMD ["node", "cloud/server.mjs"]
