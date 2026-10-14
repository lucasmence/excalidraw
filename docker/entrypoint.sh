#!/bin/sh
#
# Sobe, dentro do próprio container, os três processos da imagem:
#
#   1. MySQL (servidor próprio da imagem, com root sem senha), em /var/lib/mysql;
#   2. a API de persistência (server/index.mjs), em 127.0.0.1:$API_PORT;
#   3. o nginx, que serve o app e faz proxy de /api para a API.
#
# O datadir do MySQL é o único estado que precisa sobreviver ao container:
# monte um volume em /var/lib/mysql (veja docker-compose.yml).
set -eu

MYSQL_DATADIR="${MYSQL_DATADIR:-/var/lib/mysql}"
MYSQL_SOCKET="${MYSQL_SOCKET:-/var/run/mysqld/mysqld.sock}"
MYSQL_PORT="${DB_PORT:-3306}"
API_PORT="${API_PORT:-3001}"
SERVER_DIR="${SERVER_DIR:-/opt/excalidraw/server}"

log() {
  echo "[entrypoint] $*"
}

MYSQL_PID=""
API_PID=""
NGINX_PID=""

stop() {
  status=$?
  log "encerrando (status $status)"
  for pid in "$NGINX_PID" "$API_PID" "$MYSQL_PID"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  exit "$status"
}

trap stop TERM INT

# --------------------------------------------------------------------- MySQL

mkdir -p /var/run/mysqld "$MYSQL_DATADIR"
chown -R mysql:mysql /var/run/mysqld "$MYSQL_DATADIR"

# primeira execução (ou volume vazio): cria o datadir com root sem senha
if [ ! -d "$MYSQL_DATADIR/mysql" ]; then
  log "inicializando o MySQL em $MYSQL_DATADIR (root sem senha)"
  mysqld --initialize-insecure --user=mysql --datadir="$MYSQL_DATADIR"
fi

log "subindo o MySQL (datadir: $MYSQL_DATADIR, porta: $MYSQL_PORT)"
mysqld \
  --user=mysql \
  --datadir="$MYSQL_DATADIR" \
  --socket="$MYSQL_SOCKET" \
  --bind-address=127.0.0.1 \
  --port="$MYSQL_PORT" &
MYSQL_PID=$!

log "aguardando o MySQL aceitar conexões"
until mysqladmin --protocol=socket --socket="$MYSQL_SOCKET" ping >/dev/null 2>&1; do
  if ! kill -0 "$MYSQL_PID" 2>/dev/null; then
    log "o MySQL morreu durante a inicialização"
    exit 1
  fi
  sleep 1
done
log "MySQL pronto"

# ----------------------------------------------------------------------- API

log "subindo a API de persistência (banco: ${DB_NAME:-excalidraw})"
node "$SERVER_DIR/index.mjs" &
API_PID=$!

# o cliente do banco só responde quando o schema está aplicado
until node -e "require('http').get({ host: '127.0.0.1', port: Number(process.env.API_PORT || 3001), path: '/api/health' }, (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" >/dev/null 2>&1; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "a API morreu durante a inicialização"
    exit 1
  fi
  sleep 1
done
log "API pronta"

# --------------------------------------------------------------------- nginx

log "subindo o nginx"
nginx -g "daemon off;" &
NGINX_PID=$!

# mantém o container vivo enquanto o nginx estiver de pé
wait "$NGINX_PID"
