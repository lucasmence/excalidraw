FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

# dependências da API (mysql2 e transitivas) isoladas, para não levar o
# node_modules inteiro do monorepo para a imagem final. A instalação acontece
# fora de /opt/node_app: lá dentro o npm acha o workspace raiz e instalaria em
# /opt/node_app/node_modules em vez de server/node_modules.
RUN mkdir -p /opt/api-deps \
    && cp server/package.json /opt/api-deps/ \
    && cd /opt/api-deps \
    && npm install --omit=dev --no-audit --no-fund

ARG NODE_ENV=production

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker

# A imagem final roda três processos no mesmo container: MySQL, a API de
# persistência e o nginx (veja docker/entrypoint.sh).
#
# A base é o Ubuntu (e não o nginx:alpine) porque é ela que empacota o
# `mysql-server`: as distribuições Alpine só oferecem o MariaDB.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    # impede que os postinst do apt tentem subir serviços durante o build
    printf '#!/bin/sh\nexit 101\n' >/usr/sbin/policy-rc.d; \
    chmod +x /usr/sbin/policy-rc.d; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      libstdc++6 \
      mysql-server \
      nginx; \
    rm -rf /var/lib/apt/lists/*; \
    rm -f /usr/sbin/policy-rc.d; \
    # a config padrão do Ubuntu colide com a nossa (também em :80)
    rm -f /etc/nginx/sites-enabled/default; \
    # o datadir é criado no primeiro boot pelo entrypoint, já com root sem senha
    rm -rf /var/lib/mysql /var/lib/mysql-files; \
    mkdir -p /var/lib/mysql /var/lib/mysql-files /var/run/mysqld; \
    chown -R mysql:mysql /var/lib/mysql /var/lib/mysql-files /var/run/mysqld

# mesmo runtime Node usado no build: o binário do node:24 (glibc 2.36) roda no
# Ubuntu 24.04 (glibc 2.39)
COPY --from=build /usr/local/bin/node /usr/local/bin/node

COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html
COPY --from=build /opt/node_app/server /opt/excalidraw/server
COPY --from=build /opt/api-deps/node_modules /opt/excalidraw/server/node_modules
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/excalidraw-entrypoint
RUN chmod +x /usr/local/bin/excalidraw-entrypoint

# padrões do MySQL interno: usuário local, sem senha (`DB_PASSWORD` fica vazio
# por padrão no server/index.mjs, por isso não é declarado aqui)
ENV DB_HOST=127.0.0.1 \
    DB_PORT=3306 \
    DB_USER=root \
    DB_NAME=excalidraw \
    API_HOST=127.0.0.1 \
    API_PORT=3001

# único estado que precisa sobreviver ao container (monte um volume aqui)
VOLUME /var/lib/mysql

EXPOSE 80

# valida a pilha inteira: nginx -> API -> MySQL
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1/api/health', (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

ENTRYPOINT ["/usr/local/bin/excalidraw-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
