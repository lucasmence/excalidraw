import {
  type AccountState,
  AccountCreationDisabledError,
  accountCreationOpenAtom,
  bindAccountStore,
  bootstrapAccount,
  createAccount,
  getActiveSession,
  login,
  LoginKeyTakenError,
  logout,
  loginKeyOf,
  markLoginKeyRevealed,
  refreshAccount,
  rememberSession,
} from "../auth/session";
import { appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";
import { ApiError } from "../data/apiClient";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let server: ReturnType<typeof createFakeApiServer>;
let states: AccountState[];

const storedAccount = () => {
  const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
  return raw ? JSON.parse(raw) : null;
};

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
  states = [];
  appJotaiStore.set(accountCreationOpenAtom, true);
  bindAccountStore((state: AccountState) => states.push(state));
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sessão da conta", () => {
  it("cria a conta no servidor e fica autenticada", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    const session = getActiveSession();
    expect(session?.accountId).toBe([...server.accounts.keys()][0]);
    expect(states.at(-1)).toMatchObject({ status: "authenticated" });
    expect(server.calls.some((call) => call.path === "/api/accounts")).toBe(
      true,
    );
  });

  it("recusa criar a segunda conta quando o servidor só aceita a primeira", async () => {
    server = createFakeApiServer({ allowAccountCreation: false });

    await createAccount({ loginKey: ALICE_KEY, remember: false });
    logout();

    await expect(
      createAccount({ loginKey: BOB_KEY, remember: false }),
    ).rejects.toBeInstanceOf(AccountCreationDisabledError);
    // nenhuma conta nova foi criada e a chave que existia continua entrando
    expect(server.accounts.size).toBe(1);
    await expect(
      login({ loginKey: ALICE_KEY, remember: false }),
    ).resolves.toBeUndefined();
  });

  it("descobre pelo servidor que a criação de contas está fechada", async () => {
    server = createFakeApiServer({ allowAccountCreation: false });
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    logout();

    await bootstrapAccount();

    await vi.waitFor(() =>
      expect(appJotaiStore.get(accountCreationOpenAtom)).toBe(false),
    );
  });

  it("volta a permitir a criação quando o servidor reabre", async () => {
    appJotaiStore.set(accountCreationOpenAtom, false);

    await bootstrapAccount();

    await vi.waitFor(() =>
      expect(appJotaiStore.get(accountCreationOpenAtom)).toBe(true),
    );
    expect(server.calls.some((call) => call.path === "/api/health")).toBe(true);
  });

  it("recusa uma chave que já está registrada", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    logout();

    await expect(
      createAccount({ loginKey: ALICE_KEY, remember: false }),
    ).rejects.toBeInstanceOf(LoginKeyTakenError);
  });

  it("não cria conta com frase inválida", async () => {
    await expect(
      createAccount({ loginKey: "uma frase qualquer", remember: false }),
    ).rejects.toThrow("account.errors.invalidKey");
  });

  it("entra com a frase e recebe o estado da chave do servidor", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    logout();

    await login({ loginKey: ALICE_KEY, remember: false });

    expect(states.at(-1)).toMatchObject({
      status: "authenticated",
      remote: { keyRevealedAt: null },
    });
  });

  it("recusa login de uma chave que o servidor não conhece", async () => {
    await expect(
      login({ loginKey: BOB_KEY, remember: false }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getActiveSession()).toBeNull();
  });

  it("guarda a frase no navegador só quando o usuário pede", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    expect(storedAccount().loginKey).toBeNull();

    rememberSession(true);
    expect(storedAccount().loginKey).toBe(ALICE_KEY);

    rememberSession(false);
    expect(storedAccount().loginKey).toBeNull();
    // a conta continua logada nesta aba, mesmo sem persistir a frase
    expect(loginKeyOf()).toBe(ALICE_KEY);
  });

  it("registra no servidor que a chave já foi entregue", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    await markLoginKeyRevealed();

    const state = states.at(-1);
    expect(state).toMatchObject({
      status: "authenticated",
      remote: { keyRevealedAt: expect.any(String) },
    });
    expect(storedAccount().keyRevealedAt).toEqual(expect.any(String));
  });

  it("sai e limpa o que estava salvo", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });
    expect(storedAccount()).not.toBeNull();

    logout();

    expect(storedAccount()).toBeNull();
    expect(getActiveSession()).toBeNull();
    expect(states.at(-1)).toEqual({ status: "anonymous", error: null });
  });

  it("entra automaticamente quando a frase está salva", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });

    // simula recarregar a página: módulos novos, mesmo localStorage
    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(freshStates.at(-1)).toMatchObject({
      status: "authenticated",
      remote: { keyRevealedAt: null },
    });
    expect(fresh.getActiveSession()?.accountId).toBe(
      [...server.accounts.keys()][0],
    );

    fresh.logout();
  });

  it("não entra sozinho quando a frase não foi salva", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(freshStates.at(-1)).toEqual({ status: "anonymous", error: null });
    expect(fresh.getActiveSession()).toBeNull();
  });

  it("cai para a cópia local quando o servidor está fora do ar", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });
    await markLoginKeyRevealed();
    const revealedAt = storedAccount().keyRevealedAt;

    server.fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(freshStates.at(-1)).toMatchObject({
      status: "authenticated",
      offline: true,
      remote: { keyRevealedAt: revealedAt },
    });

    fresh.logout();
  });

  it("volta para a tela de login se a conta sumiu do servidor", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });

    server.accounts.clear();

    await refreshAccount();

    expect(states.at(-1)).toEqual({
      status: "anonymous",
      error: "account.errors.unknownKey",
    });
    expect(getActiveSession()).toBeNull();
  });

  it("sem storage remoto não pede conta (modo navegador)", async () => {
    vi.stubEnv("VITE_APP_STORAGE", "browser");

    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(freshStates.at(-1)).toEqual({ status: "disabled" });
    expect(fresh.getActiveSession()).toBeNull();
  });
});
