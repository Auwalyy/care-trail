# Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/api-client/package.json packages/api-client/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @caretrail/web --include-workspace-root --ignore-scripts
COPY packages packages
COPY apps/web apps/web
# Public, build-time only (inlined into the browser bundle). Never pass secrets here.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @caretrail/shared-types \
 && npm run build -w @caretrail/api-client \
 && npm run build -w @caretrail/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static apps/web/.next/static
COPY --from=build /repo/apps/web/public apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
