/**
 * Servidor de salas da colaboração em tempo real (socket.io).
 *
 * Baseado em https://github.com/excalidraw/excalidraw-room (MIT), reimplementado
 * aqui seguindo a convenção deste fork (`server/index.mjs`): ESM puro, sem passo
 * de build, e com Redis opcional.
 *
 * Este processo é um *relay* cego:
 *
 *   - o app conecta em `VITE_APP_WS_SERVER_URL` e faz o handshake
 *     `init-room` → `join-room <roomId>`;
 *   - cada alteração vai cifrada (AES-GCM com a chave da sala, que só existe no
 *     hash `#room=<roomId>,<roomKey>`) em `server-broadcast` /
 *     `server-volatile-broadcast`, e o servidor reemite como
 *     `client-broadcast` para o resto da sala;
 *   - ou seja: o servidor nunca vê o desenho nem consegue decifrá-lo, e não
 *     guarda nada — quem persiste a cena é a API/MySQL (`server/`).
 *
 * Presença: `room-user-change` (lista de sockets da sala), `new-user` (quem
 * entrou) e `first-in-room`. Seguir usuário usa salas `follow@<socketId>`.
 *
 * Escala
 * ------
 * Por padrão roda com o adapter em memória do socket.io: 1 instância atende
 * tudo. Para rodar várias instâncias atrás de um load balancer é preciso um
 * backplane — o adapter Redis (`REDIS_URL`), que reemite os eventos entre as
 * instâncias — e sessões sticky no balanceador (o transporte de polling do
 * socket.io exige; com websocket puro não). Sem Redis, uma edição feita na
 * instância A **não** chega em quem está na instância B.
 *
 * Variáveis de ambiente (todas opcionais):
 *   COLLAB_PORT (ou PORT)   porta (padrão 3002)
 *   COLLAB_HOST             interface (padrão 0.0.0.0)
 *   CORS_ORIGIN             origem permitida (padrão *)
 *   REDIS_URL               ex.: redis://127.0.0.1:6379 → liga o adapter Redis
 *   INSTANCE_ID             nome desta instância, aparece no /health
 */
import http from "node:http";

import { createAdapter } from "@socket.io/redis-adapter";
import express from "express";
import { createClient } from "redis";
import { Server as SocketIO } from "socket.io";

const PORT = Number(process.env.COLLAB_PORT || process.env.PORT || 3002);
const HOST = process.env.COLLAB_HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const REDIS_URL = process.env.REDIS_URL || "";
const INSTANCE_ID = process.env.INSTANCE_ID || String(process.pid);

const app = express();

const server = http.createServer(app);

const io = new SocketIO(server, {
  transports: ["websocket", "polling"],
  cors: { allowedHeaders: ["Content-Type", "Authorization"], origin: CORS_ORIGIN, credentials: true },
  // clientes antigos (engine.io v3) continuam funcionando
  allowEIO3: true,
});

let adapterName = "memory";
let pubClient = null;
let subClient = null;

/**
 * Liga o adapter Redis para que várias instâncias compartilhem as salas. Sem
 * `REDIS_URL` fica no adapter em memória (uma instância só) — é o modo de
 * desenvolvimento e o suficiente para um servidor único.
 */
const setupRedisAdapter = async () => {
  if (!REDIS_URL) {
    console.warn(
      "[collab] REDIS_URL não definido: usando o adapter em memória (1 instância). " +
        "Para rodar várias instâncias, defina REDIS_URL.",
    );
    return;
  }

  pubClient = createClient({ url: REDIS_URL });
  subClient = pubClient.duplicate();

  for (const [name, client] of [
    ["pub", pubClient],
    ["sub", subClient],
  ]) {
    client.on("error", (error) => {
      console.error(`[collab] erro no cliente redis (${name}): ${error.message}`);
    });
  }

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  adapterName = "redis";
  console.log("[collab] adapter Redis ligado: as instâncias compartilham as salas");
};

io.on("connection", (socket) => {
  io.to(`${socket.id}`).emit("init-room");

  socket.on("join-room", async (roomID) => {
    await socket.join(roomID);
    const sockets = await io.in(roomID).fetchSockets();

    if (sockets.length <= 1) {
      io.to(`${socket.id}`).emit("first-in-room");
    } else {
      // quem já estava na sala manda a cena para quem chegou
      socket.broadcast.to(roomID).emit("new-user", socket.id);
    }

    io.in(roomID).emit(
      "room-user-change",
      sockets.map((current) => current.id),
    );
  });

  socket.on("server-broadcast", (roomID, encryptedData, iv) => {
    socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
  });

  socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
    socket.volatile.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
  });

  socket.on("user-follow", async (payload) => {
    const roomID = `follow@${payload.userToFollow.socketId}`;

    if (payload.action === "FOLLOW") {
      await socket.join(roomID);
    } else {
      await socket.leave(roomID);
    }

    const sockets = await io.in(roomID).fetchSockets();
    io.to(payload.userToFollow.socketId).emit(
      "user-follow-room-change",
      sockets.map((current) => current.id),
    );
  });

  socket.on("disconnecting", async () => {
    for (const roomID of Array.from(socket.rooms)) {
      const others = (await io.in(roomID).fetchSockets()).filter(
        (current) => current.id !== socket.id,
      );
      const isFollowRoom = roomID.startsWith("follow@");

      if (!isFollowRoom && others.length > 0) {
        socket.broadcast.to(roomID).emit(
          "room-user-change",
          others.map((current) => current.id),
        );
      }

      if (isFollowRoom && others.length === 0) {
        io.to(roomID.replace("follow@", "")).emit("broadcast-unfollow");
      }
    }
  });

  socket.on("disconnect", () => {
    socket.removeAllListeners();
  });
});

app.get("/", (_req, res) => {
  res.send("Excalidraw collaboration server is up :)");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    adapter: adapterName,
    instance: INSTANCE_ID,
    rooms: io.sockets.adapter.rooms?.size ?? null,
  });
});

const shutdown = async (signal) => {
  console.log(`[collab] ${signal}: encerrando`);
  await io.close();
  server.close();
  await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
  process.exit(0);
};

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      console.error("[collab] erro ao encerrar:", error);
      process.exit(1);
    });
  });
}

await setupRedisAdapter();

server.listen(PORT, HOST, () => {
  console.log(
    `[collab] ouvindo em ws://${HOST}:${PORT} (adapter: ${adapterName}, instância: ${INSTANCE_ID})`,
  );
});
