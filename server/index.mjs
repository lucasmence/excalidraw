/**
 * API HTTP que persiste o estado do Excalidraw em MySQL.
 *
 * O navegador não fala MySQL, então a persistência passa por aqui — mas note
 * que este processo é *cego* ao conteúdo: cena, imagens e biblioteca chegam já
 * cifrados (AES-GCM) com uma chave derivada da chave de login (a frase de 12
 * palavras). O servidor nunca vê a frase nem consegue decifrar nada.
 *
 * Autenticação
 * ------------
 * Não há email/senha. O cliente deriva da frase:
 *
 *   accountId   → identificador opaco da conta
 *   authSecret  → credencial enviada como `Authorization: Bearer <authSecret>`
 *
 * Da `authSecret` o servidor guarda apenas o sha256 (`accounts.auth_hash`) e a
 * usa só para localizar a conta. Como ela tem 256 bits de entropia aleatória
 * derivada da frase, não é adivinhável.
 *
 * Endpoints
 * ---------
 *   GET    /api/health                    -> { ok, storage, accountCreationOpen }
 *
 *   POST   /api/accounts                  -> cria a conta  body: { accountId, authSecret }
 *   POST   /api/session                   -> valida  body: { accountId, authSecret }
 *
 *   (os abaixo exigem `Authorization: Bearer <authSecret>`)
 *   GET    /api/session                   -> { accountId, keyRevealedAt }
 *   POST   /api/session/key-revealed       -> marca que a chave já foi entregue
 *   GET    /api/scene                     -> { scene: envelope | null }
 *   PUT    /api/scene                     -> body: { payload: envelope }
 *   GET    /api/files?keys=a,b            -> { files: [{ key, payload }] }
 *   PUT    /api/files                     -> body: { files: [{ key, payload }] }
 *   POST   /api/files/prune               -> body: { remove: [keys], keep?: [keys] }
 *   GET    /api/library                   -> { library: envelope | null }
 *   PUT    /api/library                   -> body: { payload: envelope }
 *
 * Configuração por variáveis de ambiente (todas opcionais):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   API_HOST, API_PORT (padrão 3017), MAX_BODY_BYTES, DB_RETRY_ATTEMPTS,
 *   DB_RETRY_DELAY_MS
 *   ALLOW_ACCOUNT_CREATION (padrão true) — com `false`, a instância aceita uma
 *   única conta: criar só enquanto não existe nenhuma. Escrito sem diferenciar
 *   maiúsculas e aceitando `false`, `0`, `no` e `off`, para que um `False` no
 *   `.env` não deixe a criação aberta sem ninguém perceber (veja
 *   parseAllowAccountCreation)
 */

import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import mysql from "mysql2/promise";

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  // `??` (e não `||`) para que uma senha vazia continue vazia
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME || "excalidraw",
};

const API_HOST = process.env.API_HOST || "0.0.0.0";
// 3017 no desenvolvimento: 3001 é o dev server do Vite e 3002 o servidor de
// colaboração (veja .env.development). No container a imagem define API_PORT
// explicitamente (Dockerfile) e o nginx faz proxy de `/api` para lá.
const API_PORT = Number(process.env.API_PORT || 3017);
const MAX_BODY_BYTES = Number(
  process.env.MAX_BODY_BYTES || 200 * 1024 * 1024,
);
const DB_RETRY_ATTEMPTS = Number(process.env.DB_RETRY_ATTEMPTS || 30);
const DB_RETRY_DELAY_MS = Number(process.env.DB_RETRY_DELAY_MS || 2000);
/**
 * `false` fecha a criação de contas: só a primeira conta do banco pode ser
 * criada (as que já existem continuam entrando normalmente).
 *
 * A leitura é tolerante de propósito: além de `false`, valem `0`, `no` e `off`,
 * sem diferenciar maiúsculas, e valores com espaço em volta são aceitos. Só a
 * variável ausente (ou vazia) mantém o padrão aberto — um `ALLOW_ACCOUNT_CREATION=False`
 * no `.env` fechava a criação no que o operador esperava, mas não aqui.
 */
const parseAllowAccountCreation = (value) => {
  if (value === undefined) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return !["false", "0", "no", "off"].includes(normalized);
};

const ALLOW_ACCOUNT_CREATION = parseAllowAccountCreation(
  process.env.ALLOW_ACCOUNT_CREATION,
);

