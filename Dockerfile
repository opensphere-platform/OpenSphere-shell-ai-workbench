ARG OS_MODULE_DESCRIPTOR
ARG OS_MODULE_SIGNATURE
ARG OS_MODULE_KEY_ID=opensphere-plugins-v1
ARG APP_VERSION=1.1.2
ARG OS_RELEASE_TAG
FROM docker.io/library/node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src ./src
RUN npx ng build --configuration production

FROM docker.io/library/node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
ARG OS_MODULE_DESCRIPTOR
ARG OS_MODULE_SIGNATURE
ARG OS_MODULE_KEY_ID=opensphere-plugins-v1
ARG APP_VERSION
ARG OS_RELEASE_TAG
RUN apk upgrade --no-cache
# CONSTITUTION-0005 §2.1 — org.opencontainers.image.version은 KST yyyyMMddHHmm 공식
# version이고, SemVer 호환 버전은 io.opensphere.compatibility-version으로 분리한다.
LABEL org.opencontainers.image.title="AI-Workbench" \
      org.opencontainers.image.version=$OS_RELEASE_TAG \
      org.opencontainers.image.source="https://github.com/opensphere-platform/OpenSphere-shell-ai-workbench" \
      io.opensphere.compatibility-version=$APP_VERSION \
      io.opensphere.module.descriptor=$OS_MODULE_DESCRIPTOR \
      io.opensphere.module.descriptor.signature=$OS_MODULE_SIGNATURE \
      io.opensphere.module.descriptor.key-id=$OS_MODULE_KEY_ID
WORKDIR /app
COPY server-runtime/package.json server-runtime/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && rm -f package.json package-lock.json \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --chmod=0644 server.js /app/server.js
COPY ui-shell/ /app/plugins/
COPY --from=build /app/dist/ai/browser /app/www
ENV PLUGINS_DIR=/app/plugins \
    WWW_DIR=/app/www \
    PORT=8080 \
    APP_VERSION=$APP_VERSION \
    NODE_EXTRA_CA_CERTS=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
EXPOSE 8080
USER 1000
CMD ["node", "/app/server.js"]
