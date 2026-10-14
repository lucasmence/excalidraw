import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React from "react";

import { accountAtom, loginKeyOf, logout } from "../auth/session";
import { useAtom, useAtomValue } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { LoginKeyWords } from "./LoginKeyWords";
import { accountDialogAtom } from "./account-state";

/**
 * Diálogos da conta: ver a chave de login (disponível sempre que o usuário está
 * logado) e confirmar a saída. Renderizado fora do `<MainMenu>` de propósito —
 * veja `account-state`.
 */
export const AccountDialog = () => {
  const { t, langCode } = useI18n();
  const [dialog, setDialog] = useAtom(accountDialogAtom);
  const account = useAtomValue(accountAtom);
  const closeDialog = () => setDialog(null);

  if (!dialog) {
    return null;
  }

  if (dialog === "key") {
    const loginKey = loginKeyOf();

    if (!loginKey) {
      return null;
    }

    const revealedAt =
      account.status === "authenticated" ? account.remote.keyRevealedAt : null;

    return (
      <Dialog
        title={t("account.dialog.title")}
        size="small"
        onCloseRequest={closeDialog}
      >
        <p className="account-card__text">{t("account.dialog.description")}</p>
        <LoginKeyWords loginKey={loginKey} />
        <p className="account-menu__caption">
          {revealedAt
            ? t("account.dialog.revealedAt", {
                date: new Date(revealedAt).toLocaleString(langCode),
              })
            : t("account.menu.keyNotRevealed")}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={t("account.menu.logout")}
      size="small"
      onCloseRequest={closeDialog}
    >
      <p className="account-card__text">{t("account.logout.confirm")}</p>
      <div className="account-dialog__actions">
        <button
          type="button"
          className="account-button account-button--ghost"
          onClick={closeDialog}
        >
          {t("account.dialog.close")}
        </button>
        <button
          type="button"
          className="account-button"
          onClick={() => {
            // apaga a cópia local desta conta antes de esquecer a sessão
            LocalData.clearAccountData();
            logout();
            closeDialog();
          }}
        >
          {t("account.logout.action")}
        </button>
      </div>
    </Dialog>
  );
};
