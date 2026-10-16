FROM node:22-alpine AS server-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:server

FROM node:22-alpine AS client-build

WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client ./
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=server-build --chown=node:node /app/dist ./dist
COPY --from=client-build --chown=node:node /app/dist/public ./dist/public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node openapi ./openapi

USER node

EXPOSE 3000

CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && exec node dist/server.js"]
