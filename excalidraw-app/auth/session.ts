/**
 * Sessão da conta: criar, entrar, sair e manter conectado.
 *
 * A conta não tem email nem senha — ela *é* a chave de login (frase de 12
 * palavras). Este módulo:
 *
 *   - deriva as chaves da frase (localmente, nunca as envia);
 *   - registra/valida a conta na API (`/api/accounts`, `/api/session`);
 *   - guarda a frase no navegador *somente* quando o usuário pede para manter
 *     conectado (login automático nas próximas visitas);
 *   - mantém as chaves ativas em memória para o resto do app (`apiStorage`,
 *     `LocalData`) cifrar e decifrar.
 *
 * `keyRevealedAt` é o registro, no servidor, de que a chave já foi entregue uma
 * vez: depois disso ela só aparece de novo para quem está logado.
 */
import { atom } from "../app-jotai";
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

const ACCOUNT_STORAGE_VERSION = 1;

type StoredAccount = {
  v: typeof ACCOUNT_STORAGE_VERSION;
  accountId: string;
  /** a frase fica aqui só quando "manter conectado" está ligado */
  loginKey: string | null;
  remember: boolean;
  /** último `keyRevealedAt` visto do servidor, para funcionar offline */
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

export const accountAtom = atom<AccountState>({ status: "loading" });

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

// -----------------------------------------------------------------------------
// storage do navegador
// -----------------------------------------------------------------------------

const readStoredAccount = (): StoredAccount | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredAccount;
    if (parsed?.v !== ACCOUNT_STORAGE_VERSION || !parsed.accountId) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return null;
  }
};

const writeStoredAccount = (account: StoredAccount | null) => {
  try {
    if (account) {
      localStorage.setItem(
        STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT,
        JSON.stringify(account),
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
    }
  } catch (error) {
    console.error(error);
  }
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
      forgetAccount();
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

export const bootstrapAccount = async () => {
  if (!isRemoteStorageEnabled()) {
    setAccountState({ status: "disabled" });
    return;
  }

  const stored = readStoredAccount();

  if (!stored?.loginKey) {
    setAccountState({ status: "anonymous", error: null });
    return;
  }

  try {
    const keys = await deriveAccountKeys(stored.loginKey);

    if (keys.accountId !== stored.accountId) {
      // o que está salvo não corresponde à frase: descarta e pede login
      forgetAccount();
      setAccountState({
        status: "anonymous",
        error: "account.errors.unknownKey",
      });
      return;
    }

    active = {
      accountId: keys.accountId,
      loginKey: normalizeLoginKey(stored.loginKey),
      keys,
      remember: stored.remember,
      remoteKeyRevealedAt: stored.keyRevealedAt,
    };

    setAccountState(authenticatedState(false));
    await refreshAccount();
  } catch (error: any) {
    console.error(error);
    forgetAccount();
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

export const logout = () => {
  forgetAccount();
  setAccountState({ status: "anonymous", error: null });
};

const persistActive = () => {
  if (!active) {
    return;
  }

  writeStoredAccount({
    v: ACCOUNT_STORAGE_VERSION,
    accountId: active.accountId,
    // sem "manter conectado" a frase não fica no navegador: o próximo load
    // volta para a tela de login
    loginKey: active.remember ? active.loginKey : null,
    remember: active.remember,
    keyRevealedAt: active.remoteKeyRevealedAt,
  });
};

const forgetAccount = () => {
  active = null;
  writeStoredAccount(null);
};