/** ids/credenciais são base64url de 32 bytes (43 chars) */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** teto de itens por requisição, para não aceitar payloads absurdos */
const MAX_FILES_PER_REQUEST = 500;
const MAX_KEYS_PER_PRUNE = 5000;

const schemaStatements = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
)
  // remove linhas de comentário antes de dividir por `;`, senão o primeiro
  // statement (precedido do cabeçalho) seria descartado junto com o comentário
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

let pool;
let apiServer;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// -----------------------------------------------------------------------------
// banco
// -----------------------------------------------------------------------------

const createSchema = async () => {
  // conecta sem `database` para poder criá-lo na primeira execução
  const bootstrapConnection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    multipleStatements: false,
  });

  try {
    await bootstrapConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    );
  } finally {
    await bootstrapConnection.end();
  }

  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4_bin",
  });

  for (const statement of schemaStatements) {
    await pool.query(statement);
  }
};

/** Tenta inicializar o banco; em Docker o MySQL demora alguns segundos a subir. */
const initDb = async () => {
  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt++) {
    try {
      await createSchema();
      console.log(
        `[api] conectado ao MySQL em ${dbConfig.host}:${dbConfig.port} (banco: ${dbConfig.database})`,
      );
      return;
    } catch (error) {
      console.error(
        `[api] tentativa ${attempt}/${DB_RETRY_ATTEMPTS} de conectar ao MySQL falhou: ${error.message}`,
      );
      if (attempt === DB_RETRY_ATTEMPTS) {
        throw error;
      }
      await sleep(DB_RETRY_DELAY_MS);
    }
  }
};

// -----------------------------------------------------------------------------
// helpers HTTP
// -----------------------------------------------------------------------------

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const httpError = (status, message) =>
  Object.assign(new Error(message), { statusCode: status });

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, "Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(httpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

const asArray = (value, key) => {
  if (!Array.isArray(value)) {
    throw httpError(400, `\`${key}\` must be an array`);
  }
  return value;
};

const asToken = (value, key) => {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw httpError(400, `\`${key}\` must be an opaque token`);
  }
  return value;
};

/**
 * Envelope cifrado produzido no cliente. O servidor só confere a forma: ele não
 * tem como (nem precisa) olhar o conteúdo.
 */
const asEnvelope = (value, key) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, `\`${key}\` must be an encrypted envelope`);
  }
  if (value.v !== 1) {
    throw httpError(400, `\`${key}.v\` must be 1`);
  }
  if (typeof value.iv !== "string" || value.iv.length > 64) {
    throw httpError(400, `\`${key}.iv\` must be a short string`);
  }
  if (typeof value.ct !== "string" || !value.ct.length) {
    throw httpError(400, `\`${key}.ct\` must be a non-empty string`);
  }
  return { v: 1, iv: value.iv, ct: value.ct };
};

