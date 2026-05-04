FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts postcss.config.js ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

RUN addgroup -S textbin && adduser -S textbin -G textbin

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /data/notes && chown -R textbin:textbin /app /data

USER textbin

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server/index.js"]
