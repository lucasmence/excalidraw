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
import { useAtom, useSetAtom } from "../app-jotai";
import { getPreferredLanguage } from "../app-language/language-detector";

import { addingAccountAtom } from "./account-state";
import { reloadApp } from "./reload";
import {
  AccountGate,
  AccountKeyConfirmation,
  AccountScreen,
} from "./AccountGate";

/**
 * Porta de entrada do app: enquanto não existe conta ativa, o editor não é
 * montado (não haveria onde salvar). Também é aqui que a sessão salva no
 * navegador é retomada, que é o que permite o login automático, e onde vive o
 * modo "adicionar conta".
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
  const [addingFrom, setAddingFrom] = useAtom(addingAccountAtom);

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

  // Modo "adicionar conta": a tela de conta toma o lugar do editor — a conta
  // atual não pode salvar nada no meio da troca. Assim que a conta nova entra,
  // o app recarrega: cena, abas e biblioteca são de uma conta só.
  if (addingFrom) {
    return (
      <AccountGate
        error={null}
        adding
        onCancel={() => setAddingFrom(null)}
        onAuthenticated={reloadApp}
      />
    );
  }

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
