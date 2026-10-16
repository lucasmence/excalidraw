import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import DialogActionButton from "@excalidraw/excalidraw/components/DialogActionButton";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React, { useEffect, useState } from "react";

import "./CloseTabDialog.scss";

/**
 * Segundos que o botão de apagar fica desabilitado. A contagem aparece no
 * próprio botão ("Apagar (10)"), então o usuário vê quanto falta para poder
 * confirmar.
 */
export const CLOSE_TAB_CONFIRM_DELAY_SECONDS = 10;

/**
 * Confirmação de fechar uma aba.
 *
 * Apagar uma aba descarta a cena dela, então o "×" abre este diálogo em vez de
 * apagar direto: cancelar sai sem tocar em nada e apagar só libera depois da
 * contagem. Fechar (Esc, clique fora ou "Cancelar") é sempre seguro.
 */
export const CloseTabDialog = ({
  tabName,
  onCancel,
  onConfirm,
}: {
  /** nome mostrado para a aba que vai ser apagada */
  tabName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useI18n();
  const [secondsLeft, setSecondsLeft] = useState(
    CLOSE_TAB_CONFIRM_DELAY_SECONDS,
  );

  // um segundo por vez: cada contagem agenda a próxima, e o timeout é
  // cancelado quando o diálogo sai da tela (cancelar/fechar)
  useEffect(() => {
    if (secondsLeft === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSecondsLeft(secondsLeft - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const counting = secondsLeft > 0;

  return (
    <Dialog
      title={t("tabs.closeConfirm.title")}
      size="small"
      onCloseRequest={onCancel}
    >
      <p className="tabs-dialog__text">
        {t("tabs.closeConfirm.description", { name: tabName })}
      </p>

      <div className="tabs-dialog__actions">
        <DialogActionButton
          label={t("buttons.cancel")}
          onClick={onCancel}
          data-testid="close-tab-cancel"
        />
        <DialogActionButton
          label={
            counting
              ? t("tabs.closeConfirm.actionCountdown", {
                  seconds: secondsLeft,
                })
              : t("tabs.closeConfirm.action")
          }
          className="tabs-dialog__confirm"
          onClick={onConfirm}
          actionType="danger"
          disabled={counting}
          data-testid="close-tab-confirm"
        />
      </div>
    </Dialog>
  );
};

CloseTabDialog.displayName = "CloseTabDialog";
