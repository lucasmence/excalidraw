/**
 * Sessão da conta: criar, entrar, sair, alternar e manter conectado.
 *
 * A conta não tem email nem senha — ela *é* a chave de login (frase de 12
 * palavras). Este módulo:
 *
 *   - deriva as chaves da frase (localmente, nunca as envia);
 *   - registra/valida a conta na API (`/api/accounts`, `/api/session`);
 *   - guarda a frase no navegador *somente* quando o usuário pede para manter
 *     conectado (o que dá login automático e a troca rápida entre contas);
 *   - mantém as chaves ativas em memória para o resto do app (`apiStorage`,
 *     `LocalData`) cifrar e decifrar.
 *
 * Várias contas podem ficar guardadas no mesmo navegador, ao estilo das contas
 * do Google: a lista vive em `LOCAL_STORAGE_ACCOUNT` e `activeAccountId` diz
 * qual delas está valendo. Só uma fica ativa por vez — trocar de conta passa
 * por um reload do app (ver `account/account-actions`), porque cena, abas,
 * biblioteca e sala de colaboração pertencem a uma conta só.
 *
 * `keyRevealedAt` é o registro, no servidor, de que a chave já foi entregue uma
 * vez: depois disso ela só aparece de novo para quem está logado.
 */
import { appJotaiStore, atom } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";

import {
  AUTH_TIMEOUT_MS,
  api,
  ApiError,
  isRemoteStorageEnabled,
} from "../data/apiClient";

import {
  deriveAccountKeys,
  isValidLoginKey,
  normalizeLoginKey,
  type AccountKeys,
} from "./keys";

/** formato atual do que fica no navegador (a versão 1 guardava uma conta só) */
const ACCOUNT_STORAGE_VERSION = 2;
const LEGACY_ACCOUNT_STORAGE_VERSION = 1;

/** uma conta como ela fica guardada; a frase só existe quando foi lembrada */
type StoredAccount = {
  accountId: string;
  /** `null` quando "manter conectado" está desligado nesta conta */
  loginKey: string | null;
  remember: boolean;
  /** último `keyRevealedAt` visto do servidor, para funcionar offline */
  keyRevealedAt: string | null;
};

type StoredAccounts = {
  v: typeof ACCOUNT_STORAGE_VERSION;
  activeAccountId: string | null;
  accounts: StoredAccount[];
};

/** a conta como a interface precisa vê-la (sem a frase, que nunca sai daqui) */
export type StoredAccountInfo = {
  accountId: string;
  active: boolean;
  /** a frase está guardada: dá para alternar sem digitar as 12 palavras */
  resumable: boolean;
  remember: boolean;
  keyRevealedAt: string | null;
};

export type AccountState =
  | { status: "loading" }
  | { status: "anonymous"; error: string | null }
  | { status: "authenticated"; offline: boolean; remote: RemoteAccountInfo }
  | { status: "disabled" };

export type RemoteAccountInfo = {
  accountId: string;
  keyRevealedAt: string | null;
  remember: boolean;
};

type ActiveSession = {
  accountId: string;
  loginKey: string;
  keys: AccountKeys;
  remember: boolean;
  /** último `keyRevealedAt` que o servidor informou (usado offline) */
  remoteKeyRevealedAt: string | null;
};

/** chave já existe no servidor: em vez de criar, o usuário deve entrar */
export class LoginKeyTakenError extends Error {
  constructor() {
    super("Login key already registered");
    this.name = "LoginKeyTakenError";
  }
}

/**
 * Instância com a criação fechada (`ALLOW_ACCOUNT_CREATION=false`): já existe
 * uma conta, então a única saída é entrar com a chave dela.
 */
export class AccountCreationDisabledError extends Error {
  constructor() {
    super("Account creation is disabled");
    this.name = "AccountCreationDisabledError";
  }
}

/** chave que a API devolve em `POST /accounts` quando a criação está fechada */
const CREATION_DISABLED_KEY = "account.errors.creationDisabled";

