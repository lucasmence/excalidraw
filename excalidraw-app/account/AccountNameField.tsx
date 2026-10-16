import { t } from "@excalidraw/excalidraw/i18n";
import React, { useState } from "react";

import { ACCOUNT_NAME_MAX_LENGTH, renameAccount } from "../auth/session";

/**
 * Apelido da conta, editável ao lado da chave de login.
 *
 * O apelido nasce depois da conta: é aqui, vendo a chave, que o usuário batiza
 * a conta para reconhecê-la na troca. Ele fica só neste navegador (é rótulo de
 * interface, não dado da conta), então salvar é gravar local — sem requisição e
 * sem recarga, que é o que o resto da conta exige.
 */
export const AccountNameField = ({
  accountId,
  name,
}: {
  accountId: string;
  name: string | null;
}) => {
  const [draft, setDraft] = useState(name ?? "");

  // só habilita o salvar quando o que está no campo muda o que já está gravado
  const dirty = draft.trim() !== (name ?? "");

  const save = () => {
    renameAccount(accountId, draft);
  };

  return (
    <div className="account-name">
      <label className="account-name__label" htmlFor="account-name-input">
        {t("account.name.label")}
      </label>
      <div className="account-name__row">
        <input
          id="account-name-input"
          className="account-name__input"
          type="text"
          value={draft}
          maxLength={ACCOUNT_NAME_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("account.name.placeholder")}
          aria-label={t("account.name.label")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          data-testid="account-name-input"
        />
        <button
          type="button"
          className="account-button account-button--small"
          disabled={!dirty}
          onClick={save}
          data-testid="account-name-save"
        >
          {t("account.name.save")}
        </button>
      </div>
      <p className="account-hint">{t("account.name.hint")}</p>
    </div>
  );
};
