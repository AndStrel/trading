FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

# T-Invest currently presents a chain issued by the Russian national CA.
# Download both certificates from the official Ministry of Digital Development endpoint
# during image build; TLS verification remains enabled for this download.
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates curl \
  && curl --fail --location --proto '=https' --tlsv1.2 \
    --output /usr/local/share/ca-certificates/russian_trusted_root_ca.crt \
    https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
  && curl --fail --location --proto '=https' --tlsv1.2 \
    --output /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt \
    https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--use-system-ca
USER node
CMD ["node", "dist/telegram-service.js"]
