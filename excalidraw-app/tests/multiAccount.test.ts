import {
  type AccountState,
  accountCreationOpenAtom,
  accountsAtom,
  bindAccountStore,
  createAccount,
  forgetAccount,
  getActiveSession,
  loginKeyOf,
  logout,
  markLoginKeyRevealed,
  resumableAccounts,
  switchAccount,
} from "../auth/session";
import { deriveAccountKeys } from "../auth/keys";
import { appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let server: ReturnType<typeof createFakeApiServer>;
let states: AccountState[];

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

/** duas contas no servidor, as duas guardadas no navegador (a última ativa) */
const givenTwoAccounts = async () => {
  await createAccount({ loginKey: ALICE_KEY, remember: true });
  await createAccount({ loginKey: BOB_KEY, remember: true });

  const [alice, bob] = [...server.accounts.keys()];
  return { alice, bob };
};

describe("várias contas no mesmo navegador", () => {
  it("guarda a conta anterior ao entrar em outra", async () => {
    const { alice, bob } = await givenTwoAccounts();

    expect(getActiveSession()?.accountId).toBe(bob);
    expect(appJotaiStore.get(accountsAtom)).toMatchObject([
      { accountId: alice, active: false, resumable: true },
      { accountId: bob, active: true, resumable: true },
    ]);
  });

  it("alterna entre as contas guardadas sem pedir a frase de novo", async () => {
    const { alice, bob } = await givenTwoAccounts();

    await switchAccount(alice);
    expect(getActiveSession()?.accountId).toBe(alice);
    expect(loginKeyOf()).toBe(ALICE_KEY);
    expect(
      appJotaiStore.get(accountsAtom).map((entry) => entry.active),
    ).toEqual([true, false]);

    await switchAccount(bob);
    expect(getActiveSession()?.accountId).toBe(bob);
    expect(loginKeyOf()).toBe(BOB_KEY);
  });

  it("não alterna para uma conta que não guardou a chave", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const alice = [...server.accounts.keys()][0];
    await createAccount({ loginKey: BOB_KEY, remember: true });

    // a Alice continua no servidor, mas não sobrou o que retomar dela aqui
    expect(resumableAccounts().map((entry) => entry.accountId)).not.toContain(
      alice,
    );
    await expect(switchAccount(alice)).rejects.toThrow(
      "account.errors.notRemembered",
    );
  });

  it("sai só da conta ativa e deixa a outra guardada", async () => {
    const { alice } = await givenTwoAccounts();

    logout();

    expect(getActiveSession()).toBeNull();
    expect(states.at(-1)).toEqual({ status: "anonymous", error: null });
    expect(resumableAccounts().map((entry) => entry.accountId)).toEqual([
      alice,
    ]);

    // voltar para a Alice é um clique, sem digitar as 12 palavras
    await switchAccount(alice);
    expect(getActiveSession()?.accountId).toBe(alice);
  });

  it("esquece uma conta a pedido, sem tocar na outra", async () => {
    const { alice, bob } = await givenTwoAccounts();

    forgetAccount(alice);

    expect(resumableAccounts().map((entry) => entry.accountId)).toEqual([bob]);
    // a conta ativa continua sendo a Bob
    expect(getActiveSession()?.accountId).toBe(bob);
  });

  it("retoma a conta ativa quando há várias guardadas", async () => {
    const { alice, bob } = await givenTwoAccounts();
    await switchAccount(alice);

    // simula recarregar a página: módulos novos, mesmo localStorage
    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(freshStates.at(-1)).toMatchObject({ status: "authenticated" });
    expect(fresh.getActiveSession()?.accountId).toBe(alice);
    expect(fresh.resumableAccounts().map((entry) => entry.accountId)).toEqual([
      alice,
      bob,
    ]);

    fresh.logout();
  });

  it("converte o formato antigo, de uma conta só, na lista", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });
    await markLoginKeyRevealed();
    const { accountId } = await deriveAccountKeys(ALICE_KEY);
    const keyRevealedAt = (
      states.at(-1) as Extract<AccountState, { status: "authenticated" }>
    ).remote.keyRevealedAt;

    // o que uma versão anterior do app deixaria no navegador
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT,
      JSON.stringify({
        v: 1,
        accountId,
        loginKey: ALICE_KEY,
        remember: true,
        keyRevealedAt,
      }),
    );

    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    expect(fresh.getActiveSession()?.accountId).toBe(accountId);
    expect(freshStates.at(-1)).toMatchObject({
      status: "authenticated",
      remote: { keyRevealedAt },
    });
    expect(fresh.resumableAccounts()).toHaveLength(1);

    fresh.logout();
  });

  it("descarta o apontador antigo quando a frase não foi guardada", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const { accountId } = await deriveAccountKeys(ALICE_KEY);

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT,
      JSON.stringify({
        v: 1,
        accountId,
        loginKey: null,
        remember: false,
        keyRevealedAt: null,
      }),
    );

    vi.resetModules();
    const fresh = await import("../auth/session");
    const freshStates: AccountState[] = [];
    fresh.bindAccountStore((state: AccountState) => freshStates.push(state));

    await fresh.bootstrapAccount();

    // sem a frase não há sessão para retomar, e o apontador não serve para nada
    expect(freshStates.at(-1)).toEqual({ status: "anonymous", error: null });
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT)).toBeNull();
  });

  it("tirar o 'manter conectado' tira a conta do navegador no próximo load", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    vi.resetModules();
    const fresh = await import("../auth/session");
    fresh.bindAccountStore(() => {});

    await fresh.bootstrapAccount();

    expect(fresh.getActiveSession()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT)).toBeNull();
  });
});
