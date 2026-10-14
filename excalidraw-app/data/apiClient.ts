/**
 * Transporte HTTP da API de persistência (server/index.mjs).
 *
 * Aqui só vive o que é comum a tudo que fala com o servidor: URL base, timeout,
 * tratamento de erro e o header de credencial. A camada de cima — `apiStorage`
 * — é quem cifra/decifra, e `auth/session` é quem cria/valida a conta.
 */

const REQUEST_TIMEOUT_MS = 15_000;
/** login/criação de conta: o usuário está esperando, então falha rápido */
export const AUTH_TIMEOUT_MS = 8_000;

export const apiBaseUrl = (import.meta.env.VITE_APP_API_URL || "/api").replace(
  /\/+$/,
  "",
);

/**
 * Com `VITE_APP_STORAGE=browser` o app volta a usar só o storage do navegador
 * (usado nos testes, que não devem depender de um banco no ar). Sem servidor não
 * existe conta nem cifra: é o modo antigo, completo.
 */
export const isRemoteStorageEnabled = () =>
  (import.meta.env.VITE_APP_STORAGE || "mysql") !== "browser";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const request = async <T>({
  path,
  method = "GET",
  body,
  token,
  timeout = REQUEST_TIMEOUT_MS,
}: {
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  token?: string | null;
  timeout?: number;
}): Promise<T> => {
  if (typeof fetch !== "function") {
    throw new Error("fetch indisponível neste ambiente");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok) {
      let detail = text;
      try {
        detail = JSON.parse(text)?.error || text;
      } catch (error) {
        // corpo não-JSON: fica o texto cru
      }
      throw new ApiError(
        `${method} ${path} respondeu ${response.status}${
          detail ? `: ${detail}` : ""
        }`,
        response.status,
      );
    }

    if (!text) {
      return null as T;
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
};

export const api = {
  get: <T>(path: string, token?: string | null, timeout?: number) =>
    request<T>({ path, token, timeout }),
  post: <T>(
    path: string,
    body?: unknown,
    token?: string | null,
    timeout?: number,
  ) => request<T>({ path, method: "POST", body, token, timeout }),
  put: <T>(
    path: string,
    body: unknown,
    token?: string | null,
    timeout?: number,
  ) => request<T>({ path, method: "PUT", body, token, timeout }),
};
