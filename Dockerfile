# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_IMAGE_STORAGE_MODE=minio
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_IMAGE_STORAGE_MODE=$NEXT_PUBLIC_IMAGE_STORAGE_MODE

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup -S nextjs \
    && adduser -S nextjs -G nextjs \
    && mkdir -p /app/generated-images \
    && chown -R nextjs:nextjs /app

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=prod-deps --chown=nextjs:nextjs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