const parseKeys = (raw) => {
  const keys = (raw || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  for (const key of keys) {
    asToken(key, "keys");
  }

  if (keys.length > MAX_FILES_PER_REQUEST) {
    throw httpError(400, "too many keys");
  }

  return keys;
};

// -----------------------------------------------------------------------------
// configuração da instância
// -----------------------------------------------------------------------------

/**
 * A criação de contas está aberta? Por padrão está. Com
 * `ALLOW_ACCOUNT_CREATION=false` a instância é de um usuário só: enquanto o
 * banco não tiver nenhuma conta, a primeira pode ser criada; depois disso,
 * `POST /api/accounts` passa a responder 403 (entrar com uma chave que já
 * existe continua funcionando).
 */
const isAccountCreationOpen = async () => {
  if (ALLOW_ACCOUNT_CREATION) {
    return true;
  }

  const [rows] = await pool.query("SELECT COUNT(*) AS total FROM accounts");
  return Number(rows[0].total) === 0;
};

// -----------------------------------------------------------------------------
// autenticação
// -----------------------------------------------------------------------------

const authenticate = async (req) => {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  if (!match) {
    throw httpError(401, "Missing credentials");
  }

  const [rows] = await pool.execute(
    "SELECT id, key_revealed_at FROM accounts WHERE auth_hash = ?",
    [sha256(match[1].trim())],
  );

  if (!rows.length) {
    throw httpError(401, "Invalid credentials");
  }

  return { accountId: rows[0].id, keyRevealedAt: rows[0].key_revealed_at };
};

// -----------------------------------------------------------------------------
// handlers
// -----------------------------------------------------------------------------

const handleCreateAccount = async (body) => {
  const accountId = asToken(body?.accountId, "accountId");
  const authSecret = asToken(body?.authSecret, "authSecret");

  if (!(await isAccountCreationOpen())) {
    // o cliente usa a chave para mostrar a mensagem traduzida
    throw httpError(403, "account.errors.creationDisabled");
  }

  const [existing] = await pool.execute(
    "SELECT id FROM accounts WHERE id = ? OR auth_hash = ?",
    [accountId, sha256(authSecret)],
  );

  if (existing.length) {
    // a conta já existe (mesma chave de login): o cliente deve entrar nela
    throw httpError(409, "Account already exists");
  }

  await pool.execute(
    "INSERT INTO accounts (id, auth_hash) VALUES (?, ?)",
    [accountId, sha256(authSecret)],
  );

  return { status: 201, payload: { ok: true, accountId, keyRevealedAt: null } };
};

const handleLogin = async (body) => {
  const accountId = asToken(body?.accountId, "accountId");
  const authSecret = asToken(body?.authSecret, "authSecret");

  const [rows] = await pool.execute(
    "SELECT id, key_revealed_at FROM accounts WHERE id = ? AND auth_hash = ?",
    [accountId, sha256(authSecret)],
  );

  if (!rows.length) {
    throw httpError(401, "Invalid credentials");
  }

  return {
    status: 200,
    payload: {
      ok: true,
      accountId: rows[0].id,
      keyRevealedAt: rows[0].key_revealed_at,
    },
  };
};

const handleGetSession = async (account) => ({
  status: 200,
  payload: {
    accountId: account.accountId,
    keyRevealedAt: account.keyRevealedAt,
  },
});

const handleKeyRevealed = async (account) => {
  // idempotente: registra só a primeira vez, que é o que importa saber
  await pool.execute(
    "UPDATE accounts SET key_revealed_at = COALESCE(key_revealed_at, NOW()) WHERE id = ?",
    [account.accountId],
  );

  const [rows] = await pool.execute(
    "SELECT key_revealed_at FROM accounts WHERE id = ?",
    [account.accountId],
  );

  return { status: 200, payload: { ok: true, keyRevealedAt: rows[0].key_revealed_at } };
};

const handleGetScene = async (account) => {
  const [rows] = await pool.execute(
    "SELECT payload FROM encrypted_scenes WHERE account_id = ?",
    [account.accountId],
  );

  return {
    status: 200,
    payload: { scene: rows.length ? JSON.parse(rows[0].payload) : null },
  };
};

const handlePutScene = async (account, body) => {
  const payload = asEnvelope(body?.payload, "payload");

  await pool.execute(
    `INSERT INTO encrypted_scenes (account_id, payload) VALUES (?, ?) AS new
     ON DUPLICATE KEY UPDATE payload = new.payload`,
    [account.accountId, JSON.stringify(payload)],
  );

  return { status: 200, payload: { ok: true } };
};

const handleGetFiles = async (account, url) => {
  const keys = parseKeys(url.searchParams.get("keys"));

  if (!keys.length) {
    return { status: 200, payload: { files: [] } };
  }

  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await pool.execute(
    `SELECT file_key, payload FROM encrypted_files
      WHERE account_id = ? AND file_key IN (${placeholders})`,
    [account.accountId, ...keys],
  );

  return {
    status: 200,
    payload: {
      files: rows.map((row) => ({
        key: row.file_key,
        payload: JSON.parse(row.payload),
      })),
    },
  };
};

const handlePutFiles = async (account, body) => {
  const files = asArray(body?.files, "files");

  if (files.length > MAX_FILES_PER_REQUEST) {
    throw httpError(400, "too many files");
  }

  const saved = [];

  // um INSERT por arquivo para manter cada statement abaixo do max_allowed_packet
  for (const file of files) {
    const key = asToken(file?.key, "files[].key");
    const payload = asEnvelope(file?.payload, "files[].payload");

    await pool.execute(
      `INSERT INTO encrypted_files (account_id, file_key, payload) VALUES (?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE payload = new.payload`,
      [account.accountId, key, JSON.stringify(payload)],
    );

    saved.push(key);
  }

  return { status: 200, payload: { ok: true, saved } };
};

const handlePruneFiles = async (account, body) => {
  const remove = asArray(body?.remove, "remove").map((key) =>
    asToken(key, "remove[]"),
  );
  const keep = new Set(
    (body?.keep ? asArray(body.keep, "keep") : []).map((key) =>
      asToken(key, "keep[]"),
    ),
  );

  if (remove.length > MAX_KEYS_PER_PRUNE) {
    throw httpError(400, "too many keys");
  }

  // `keep` protege contra corrida: um arquivo referenciado pela cena nunca sai
  const targets = remove.filter((key) => !keep.has(key));

  if (!targets.length) {
    return { status: 200, payload: { ok: true, deleted: 0 } };
  }

  const [result] = await pool.execute(
    `DELETE FROM encrypted_files
      WHERE account_id = ?
        AND file_key IN (${targets.map(() => "?").join(",")})`,
    [account.accountId, ...targets],
  );

  return { status: 200, payload: { ok: true, deleted: result.affectedRows } };
};

const handleGetLibrary = async (account) => {
  const [rows] = await pool.execute(
    "SELECT payload FROM encrypted_library WHERE account_id = ?",
    [account.accountId],
  );

  return {
    status: 200,
    payload: { library: rows.length ? JSON.parse(rows[0].payload) : null },
  };
};

const handlePutLibrary = async (account, body) => {
  const payload = asEnvelope(body?.payload, "payload");

  await pool.execute(
    `INSERT INTO encrypted_library (account_id, payload) VALUES (?, ?) AS new
     ON DUPLICATE KEY UPDATE payload = new.payload`,
    [account.accountId, JSON.stringify(payload)],
  );

  return { status: 200, payload: { ok: true } };
};

const handleHealth = async () => {
  await pool.query("SELECT 1");
  return {
    status: 200,
    payload: {
      ok: true,
      storage: "mysql",
      accountCreationOpen: await isAccountCreationOpen(),
    },
  };
};

// -----------------------------------------------------------------------------
// servidor
// -----------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    let result;

    if (route === "GET /api/health") {
      result = await handleHealth();
    } else if (route === "POST /api/accounts") {
      result = await handleCreateAccount(await readJsonBody(req));
    } else if (route === "POST /api/session") {
      result = await handleLogin(await readJsonBody(req));
    } else if (route.startsWith("GET /api/") || route.startsWith("PUT /api/") || route.startsWith("POST /api/")) {
      // daqui para baixo tudo exige credencial e opera só na conta dela
      const account = await authenticate(req);

      if (route === "GET /api/session") {
        result = await handleGetSession(account);
      } else if (route === "POST /api/session/key-revealed") {
        result = await handleKeyRevealed(account);
      } else if (route === "GET /api/scene") {
        result = await handleGetScene(account);
      } else if (route === "PUT /api/scene") {
        result = await handlePutScene(account, await readJsonBody(req));
      } else if (route === "GET /api/files") {
        result = await handleGetFiles(account, url);
      } else if (route === "PUT /api/files") {
        result = await handlePutFiles(account, await readJsonBody(req));
      } else if (route === "POST /api/files/prune") {
        result = await handlePruneFiles(account, await readJsonBody(req));
      } else if (route === "GET /api/library") {
        result = await handleGetLibrary(account);
      } else if (route === "PUT /api/library") {
        result = await handlePutLibrary(account, await readJsonBody(req));
      } else {
        result = { status: 404, payload: { error: `Not found: ${route}` } };
      }
    } else {
      result = { status: 404, payload: { error: `Not found: ${route}` } };
    }

    sendJson(res, result.status, result.payload);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error(`[api] ${route} falhou:`, error);
    }
    sendJson(res, status, { error: error.message });
  }
});

const shutdown = async (signal) => {
  console.log(`[api] recebido ${signal}, encerrando...`);
  await new Promise((resolve) => apiServer.close(resolve));
  await pool?.end().catch(() => {});
  process.exit(0);
};

const main = async () => {
  // deixa no log o que o processo realmente entendeu da configuração: é o que
  // responde "minha variável chegou no servidor?" no container em produção.
  // Vem antes do banco de propósito, para aparecer mesmo com o MySQL falhando.
  console.log(
    `[api] criação de contas: ${
      ALLOW_ACCOUNT_CREATION
        ? "aberta"
        : `fechada depois da primeira (ALLOW_ACCOUNT_CREATION=${process.env.ALLOW_ACCOUNT_CREATION})`
    }`,
  );

  await initDb();

  apiServer = server.listen(API_PORT, API_HOST, () => {
    console.log(`[api] ouvindo em http://${API_HOST}:${API_PORT}/api`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      shutdown(signal).catch((error) => {
        console.error("[api] erro ao encerrar:", error);
        process.exit(1);
      });
    });
  }
};

main().catch((error) => {
  console.error("[api] não foi possível iniciar:", error.message);
  process.exit(1);
});
