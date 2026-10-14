import { LockedIcon } from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React from "react";

import { useAtomValue, useSetAtom } from "../app-jotai";
import { accountAtom, rememberSession } from "../auth/session";

import { accountDialogAtom } from "./account-state";

const shortAccountId = (accountId: string) =>
  `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;

const formatDate = (value: string, langCode: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(langCode);
};

/**
 * Bloco de conta no menu: identificação, "manter conectado" e os atalhos para
 * ver a chave de login e sair. Os diálogos em si são renderizados fora do menu
 * (veja `AccountDialog`), porque o conteúdo do menu é desmontado ao selecionar
 * um item.
 */
export const AccountMenuItems = () => {
  const { t, langCode } = useI18n();
  const account = useAtomValue(accountAtom);
  const setDialog = useSetAtom(accountDialogAtom);

  if (account.status !== "authenticated") {
    return null;
  }

  return (
    <>
      <MainMenu.Separator />
      <MainMenu.ItemCustom>
        <div className="account-menu">
          <div className="account-menu__title">{t("account.menu.section")}</div>
          <div className="account-menu__id" title={account.remote.accountId}>
            {shortAccountId(account.remote.accountId)}
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

      <MainMenu.Item icon={LockedIcon} onSelect={() => setDialog("key")}>
        {t("account.menu.viewKey")}
      </MainMenu.Item>

      <MainMenu.Item onSelect={() => setDialog("logout")}>
        {t("account.menu.logout")}
      </MainMenu.Item>
    </>
  );
};
