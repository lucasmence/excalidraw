import { t } from "@excalidraw/excalidraw/i18n";
import React, { useState } from "react";

/**
 * Mostra a chave de login como as 12 palavras numeradas, com botão de copiar.
 * É o mesmo componente na criação da conta e no "ver minha chave".
 */
export const LoginKeyWords = ({ loginKey }: { loginKey: string }) => {
  const [copied, setCopied] = useState(false);

  const words = loginKey.split(" ");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(loginKey);
      setCopied(true);
    } catch (error) {
      console.warn("[account] não consegui copiar a chave", error);
    }
  };

  return (
    <div className="account-words">
      <ol className="account-words__list">
        {words.map((word, index) => (
          <li key={`${index}-${word}`} className="account-words__item">
            <span className="account-words__index">{index + 1}</span>
            <span className="account-words__word">{word}</span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="account-button account-button--ghost"
        onClick={copy}
        disabled={copied}
      >
        {copied ? t("account.create.copied") : t("account.create.copy")}
      </button>
    </div>
  );
};
