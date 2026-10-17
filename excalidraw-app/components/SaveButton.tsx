import { Button } from "@excalidraw/excalidraw/components/Button";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import clsx from "clsx";
import React, { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { LocalData } from "../data/LocalData";

import "./SaveButton.scss";

/**
 * Segundos de trava depois de um save à mão.
 *
 * O save normal é debounced (300 ms) e o da sala é throttle de 20 s: este botão
 * é para quem quer garantir a gravação na hora, e a trava existe para ele não
 * virar metralhadora contra o MySQL (um clique por clique escrevia a cena
 * inteira).
 */
export const SAVE_COOLDOWN_SECONDS = 20;

/**
 * Quantos segundos a confirmação ("salvo") fica no rótulo antes de ele virar a
 * contagem da trava: sem isso, ou o usuário não vê que salvou, ou não entende
 * por que o botão está apagado.
 */
export const SAVED_LABEL_SECONDS = 3;

type SaveStatus = "idle" | "saving" | "saved" | "browserOnly";

/**
 * Salva a cena da tela no banco agora, ao lado do menu.
 *
 * "Salvar" aqui é o mesmo caminho do save automático: a cena do canvas é
 * espelhada na aba ativa e o workspace inteiro vai para a API/MySQL (ver
 * `LocalData.save`). Se a API não responder, o `LocalData` guarda no navegador
 * e marca para re-sync — o botão diz isso ("salvo neste navegador") em vez de
 * fingir que o banco recebeu.
 */
export const SaveButton = React.memo(
  ({
    excalidrawAPI,
    isMobile,
  }: {
    excalidrawAPI: ExcalidrawImperativeAPI | null;
    isMobile: boolean;
  }) => {
    const { t } = useI18n();
    const [status, setStatus] = useState<SaveStatus>("idle");
    const [cooldown, setCooldown] = useState(0);

    const locked = cooldown > 0;
    const justSaved =
      (status === "saved" || status === "browserOnly") &&
      cooldown > SAVE_COOLDOWN_SECONDS - SAVED_LABEL_SECONDS;

    // um tique por segundo enquanto a trava dura: é o que mostra a contagem
    // correndo e devolve o botão ao normal quando ela acaba
    useEffect(() => {
      if (!locked) {
        setStatus("idle");
        return;
      }

      const interval = window.setInterval(
        () => setCooldown((seconds) => Math.max(0, seconds - 1)),
        1000,
      );

      return () => window.clearInterval(interval);
    }, [locked]);

    /**
     * O rótulo conta o que aconteceu: salvando → salvo (por alguns segundos) →
     * contagem da trava → de volta ao normal.
     */
    const label = (() => {
      if (status === "saving") {
        return t("saveButton.saving");
      }

      if (justSaved) {
        return status === "saved"
          ? t("saveButton.saved")
          : t("saveButton.browserOnly");
      }

      if (locked) {
        return t("saveButton.wait", { seconds: cooldown });
      }

      return t("saveButton.label");
    })();

    const saveNow = async () => {
      if (!excalidrawAPI || locked) {
        return;
      }

      setStatus("saving");
      // a trava vale desde o clique, não desde a resposta da API
      setCooldown(SAVE_COOLDOWN_SECONDS);

      try {
        LocalData.save(
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          excalidrawAPI.getAppState(),
          excalidrawAPI.getFiles(),
          () => {},
        );
        await LocalData.flushSaveAsync();
        setStatus(LocalData.isPendingSync() ? "browserOnly" : "saved");
      } catch (error) {
        console.error("[save] não consegui salvar a cena agora", error);
        setStatus("browserOnly");
      }
    };

    return (
      <Button
        className={clsx("save-button", {
          "save-button--icon-only": isMobile,
        })}
        type="button"
        onSelect={() => void saveNow()}
        disabled={locked}
        title={isMobile ? label : t("saveButton.title")}
        aria-label={label}
        data-testid="save-button"
      >
        {saveIcon}
        {!isMobile && <span className="save-button__label">{label}</span>}
      </Button>
    );
  },
);

SaveButton.displayName = "SaveButton";

/** tabler-icons: device-floppy */
const saveIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" />
    <path d="M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
    <path d="M14 4l0 4l-6 0l0 -4" />
  </svg>
);
