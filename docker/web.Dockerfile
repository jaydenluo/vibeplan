FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
ARG VITE_APP_VERSION=dev
ARG VITE_BUILD_COMMIT=unknown
ARG VITE_API_URL=/api
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_BUILD_COMMIT=$VITE_BUILD_COMMIT
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @vibeplan/web build

FROM nginx:1.27-alpine
ARG VITE_APP_VERSION=dev
ARG VITE_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.version=$VITE_APP_VERSION
LABEL org.opencontainers.image.revision=$VITE_BUILD_COMMIT
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
