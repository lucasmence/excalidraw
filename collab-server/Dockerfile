# Servidor de salas da colaboração. É um processo Node sem estado, então a
# imagem é só as dependências + o código (veja collab-server/index.mjs).
FROM node:24-alpine

WORKDIR /opt/excalidraw-collab

COPY collab-server/package.json ./

# dependências isoladas: o pacote não usa o restante do monorepo
RUN npm install --omit=dev --no-audit --no-fund

COPY collab-server/index.mjs ./

# padrões: 3002 é a porta que o app procura (VITE_APP_WS_SERVER_URL) e o Redis
# entra por REDIS_URL no compose; sem ela, roda no adapter em memória
ENV COLLAB_PORT=3002

EXPOSE 3002

CMD ["node", "index.mjs"]
