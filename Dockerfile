# Playwright base image ships Chromium + all system dependencies
FROM mcr.microsoft.com/playwright:v1.51.0-noble AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runner
ENV PORT=3000
ENV DATABASE_URL="file:/data/store-checks.db"

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.bin ./node_modules/.bin

RUN mkdir -p /data

EXPOSE 3000
# Create/upgrade the SQLite schema, then start the server
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node server.js"]
