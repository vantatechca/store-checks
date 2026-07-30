# Playwright base image ships Chromium + all system dependencies
FROM mcr.microsoft.com/playwright:v1.62.0-noble AS base
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
# The startup CMD runs the Prisma CLI (`prisma db push`), which needs its full
# dependency tree (e.g. @prisma/config -> effect). The Next.js standalone output
# only traces the runtime deps of the server, so copy the complete node_modules
# to guarantee the CLI's transitive deps are present.
COPY --from=build /app/node_modules ./node_modules

RUN mkdir -p /data

EXPOSE 3000
# Create/upgrade the SQLite schema, then start the server
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node server.js"]
