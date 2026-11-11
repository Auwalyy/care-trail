# Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
# Install only the API workspace and its workspace dependencies (not web/mobile).
RUN npm ci --workspace @caretrail/api --include-workspace-root --ignore-scripts
COPY packages/shared-types packages/shared-types
COPY packages/validation packages/validation
COPY apps/api apps/api
RUN npm run build -w @caretrail/shared-types \
 && npm run build -w @caretrail/validation \
 && npm run build -w @caretrail/api

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --workspace @caretrail/api --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/validation/package.json packages/validation/
COPY --from=build /repo/packages/validation/dist packages/validation/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
