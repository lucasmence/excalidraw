import { useI18n } from "@excalidraw/excalidraw/i18n";
import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

import { useAtomValue } from "../app-jotai";

import {
  activeTabIdAtom,
  closeTab,
  createTabAfterActive,
  moveTab,
  renameTab,
  selectTab,
  tabsAtom,
} from "./tabs-store";

import "./TabBar.scss";

import type { TabMeta } from "./tabs-store";

/**
 * Barra de abas estilo navegador, no topo do canvas.
 *
 * Cada aba tem a própria cena; ela só guarda metadados — o conteúdo está no
 * `tabs-store`. Clicar seleciona, duplo clique renomeia, arrastar reordena e o
 * "×" fecha (a última aba não some: vira uma aba vazia).
 */
export const TabBar = React.memo(() => {
  const { t } = useI18n();
  const tabs = useAtomValue(tabsAtom);
  const activeTabId = useAtomValue(activeTabIdAtom);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.select();
    }
  }, [editingId]);

  if (!tabs.length) {
    return null;
  }

  const labelFor = (tab: TabMeta, index: number) =>
    tab.name || t("tabs.defaultName", { number: index + 1 });

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraft(name);
  };

  const commitRename = () => {
    if (editingId) {
      renameTab(editingId, draft.trim());
    }
    setEditingId(null);
  };

  return (
    <div
      className="excalidraw-ui-tabs"
      role="tablist"
      aria-label={t("tabs.title")}
    >
      <div className="excalidraw-ui-tabs__list">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingId === tab.id;

          return (
            <div
              key={tab.id}
              className={clsx("excalidraw-ui-tabs__tab", {
                "is-active": isActive,
              })}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              draggable={!isEditing}
              onDragStart={() => setDraggingId(tab.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId && draggingId !== tab.id) {
                  moveTab(draggingId, index);
                }
                setDraggingId(null);
              }}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => startRename(tab.id, tab.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectTab(tab.id);
                }
              }}
              data-testid={`tab-${index}`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="excalidraw-ui-tabs__input"
                  value={draft}
                  autoFocus
                  aria-label={t("tabs.rename")}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitRename();
                    } else if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  data-testid="tab-rename-input"
                />
              ) : (
                <span
                  className="excalidraw-ui-tabs__name"
                  title={labelFor(tab, index)}
                >
                  {labelFor(tab, index)}
                </span>
              )}
              <button
                type="button"
                className="excalidraw-ui-tabs__close"
                aria-label={t("tabs.close")}
                title={t("tabs.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                data-testid={`tab-close-${index}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="excalidraw-ui-tabs__add"
        aria-label={t("tabs.new")}
        title={t("tabs.new")}
        onClick={() => createTabAfterActive()}
        data-testid="tab-add"
      >
        +
      </button>
    </div>
  );
});

TabBar.displayName = "TabBar";