export const accountAtom = atom<AccountState>({ status: "loading" });

/** contas guardadas neste navegador, para a interface listar/alternar */
export const accountsAtom = atom<StoredAccountInfo[]>([]);

/**
 * O servidor informou que dá para criar conta?
 *
 * Começa em `false` ("não sei") de propósito: o botão de criar conta só aparece
 * com uma resposta positiva do `/api/health`. Antes começava em `true`, então
 * uma resposta que não chegava — ou um servidor antigo, sem esse campo — deixava
 * a tela oferecendo uma conta que a API ia recusar.
 */
export const accountCreationOpenAtom = atom(false);

let active: ActiveSession | null = null;

export const getActiveSession = () => active;

/** usado por apiStorage/LocalData: sem conta não há o que cifrar */
export const requireActiveSession = () => {
  if (!active) {
    throw new Error("Nenhuma conta ativa");
  }
  return active;
};

export const loginKeyOf = () => active?.loginKey ?? null;

/**
 * Sala de colaboração fixa da conta ativa: o app sempre abre essa sala, e como
 * o par vem da frase o link é sempre o mesmo. `null` quando não há conta (nos
 * testes/dev com `VITE_APP_STORAGE=browser` não existe sala automática).
 */
export const collabRoomOf = (): { roomId: string; roomKey: string } | null =>
  active
    ? {
        roomId: active.keys.collabRoomId,
        roomKey: active.keys.collabRoomKey,
      }
    : null;

// -----------------------------------------------------------------------------
// storage do navegador
// -----------------------------------------------------------------------------

const emptyStoredAccounts = (): StoredAccounts => ({
  v: ACCOUNT_STORAGE_VERSION,
  activeAccountId: null,
  accounts: [],
});

const normalizeStoredAccount = (value: any): StoredAccount | null => {
  if (!value || typeof value.accountId !== "string" || !value.accountId) {
    return null;
  }

  return {
    accountId: value.accountId,
    loginKey: typeof value.loginKey === "string" ? value.loginKey : null,
    remember: !!value.remember,
    keyRevealedAt:
      typeof value.keyRevealedAt === "string" ? value.keyRevealedAt : null,
  };
};

/**
 * Lê a lista de contas do navegador. O formato antigo (uma conta só, na versão
 * 1) é convertido na hora — quem já usava o app não perde a sessão.
 */
const readStoredAccounts = (): StoredAccounts => {
  let raw: string | null = null;

  try {
    raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
  } catch (error) {
    console.error(error);
    return emptyStoredAccounts();
  }

  if (!raw) {
    return emptyStoredAccounts();
  }

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed?.v === ACCOUNT_STORAGE_VERSION &&
      Array.isArray(parsed.accounts)
    ) {
      const accounts = parsed.accounts
        .map(normalizeStoredAccount)
        .filter(Boolean) as StoredAccount[];

      const activeAccountId = accounts.some(
        (account) => account.accountId === parsed.activeAccountId,
      )
        ? (parsed.activeAccountId as string)
        : null;

      return { v: ACCOUNT_STORAGE_VERSION, activeAccountId, accounts };
    }

    if (parsed?.v === LEGACY_ACCOUNT_STORAGE_VERSION && parsed?.accountId) {
      const account = normalizeStoredAccount(parsed);

      // sem a frase guardada não existe sessão para retomar — e um apontador
      // para uma conta que ninguém consegue abrir não serve para nada
      if (!account?.loginKey) {
        return emptyStoredAccounts();
      }

      return {
        v: ACCOUNT_STORAGE_VERSION,
        activeAccountId: account.accountId,
        accounts: [account],
      };
    }
  } catch (error) {
    console.error(error);
  }

  return emptyStoredAccounts();
};

