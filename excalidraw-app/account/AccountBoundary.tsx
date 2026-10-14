import {
  defaultLang,
  languages,
  setLanguage,
  t,
} from "@excalidraw/excalidraw/i18n";
import React, { useEffect, useState } from "react";

import {
  accountAtom,
  type AccountState,
  bindAccountStore,
  bootstrapAccount,
} from "../auth/session";
import { isRemoteStorageEnabled } from "../data/apiClient";
import { useSetAtom } from "../app-jotai";
import { getPreferredLanguage } from "../app-language/language-detector";

import {
  AccountGate,
  AccountKeyConfirmation,
  AccountScreen,
} from "./AccountGate";

/**
 * Porta de entrada do app: enquanto não existe conta ativa, o editor não é
 * montado (não haveria onde salvar). Também é aqui que a sessão salva no
 * navegador é retomada, que é o que permite o login automático.
 *
 * Com `VITE_APP_STORAGE=browser` (testes/dev sem banco) não existe conta: os
 * filhos renderizam direto, como antes.
 */
export const AccountBoundary = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const setAccountState = useSetAtom(accountAtom);

  useEffect(() => {
    // a língua preferida vale também para esta tela, que fica fora do editor
    const preferred = getPreferredLanguage();
    setLanguage(
      languages.find((lang) => lang.code === preferred) ?? defaultLang,
    ).catch((error) => console.warn("[account] idioma não carregado", error));

    bindAccountStore((next) => {
      setState(next);
      // o menu da conta (dentro do editor) lê o mesmo estado pelo atom
      setAccountState(next);
    });

    bootstrapAccount();
  }, [setAccountState]);

  if (state.status === "loading") {
    return (
      <AccountScreen>
        <p className="account-card__text">{t("account.loading")}</p>
      </AccountScreen>
    );
  }

  if (state.status === "anonymous") {
    return <AccountGate error={state.error} />;
  }

  if (state.status === "authenticated" && !state.remote.keyRevealedAt) {
    return <AccountKeyConfirmation />;
  }

  return <>{children}</>;
};

export const isAccountRequired = () => isRemoteStorageEnabled();
