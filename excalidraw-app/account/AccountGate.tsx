import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { t } from "@excalidraw/excalidraw/i18n";
import React, { useState } from "react";

import { useAtomValue } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";
import { generateLoginKey, isValidLoginKey } from "../auth/keys";
import {
  AccountCreationDisabledError,
  accountCreationOpenAtom,
  createAccount,
  login,
  LoginKeyTakenError,
  loginKeyOf,
  markLoginKeyRevealed,
} from "../auth/session";
import { ApiError } from "../data/apiClient";

import { LoginKeyWords } from "./LoginKeyWords";

/**
 * Tema do app, lido antes do editor montar. A tela de conta fica fora do
 * editor, então usa `t()` direto em vez de `useI18n()` (que só existe dentro
 * dele) — o idioma preferido é aplicado pelo `AccountBoundary`.
 */
export const useAccountTheme = () => {
  const [theme] = useState<"dark" | "light">(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
      if (stored === "dark" || stored === "light") {
        return stored;
      }
    } catch (error) {
      // sem localStorage: cai para a preferência do sistema
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  });

  return theme;
};

export const AccountScreen = ({ children }: { children: React.ReactNode }) => (
  <div className="account-screen" data-theme={useAccountTheme()}>
    <div className="account-card">
      <div className="account-card__logo">
        <ExcalidrawLogo withText />
      </div>
      {children}
    </div>
  </div>
);

/**
 * Traduz o erro para algo que o usuário entenda. Alguns erros chegam como chave
 * de tradução (`account.errors.*`), outros são mensagem crua da API.
 */
const describeAccountError = (error: unknown) => {
  if (error instanceof LoginKeyTakenError) {
    return t("account.create.taken");
  }
  if (error instanceof AccountCreationDisabledError) {
    return t("account.create.disabled");
  }
  if (error instanceof ApiError && error.status === 401) {
    return t("account.login.unknown");
  }
  if (error instanceof Error && error.message === "account.errors.invalidKey") {
    return t("account.login.invalid");
  }
  if (error instanceof Error && error.message === "account.errors.unknownKey") {
    return t("account.errors.unknownKey");
  }
  return error instanceof Error ? error.message : String(error);
};

const RememberCheckbox = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="account-checkbox">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>
      {t("account.remember.label")}
      <small>{t("account.remember.hint")}</small>
    </span>
  </label>
);

const ConfirmCheckbox = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="account-checkbox">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>{t("account.create.confirm")}</span>
  </label>
);