const writeStoredAccounts = (stored: StoredAccounts) => {
  try {
    if (!stored.accounts.length) {
      // sem contas não fica nem o rastro da chave no navegador
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
      return;
    }

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT,
      JSON.stringify(stored),
    );
  } catch (error) {
    console.error(error);
  }
};

const toAccountInfo = (stored: StoredAccounts): StoredAccountInfo[] =>
  stored.accounts.map((account) => ({
    accountId: account.accountId,
    active: account.accountId === stored.activeAccountId,
    resumable: account.loginKey !== null,
    remember: account.remember,
    keyRevealedAt: account.keyRevealedAt,
  }));

/** publica a lista no atom para a interface (menu, seletor) acompanhar */
const publishAccounts = (stored = readStoredAccounts()) => {
  appJotaiStore.set(accountsAtom, toAccountInfo(stored));
};

/** contas guardadas que dá para reabrir sem digitar as 12 palavras de novo */
export const resumableAccounts = (): StoredAccountInfo[] =>
  toAccountInfo(readStoredAccounts()).filter((account) => account.resumable);

const entryOf = (session: ActiveSession): StoredAccount => ({
  accountId: session.accountId,
  // sem "manter conectado" a frase não fica no navegador
  loginKey: session.remember ? session.loginKey : null,
  remember: session.remember,
  keyRevealedAt: session.remoteKeyRevealedAt,
});

/** insere ou atualiza a conta mantendo a posição dela na lista */
const upsertAccount = (
  accounts: StoredAccount[],
  entry: StoredAccount,
): StoredAccount[] => {
  const index = accounts.findIndex(
    (account) => account.accountId === entry.accountId,
  );

  if (index === -1) {
    return [...accounts, entry];
  }

  return accounts.map((account, i) => (i === index ? entry : account));
};

/**
 * A lista guardada é feita das contas lembradas mais a conta ativa. Uma conta
 * que perdeu a frase (e não está ativa) sai daqui: não haveria como voltar para
 * ela sem digitar as 12 palavras, e um item sem serventia é pior que nenhum.
 */
const keepAccounts = (
  accounts: StoredAccount[],
  session: ActiveSession | null,
) => {
  const kept = accounts.filter(
    (account) =>
      account.loginKey !== null || account.accountId === session?.accountId,
  );

  return session ? upsertAccount(kept, entryOf(session)) : kept;
};

const removeStoredAccount = (accountId: string) => {
  const stored = readStoredAccounts();

  const remaining: StoredAccounts = {
    v: ACCOUNT_STORAGE_VERSION,
    activeAccountId:
      stored.activeAccountId === accountId ? null : stored.activeAccountId,
    accounts: stored.accounts.filter(
      (account) => account.accountId !== accountId,
    ),
  };

  writeStoredAccounts(remaining);
  publishAccounts(remaining);
};

// estado em memória + atom ------------------------------------------------------------------

let setAccountState: (state: AccountState) => void = () => {};

/** liga o módulo ao atom (chamado uma vez pelo AccountBoundary) */
export const bindAccountStore = (setter: (state: AccountState) => void) => {
  setAccountState = setter;
};

const remoteInfo = (): RemoteAccountInfo => ({
  accountId: active!.accountId,
  keyRevealedAt: active!.remoteKeyRevealedAt,
  remember: active!.remember,
});

const authenticatedState = (offline: boolean): AccountState => ({
  status: "authenticated",
  offline,
  remote: remoteInfo(),
});

// -----------------------------------------------------------------------------
// API
// -----------------------------------------------------------------------------

type SessionResponse = { accountId: string; keyRevealedAt: string | null };

/** confirma a sessão com o servidor; offline continua valendo */
export const refreshAccount = async () => {
  if (!active) {
    return;
  }

  try {
    const data = await api.get<SessionResponse>(
      "/session",
      active.keys.authSecret,
      AUTH_TIMEOUT_MS,
    );
    active.remoteKeyRevealedAt = data.keyRevealedAt;
    persistActive();
    setAccountState(authenticatedState(false));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // a conta não existe mais neste servidor
      forgetActiveAccount();
      setAccountState({
        status: "anonymous",
        error: "account.errors.unknownKey",
      });
      return;
    }
    // servidor fora do ar: segue com a cópia local
    setAccountState(authenticatedState(true));
  }
};

