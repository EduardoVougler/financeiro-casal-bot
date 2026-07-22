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

# Instala dependências primeiro (cache de camada).
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Volume para persistir os dados do mês.
VOLUME ["/data"]

CMD ["node", "src/index.js"]
