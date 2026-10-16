import { t } from "@excalidraw/excalidraw/i18n";
import clsx from "clsx";
import React from "react";

import { accountColor, accountInitials, accountLabel } from "./account-state";

import type { StoredAccountInfo } from "../auth/session";

/**
 * Avatar da conta: as iniciais do apelido (ou do id, sem apelido), na cor fixa
 * daquela conta.
 */
export const AccountAvatar = ({
  accountId,
  name,
}: {
  accountId: string;
  name?: string | null;
}) => (
  <span
    className="account-avatar"
    style={{ background: accountColor(accountId) }}
    aria-hidden="true"
  >
    {accountInitials(name || accountId)}
  </span>
);

/**
 * Lista de contas guardadas neste navegador, ao estilo do seletor de contas do
 * Google: cada linha se identifica e diz se dá para entrar nela sem digitar a
 * chave; a ação de cada uma quem coloca é o chamador (a tela de conta só
 * alterna, o diálogo também remove).
 */
export const AccountList = ({
  accounts,
  renderAction,
}: {
  accounts: StoredAccountInfo[];
  renderAction?: (account: StoredAccountInfo) => React.ReactNode;
}) => (
  <ul className="account-list">
    {accounts.map((account) => (
      <li key={account.accountId} className="account-list__item">
        <AccountAvatar accountId={account.accountId} name={account.name} />
        <span className="account-list__info">
          <span
            className={clsx("account-list__id", {
              "account-list__id--name": account.name,
            })}
            title={account.accountId}
          >
            {accountLabel(account)}
          </span>
          <span className="account-list__meta">
            {account.active
              ? t("account.switch.current")
              : account.resumable
              ? t("account.switch.ready")
              : t("account.switch.needsKey")}
          </span>
        </span>
        {renderAction && (
          <span className="account-list__action">{renderAction(account)}</span>
        )}
      </li>
    ))}
  </ul>
);