/**
 * Pergunta ao servidor se a criação de contas está aberta — sem isso a tela de
 * entrada ofereceria criar uma conta que a API vai recusar. Não bloqueia o
 * boot: se o servidor estiver fora do ar, o atom fica em `false` (a tela não
 * oferece criar conta) e o erro aparece na hora de criar.
 */
const refreshAccountCreationOpen = async () => {
  try {
    const health = await api.get<{ accountCreationOpen?: boolean }>(
      "/health",
      null,
      AUTH_TIMEOUT_MS,
    );

    if (typeof health?.accountCreationOpen === "boolean") {
      appJotaiStore.set(accountCreationOpenAtom, health.accountCreationOpen);
    }
  } catch (error) {
    console.warn(
      "[account] não consegui saber se a criação de contas está aberta",
      error,
    );
  }
};

export const bootstrapAccount = async () => {
  if (!isRemoteStorageEnabled()) {
    setAccountState({ status: "disabled" });
    return;
  }

  void refreshAccountCreationOpen();

  const stored = readStoredAccounts();
  // regrava no formato atual: o que estava no formato antigo (uma conta só)
  // sai daqui já convertido, e o que não dá mais para retomar sai daqui limpo
  writeStoredAccounts(stored);
  publishAccounts(stored);

  const activeEntry = stored.accounts.find(
    (account) => account.accountId === stored.activeAccountId,
  );

  if (!activeEntry?.loginKey) {
    // sem a frase não existe sessão para retomar: sobra só o apontador de uma
    // conta que não foi lembrada, e esse apontador não serve para nada (a conta
    // em si continua no servidor)
    if (activeEntry) {
      removeStoredAccount(activeEntry.accountId);
    }
    setAccountState({ status: "anonymous", error: null });
    return;
  }

  try {
    const keys = await deriveAccountKeys(activeEntry.loginKey);

    if (keys.accountId !== activeEntry.accountId) {
      // o que está salvo não corresponde à frase: descarta e pede login
      removeStoredAccount(activeEntry.accountId);
      setAccountState({
        status: "anonymous",
        error: "account.errors.unknownKey",
      });
      return;
    }

    active = {
      accountId: keys.accountId,
      loginKey: normalizeLoginKey(activeEntry.loginKey),
      keys,
      remember: activeEntry.remember,
      remoteKeyRevealedAt: activeEntry.keyRevealedAt,
    };

    setAccountState(authenticatedState(false));
    await refreshAccount();
  } catch (error: any) {
    console.error(error);
    removeStoredAccount(activeEntry.accountId);
    setAccountState({
      status: "anonymous",
      error: "account.errors.unknownKey",
    });
  }
};

export const createAccount = async ({
  loginKey,
  remember,
}: {
  loginKey: string;
  remember: boolean;
}) => {
  const mnemonic = normalizeLoginKey(loginKey);

  if (!isValidLoginKey(mnemonic)) {
    throw new Error("account.errors.invalidKey");
  }

  const keys = await deriveAccountKeys(mnemonic);

  try {
    await api.post(
      "/accounts",
      { accountId: keys.accountId, authSecret: keys.authSecret },
      null,
      AUTH_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new LoginKeyTakenError();
    }
    if (
      error instanceof ApiError &&
      error.message.includes(CREATION_DISABLED_KEY)
    ) {
      throw new AccountCreationDisabledError();
    }
    throw error;
  }

  active = {
    accountId: keys.accountId,
    loginKey: mnemonic,
    keys,
    remember,
    remoteKeyRevealedAt: null,
  };
  persistActive();
  setAccountState(authenticatedState(false));
};