const CreateAccount = ({
  onKeyAlreadyExists,
}: {
  onKeyAlreadyExists: (loginKey: string) => void;
}) => {
  const [loginKey, setLoginKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!loginKey || !confirmed || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await createAccount({ loginKey, remember });
      // o usuário acabou de confirmar que anotou: a entrega já fica registrada
      // no servidor e a tela de confirmação não aparece de novo
      await markLoginKeyRevealed();
    } catch (err) {
      setError(describeAccountError(err));
      if (err instanceof LoginKeyTakenError) {
        onKeyAlreadyExists(loginKey);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="account-card__title">{t("account.create.title")}</h1>
      <p className="account-card__text">{t("account.description")}</p>

      {!loginKey && (
        <button
          type="button"
          className="account-button"
          onClick={() => setLoginKey(generateLoginKey())}
        >
          {t("account.create.action")}
        </button>
      )}

      {loginKey && (
        <>
          <p className="account-card__text">
            {t("account.create.instructions")}
          </p>
          <LoginKeyWords loginKey={loginKey} />
          <p className="account-warning">{t("account.create.warning")}</p>

          <ConfirmCheckbox checked={confirmed} onChange={setConfirmed} />
          <RememberCheckbox checked={remember} onChange={setRemember} />

          <button
            type="button"
            className="account-button"
            disabled={!confirmed || busy}
            onClick={submit}
          >
            {busy ? t("account.create.creating") : t("account.create.continue")}
          </button>
        </>
      )}

      {error && <p className="account-error">{error}</p>}
    </>
  );
};

const LoginAccount = ({
  initialLoginKey = "",
}: {
  initialLoginKey?: string;
}) => {
  const [value, setValue] = useState(initialLoginKey);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidLoginKey(value);

  const submit = async () => {
    if (!valid || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await login({ loginKey: value, remember });
    } catch (err) {
      setError(describeAccountError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="account-card__title">{t("account.login.title")}</h1>
      <p className="account-card__text">{t("account.login.description")}</p>

      <textarea
        className="account-input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        rows={3}
        placeholder={t("account.login.placeholder")}
        aria-label={t("account.login.title")}
        onChange={(event) => setValue(event.target.value)}
      />

      <RememberCheckbox checked={remember} onChange={setRemember} />

      <button
        type="button"
        className="account-button"
        disabled={!valid || busy}
        onClick={submit}
      >
        {busy ? t("account.login.signingIn") : t("account.login.action")}
      </button>

      {value && !valid && !error && (
        <p className="account-hint">{t("account.login.invalid")}</p>
      )}
      {error && <p className="account-error">{error}</p>}
    </>
  );
};

/**
 * Primeira tela do app: sem conta não existe editor (não haveria onde salvar).
 * Aqui o usuário cria a conta — recebendo a chave de login uma única vez — ou
 * entra com uma chave que já tem.
 */
export const AccountGate = ({ error }: { error: string | null }) => {
  const [mode, setMode] = useState<"welcome" | "create" | "login">("welcome");
  const [prefilledKey, setPrefilledKey] = useState("");
  /**
   * `false` enquanto o servidor não disser o contrário: a criação de contas só
   * é oferecida com uma resposta positiva do `/api/health` (veja
   * `accountCreationOpenAtom`), em qualquer das telas.
   */
  const creationOpen = useAtomValue(accountCreationOpenAtom);

  if (mode === "create") {
    return (
      <AccountScreen>
        <CreateAccount
          onKeyAlreadyExists={(loginKey) => {
            setPrefilledKey(loginKey);
            setMode("login");
          }}
        />
        <button
          type="button"
          className="account-link"
          onClick={() => setMode("login")}
        >
          {t("account.login.action")}
        </button>
      </AccountScreen>
    );
  }

  if (mode === "login") {
    return (
      <AccountScreen>
        <LoginAccount initialLoginKey={prefilledKey} />
        {/* a criação fechada também não pode ser oferecida daqui: era por este
            link que a tela de login mostrava "criar conta" numa instância que a
            API só aceita entrar com a chave que já existe */}
        {creationOpen ? (
          <button
            type="button"
            className="account-link"
            onClick={() => setMode("create")}
          >
            {t("account.create.title")}
          </button>
        ) : (
          <p className="account-hint">{t("account.create.disabled")}</p>
        )}
      </AccountScreen>
    );
  }

  return (
    <AccountScreen>
      <h1 className="account-card__title">{t("account.subtitle")}</h1>
      <p className="account-card__text">{t("account.description")}</p>

      {creationOpen ? (
        <button
          type="button"
          className="account-button"
          onClick={() => setMode("create")}
        >
          {t("account.create.title")}
        </button>
      ) : (
        <p className="account-hint">{t("account.create.disabled")}</p>
      )}
      <button
        type="button"
        className="account-button account-button--ghost"
        onClick={() => setMode("login")}
      >
        {t("account.login.action")}
      </button>

      {error && (
        <p className="account-error">
          {error === "account.errors.unknownKey"
            ? t("account.errors.unknownKey")
            : error}
        </p>
      )}
    </AccountScreen>
  );
};

/**
 * Enquanto o servidor não registrar que a chave já foi entregue, o app mostra a
 * frase de novo e pede a confirmação — é o "a chave aparece uma vez" do fluxo,
 * para quem fechou a aba antes de anotar.
 */
export const AccountKeyConfirmation = () => {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loginKey = loginKeyOf();

  if (!loginKey) {
    return null;
  }

  const submit = async () => {
    setBusy(true);
    await markLoginKeyRevealed();
    setBusy(false);
  };

  return (
    <AccountScreen>
      <h1 className="account-card__title">{t("account.dialog.title")}</h1>
      <p className="account-card__text">{t("account.create.instructions")}</p>

      <LoginKeyWords loginKey={loginKey} />

      <p className="account-warning">{t("account.create.warning")}</p>

      <ConfirmCheckbox checked={confirmed} onChange={setConfirmed} />

      <button
        type="button"
        className="account-button"
        disabled={!confirmed || busy}
        onClick={submit}
      >
        {busy ? t("account.create.creating") : t("account.create.continue")}
      </button>
    </AccountScreen>
  );
};
