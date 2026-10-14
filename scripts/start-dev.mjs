/**
 * Sobe, em um único comando (`yarn start`), os dois processos do app:
 *
 *   - a API de persistência (server/index.mjs), que fala com o MySQL, em
 *     `API_PORT` (3017 por padrão — 3001 é o dev server e 3002 a colaboração);
 *   - o dev server do Vite, em 3001, que faz proxy de `/api` para a API.
 *
 * Assim `yarn start` continua sendo o comando único de desenvolvimento: o
 * navegador só conhece `/api` no próprio origin, e quem conversa com o banco é
 * este processo Node. O proxy do Vite aponta para a mesma porta
 * (`VITE_APP_API_PROXY_TARGET` em `.env.development`).
 */
import { spawn } from "node:child_process";
import process from "node:process";

/** no Windows, `yarn` é um `.cmd` e só roda via shell */
const needsShell = process.platform === "win32";

const children = [
  [
    "api",
    spawn(process.execPath, ["server/index.mjs"], {
      stdio: "inherit",
      env: process.env,
    }),
  ],
  [
    "app",
    spawn("yarn", ["--cwd", "./excalidraw-app", "start"], {
      stdio: "inherit",
      env: process.env,
      shell: needsShell,
    }),
  ],
];

let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const [, child] of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  // dá um tempo para os filhos encerrarem (o `mysqld` da API não é nosso)
  setTimeout(() => process.exit(code), 500).unref();
};

for (const [name, child] of children) {
  child.on("error", (error) => {
    console.error(`[start] não consegui iniciar ${name}:`, error.message);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.log(`[start] ${name} terminou (code=${code}, signal=${signal})`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