export const login = async ({
  loginKey,
  remember,
}: {
  loginKey: string;
  remember: boolean;
}) => {
  const mnemonic = normalizeLoginKey(loginKey);

  if (!isValidLoginKey(mnemonic)) {
    throw new Error("account.errors.invalidKey");
  }

  const keys = await deriveAccountKeys(mnemonic);
  const data = await api.post<SessionResponse>(
    "/session",
    { accountId: keys.accountId, authSecret: keys.authSecret },
    null,
    AUTH_TIMEOUT_MS,
  );

  active = {
    accountId: data.accountId,
    loginKey: mnemonic,
    keys,
    remember,
    remoteKeyRevealedAt: data.keyRevealedAt,
  };
  persistActive();
  setAccountState(authenticatedState(false));
};

/**
 * Troca a conta ativa por outra já guardada neste navegador.
 *
 * Não encosta na cena em memória: quem chama deve recarregar o app depois (ver
 * `switchToAccount`). Sem a frase guardada não há como entrar sem digitá-la.
 */
export const switchAccount = async (accountId: string) => {
  const stored = readStoredAccounts();
  const account = stored.accounts.find(
    (entry) => entry.accountId === accountId,
  );

  if (!account?.loginKey) {
    throw new Error("account.errors.notRemembered");
  }

  const keys = await deriveAccountKeys(account.loginKey);

  if (keys.accountId !== accountId) {
    // registro corrompido: a frase salva não é a desta conta
    removeStoredAccount(accountId);
    throw new Error("account.errors.unknownKey");
  }

  active = {
    accountId,
    loginKey: normalizeLoginKey(account.loginKey),
    keys,
    remember: account.remember,
    remoteKeyRevealedAt: account.keyRevealedAt,
  };

  persistActive();
  setAccountState(authenticatedState(false));
};

/** tira uma conta do navegador sem mexer na sessão ativa (nem no servidor) */
export const forgetAccount = (accountId: string) => {
  if (active?.accountId === accountId) {
    forgetActiveAccount();
    return;
  }
  removeStoredAccount(accountId);
};

/** registra no servidor que a chave já foi mostrada (só a primeira vez conta) */
export const markLoginKeyRevealed = async () => {
  if (!active) {
    return;
  }

  try {
    const data = await api.post<{ keyRevealedAt: string | null }>(
      "/session/key-revealed",
      undefined,
      active.keys.authSecret,
      AUTH_TIMEOUT_MS,
    );
    active.remoteKeyRevealedAt = data.keyRevealedAt;
  } catch (error) {
    // offline: a marca vale como local e será refeita no próximo login
    console.warn("[account] não consegui registrar a entrega da chave", error);
    active.remoteKeyRevealedAt = new Date().toISOString();
  }

  persistActive();
  setAccountState(authenticatedState(false));
};

export const rememberSession = (remember: boolean) => {
  if (!active) {
    return;
  }
  active.remember = remember;
  persistActive();
  setAccountState(authenticatedState(false));
};

/**
 * Sai da conta ativa (as outras contas do navegador continuam guardadas) e
 * devolve a lista que sobrou, para quem chamou decidir para onde ir.
 */
export const logout = () => {
  forgetActiveAccount();
  setAccountState({ status: "anonymous", error: null });
  return toAccountInfo(readStoredAccounts());
};

/** esquece a sessão ativa e tira ela da lista do navegador */
const forgetActiveAccount = () => {
  const accountId = active?.accountId ?? null;
  active = null;

  if (accountId) {
    removeStoredAccount(accountId);
  } else {
    publishAccounts();
  }
};

const persistActive = () => {
  const stored = readStoredAccounts();

  const next: StoredAccounts = {
    v: ACCOUNT_STORAGE_VERSION,
    activeAccountId: active?.accountId ?? null,
    accounts: keepAccounts(stored.accounts, active),
  };

  writeStoredAccounts(next);
  publishAccounts(next);
};
