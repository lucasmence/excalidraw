import { LockedIcon } from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React from "react";

import { accountsAtom, accountAtom, rememberSession } from "../auth/session";
import { useAtomValue, useSetAtom } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { AccountAvatar } from "./AccountList";
import {
  accountDialogAtom,
  addingAccountAtom,
  accountLabel,
} from "./account-state";

const formatDate = (value: string, langCode: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(langCode);
};

/**
 * Bloco de conta no menu: identificação, "manter conectado" e os atalhos para
 * alternar/adicionar conta, ver a chave de login e sair. Os diálogos em si são
 * renderizados fora do menu (veja `AccountDialog`), porque o conteúdo do menu é
 * desmontado ao selecionar um item.
 */
export const AccountMenuItems = () => {
  const { t, langCode } = useI18n();
  const account = useAtomValue(accountAtom);
  const accounts = useAtomValue(accountsAtom);
  const setDialog = useSetAtom(accountDialogAtom);
  const setAddingAccount = useSetAtom(addingAccountAtom);

  if (account.status !== "authenticated") {
    return null;
  }

  /**
   * Abrir o modo "adicionar conta" tira o editor da tela, então o que ainda
   * estava para salvar vai para o servidor antes: o save é debounced e passaria
   * a usar a sessão da conta nova.
   */
  const addAccount = async () => {
    await LocalData.flushSaveAsync();
    setAddingAccount(account.remote.accountId);
  };

  return (
    <>
      <MainMenu.Separator />
      <MainMenu.ItemCustom>
        <div className="account-menu">
          <div className="account-menu__title">{t("account.menu.section")}</div>
          <div className="account-menu__account">
            <AccountAvatar
              accountId={account.remote.accountId}
              name={account.remote.name}
            />
            <div
              className={`account-menu__id${
                account.remote.name ? " account-menu__id--name" : ""
              }`}
              title={account.remote.accountId}
            >
              {accountLabel(account.remote)}
            </div>
          </div>
          <div className="account-menu__caption">
            {account.remote.keyRevealedAt
              ? t("account.menu.keyRevealedAt", {
                  date: formatDate(account.remote.keyRevealedAt, langCode),
                })
              : t("account.menu.keyNotRevealed")}
          </div>
          {account.offline && (
            <div className="account-menu__offline">
              {t("account.menu.offline")}
            </div>
          )}
          <label className="account-checkbox account-checkbox--menu">
            <input
              type="checkbox"
              checked={account.remote.remember}
              onChange={(event) => rememberSession(event.target.checked)}
            />
            <span>{t("account.menu.remember")}</span>
          </label>
        </div>
      </MainMenu.ItemCustom>

      {accounts.length > 1 && (
        <MainMenu.Item onSelect={() => setDialog("accounts")}>
          {t("account.menu.switch")}
        </MainMenu.Item>
      )}

      <MainMenu.Item onSelect={() => void addAccount()}>
        {t("account.menu.addAccount")}
      </MainMenu.Item>

      <MainMenu.Item icon={LockedIcon} onSelect={() => setDialog("key")}>
        {t("account.menu.viewKey")}
      </MainMenu.Item>

      <MainMenu.Item onSelect={() => setDialog("logout")}>
        {t("account.menu.logout")}
      </MainMenu.Item>
    </>
  );
};
