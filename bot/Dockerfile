FROM node:22-slim

# Chromium (para gerar PDF) + fontes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DATA_DIR=/data

WORKDIR /app

# Instala versões exatas e reproduzíveis primeiro (cache de camada).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY assets ./assets

# Volume para persistir os dados do mês.
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "src/healthcheck.js"]

CMD ["node", "src/index.js"]
