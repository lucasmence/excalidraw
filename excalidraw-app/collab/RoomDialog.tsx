import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import DialogActionButton from "@excalidraw/excalidraw/components/DialogActionButton";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React, { useState } from "react";

import { useAtom, useAtomValue } from "../app-jotai";
import { collabRoomOf } from "../auth/session";

import {
  activeRoomLinkAtom,
  collabAPIAtom,
  isCollaboratingAtom,
} from "./Collab";
import { roomDialogAtom } from "./room-state";

import "./RoomDialog.scss";

/**
 * Diálogo da sala de colaboração: abre/encerra a sessão e mostra o link da sala
 * (com botão de copiar).
 *
 * O link é a própria URL do app com `#room=<roomId>,<roomKey>`: a chave viaja no
 * hash, que o navegador não manda para o servidor, e o servidor de salas só
 * reemite o que passa por ele — cifrado.
 *
 * Com conta, a sessão é a sala fixa dela: o link mostrado é o dessa sala (que
 * não muda) e não existe sala nova para convidar terceiros. Conta que abrir o
 * link de outra cai na própria sala (ver `resolveRoomLink`).
 *
 * Renderizado fora do menu/editor pelo mesmo motivo de `AccountDialog`: o
 * conteúdo do menu é desmontado ao selecionar um item.
 */
export const RoomDialog = () => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useAtom(roomDialogAtom);
  const collabAPI = useAtomValue(collabAPIAtom);
  const isCollaborating = useAtomValue(isCollaboratingAtom);
  const roomLink = useAtomValue(activeRoomLinkAtom);
  /**
   * Sala fixa da conta ativa; `null` sem conta (testes/dev com
   * `VITE_APP_STORAGE=browser`), quando o diálogo volta a criar salas.
   */
  const accountRoom = collabRoomOf();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  if (!isOpen || !collabAPI) {
    return null;
  }

  const close = () => {
    setCopied(false);
    setIsOpen(false);
  };

  const startSession = async () => {
    setStarting(true);
    try {
      // Com conta, a sessão é a sala dela (mantendo a cena da tela, como no
      // boot): gerar sala nova deixaria o usuário fora da própria sala. Sem
      // conta, o Collab gera sala+chave e a cena da tela vira a da sala.
      await collabAPI.startCollaboration(
        accountRoom,
        accountRoom ? { keepScene: true, replaceHistory: true } : undefined,
      );
    } catch (error) {
      console.error("[collab] não consegui iniciar a sala", error);
    } finally {
      setStarting(false);
    }
  };

  const stopSession = () => {
    // `true` mantém a cena da sala na tela e devolve a URL para a normal; o
    // Collab pede confirmação antes de sair da sessão
    collabAPI.stopCollaboration(true);
    if (!collabAPI.isCollaborating()) {
      close();
    }
  };

  const copyLink = async () => {
    if (!roomLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(roomLink);
      setCopied(true);
    } catch (error) {
      console.warn("[collab] não consegui copiar o link da sala", error);
    }
  };

  return (
    <Dialog title={t("roomDialog.title")} size="small" onCloseRequest={close}>
      {isCollaborating && roomLink ? (
        <>
          <p className="room-dialog__text">
            {t("roomDialog.desc_inProgressIntro")}
          </p>
          <p className="room-dialog__text">
            {accountRoom
              ? t("account.room.shareHint")
              : t("roomDialog.desc_shareLink")}
          </p>
          <input
            className="room-dialog__link"
            data-testid="room-dialog-link"
            aria-label={t("roomDialog.linkLabel")}
            value={roomLink}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="room-dialog__text room-dialog__text--muted">
            {t("roomDialog.desc_exitSession")}
          </p>
          <div className="room-dialog__actions">
            <DialogActionButton
              label={t("roomDialog.button_stopSession")}
              onClick={stopSession}
              data-testid="room-dialog-stop"
            />
            <DialogActionButton
              label={
                copied
                  ? t("roomDialog.button_linkCopied")
                  : t("roomDialog.button_copyLink")
              }
              onClick={copyLink}
              actionType="primary"
              data-testid="room-dialog-copy"
            />
          </div>
        </>
      ) : (
        <>
          <p className="room-dialog__text">
            {accountRoom
              ? t("account.room.privateHint")
              : t("roomDialog.desc_intro")}
          </p>
          <p className="room-dialog__text room-dialog__text--muted">
            {t("roomDialog.desc_privacy")}
          </p>
          <div className="room-dialog__actions">
            <DialogActionButton
              label={t("roomDialog.button_startSession")}
              onClick={startSession}
              actionType="primary"
              isLoading={starting}
              data-testid="room-dialog-start"
            />
          </div>
        </>
      )}
    </Dialog>
  );
};

RoomDialog.displayName = "RoomDialog";
