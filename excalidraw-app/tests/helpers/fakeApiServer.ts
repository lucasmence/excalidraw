import { vi } from "vitest";

/**
 * Servidor falso: implementa a mesma API de `server/index.mjs` guardando só o
 * que chega pela rede. Serve para provar duas coisas nos testes —
 *
 *   1. que o cliente conversa com a API como esperado (rotas, Bearer, índices
 *      cegos, isolamento por conta);
 *   2. que o servidor *nunca* chega a ver o conteúdo: `dump()` devolve tudo o
 *      que ele guardou/recebeu para que o teste procure por texto puro.
 */

type Envelope = { v: 1; iv: string; ct: string };

export const createFakeApiServer = () => {
  const accounts = new Map<
    string,
    { authSecret: string; keyRevealedAt: string | null }
  >();
  const scenes = new Map<string, Envelope>();
  const libraries = new Map<string, Envelope>();
  const files = new Map<string, Map<string, Envelope>>();
  const calls: { method: string; path: string; body: any }[] = [];
  let clock = 0;

  const ok = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const error = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), { status });

  const accountFor = (authSecret: string | undefined) => {
    if (!authSecret) {
      return null;
    }
    for (const [id, account] of accounts) {
      if (account.authSecret === authSecret) {
        return id;
      }
    }
    return null;
  };

  const filesOf = (accountId: string) => {
    if (!files.has(accountId)) {
      files.set(accountId, new Map());
    }
    return files.get(accountId)!;
  };

  const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const token = /^Bearer\s+(.+)$/i.exec(
      String(new Headers(init?.headers).get("authorization") ?? ""),
    )?.[1];

    calls.push({ method, path: `${url.pathname}${url.search}`, body });

    if (url.pathname === "/api/accounts" && method === "POST") {
      const { accountId, authSecret } = body ?? {};
      if (accounts.has(accountId)) {
        return error(409, "Account already exists");
      }
      accounts.set(accountId, { authSecret, keyRevealedAt: null });
      return ok({ ok: true, accountId, keyRevealedAt: null }, 201);
    }

    if (url.pathname === "/api/session" && method === "POST") {
      const { accountId, authSecret } = body ?? {};
      const account = accounts.get(accountId);
      if (!account || account.authSecret !== authSecret) {
        return error(401, "Invalid credentials");
      }
      return ok({
        ok: true,
        accountId,
        keyRevealedAt: account.keyRevealedAt,
      });
    }

    const accountId = accountFor(token);
    if (!accountId) {
      return error(401, "Invalid credentials");
    }
    const account = accounts.get(accountId)!;

    if (url.pathname === "/api/session" && method === "GET") {
      return ok({ accountId, keyRevealedAt: account.keyRevealedAt });
    }

    if (url.pathname === "/api/session/key-revealed" && method === "POST") {
      if (!account.keyRevealedAt) {
        account.keyRevealedAt = new Date(++clock).toISOString();
      }
      return ok({ ok: true, keyRevealedAt: account.keyRevealedAt });
    }

    if (url.pathname === "/api/scene" && method === "GET") {
      return ok({ scene: scenes.get(accountId) ?? null });
    }

    if (url.pathname === "/api/scene" && method === "PUT") {
      scenes.set(accountId, body.payload);
      return ok({ ok: true });
    }

    if (url.pathname === "/api/library" && method === "GET") {
      return ok({ library: libraries.get(accountId) ?? null });
    }

    if (url.pathname === "/api/library" && method === "PUT") {
      libraries.set(accountId, body.payload);
      return ok({ ok: true });
    }

    if (url.pathname === "/api/files" && method === "GET") {
      const keys = (url.searchParams.get("keys") || "")
        .split(",")
        .filter(Boolean);
      const store = filesOf(accountId);
      return ok({
        files: keys
          .filter((key) => store.has(key))
          .map((key) => ({ key, payload: store.get(key) })),
      });
    }

    if (url.pathname === "/api/files" && method === "PUT") {
      const store = filesOf(accountId);
      for (const file of body.files) {
        store.set(file.key, file.payload);
      }
      return ok({ ok: true, saved: body.files.map((file: any) => file.key) });
    }

    if (url.pathname === "/api/files/prune" && method === "POST") {
      const store = filesOf(accountId);
      const keep = new Set<string>(body.keep ?? []);
      let deleted = 0;
      for (const key of body.remove ?? []) {
        if (!keep.has(key) && store.delete(key)) {
          deleted++;
        }
      }
      return ok({ ok: true, deleted });
    }

    return error(404, `Not found: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    calls,
    accounts,
    scenes,
    libraries,
    files,
    /** tudo que o servidor tem/viu, para procurar vazamento de texto puro */
    dump: () =>
      JSON.stringify({
        accounts: [...accounts].map(([id, account]) => [
          id,
          account.authSecret,
        ]),
        scenes: [...scenes],
        libraries: [...libraries],
        files: [...files].map(([id, store]) => [id, [...store]]),
        calls,
      }),
  };
};
