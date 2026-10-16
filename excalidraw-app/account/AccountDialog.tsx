import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React from "react";

import {
  accountAtom,
  accountsAtom,
  forgetAccount,
  loginKeyOf,
} from "../auth/session";
import { useAtom, useAtomValue, useSetAtom } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { signOutActiveAccount, switchToAccount } from "./account-actions";
import { AccountList } from "./AccountList";
import { LoginKeyWords } from "./LoginKeyWords";
import { accountDialogAtom, addingAccountAtom } from "./account-state";

/**
 * Diálogos da conta: ver a chave de login (disponível sempre que o usuário está
 * logado), as contas guardadas neste navegador e a confirmação de saída.
 * Renderizado fora do `<MainMenu>` de propósito — veja `account-state`.
 */
export const AccountDialog = () => {
  const { t, langCode } = useI18n();
  const [dialog, setDialog] = useAtom(accountDialogAtom);
  const account = useAtomValue(accountAtom);
  const accounts = useAtomValue(accountsAtom);
  const setAddingAccount = useSetAtom(addingAccountAtom);
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

  if (dialog === "accounts") {
    if (account.status !== "authenticated") {
      return null;
    }

    /**
     * O editor sai de cena enquanto a conta nova é escolhida, então o que ainda
     * estava para salvar vai para o servidor antes (o save é debounced e
     * passaria a usar a sessão da conta nova).
     */
    const addAccount = async () => {
      await LocalData.flushSaveAsync();
      setAddingAccount(account.remote.accountId);
      closeDialog();
    };

    /** tira a conta do navegador; ela continua no servidor, intacta */
    const removeAccount = (accountId: string) => {
      LocalData.clearAccountData(accountId);
      forgetAccount(accountId);
    };

    return (
      <Dialog
        title={t("account.switch.title")}
        size="small"
        onCloseRequest={closeDialog}
      >
        <p className="account-card__text">{t("account.switch.description")}</p>

        <AccountList
          accounts={accounts}
          renderAction={(entry) =>
            entry.active ? (
              // a conta ativa sai pelo "Sair", que também apaga a cópia local
              <button
                type="button"
                className="account-button account-button--ghost account-button--small"
                onClick={() => setDialog("logout")}
              >
                {t("account.menu.logout")}
              </button>
            ) : (
              <span className="account-list__buttons">
                <button
                  type="button"
                  className="account-button account-button--small"
                  disabled={!entry.resumable}
                  onClick={() => void switchToAccount(entry.accountId)}
                >
                  {t("account.switch.action")}
                </button>
                <button
                  type="button"
                  className="account-button account-button--ghost account-button--small"
                  onClick={() => removeAccount(entry.accountId)}
                >
                  {t("account.switch.remove")}
                </button>
              </span>
            )
          }
        />

        <p className="account-hint">{t("account.switch.removeHint")}</p>

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
            onClick={() => void addAccount()}
          >
            {t("account.switch.add")}
          </button>
        </div>
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
            // apaga a cópia local desta conta antes de esquecer a sessão e, se
            // houver outra conta guardada aqui, ela assume no lugar
            closeDialog();
            void signOutActiveAccount();
          }}
        >
          {t("account.logout.action")}
        </button>
      </div>
    </Dialog>
  );
};
