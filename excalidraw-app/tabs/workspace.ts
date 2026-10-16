/**
 * Workspace: o conjunto de abas do usuário.
 *
 * Até então o app tinha *uma* cena por conta (os elementos eram salvos direto
 * no envelope cifrado do `/scene`). Aqui isso vira um documento com várias
 * abas — cada uma com a própria cena (elementos + appState) e um nome — mais a
 * aba ativa. Este módulo é puro: só tipos, criação e normalização. Quem guarda
 * o estado em memória é o `tabs-store`, e quem persiste é o `LocalData`.
 *
 * Compatibilidade: a normalização aceita tanto o formato novo quanto o antigo
 * (array de elementos ou `{ elements, appState }`), então contas que já tinham
 * uma cena continuam abrindo como uma única aba.
 */
import { randomId } from "@excalidraw/common";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export type TabId = string;

/** cena de uma aba: o que muda de uma aba para outra */
export type TabScene = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
};

export type WorkspaceTab = {
  id: TabId;
  /**
   * Nome escolhido pelo usuário. Vazio significa "use o nome padrão", que é
   * derivado da posição — assim o rótulo acompanha o idioma do app sem que o
   * store precise dele.
   */
  name: string;
} & TabScene;

export type Workspace = {
  /** versão do formato persistido, para migrações futuras */
  v: typeof WORKSPACE_VERSION;
  tabs: WorkspaceTab[];
  activeTabId: TabId;
};

export const WORKSPACE_VERSION = 2 as const;

export const createTabId = (): TabId => randomId();

export const createEmptyScene = (): TabScene => ({
  elements: [],
  appState: {},
});

export const createTab = (name = ""): WorkspaceTab => ({
  id: createTabId(),
  name,
  ...createEmptyScene(),
});

export const createWorkspace = (): Workspace => {
  const tab = createTab();
  return { v: WORKSPACE_VERSION, tabs: [tab], activeTabId: tab.id };
};

export const getActiveTab = (workspace: Workspace): WorkspaceTab =>
  workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
  workspace.tabs[0];

/** todos os elementos de todas as abas — usado para carregar imagens e para a versão da cena */
export const getWorkspaceElements = (
  workspace: Workspace,
): readonly ExcalidrawElement[] =>
  workspace.tabs.reduce<ExcalidrawElement[]>(
    (acc, tab) => acc.concat(tab.elements as ExcalidrawElement[]),
    [],
  );

export const getSceneElements = (scene: TabScene) =>
  getNonDeletedElements(scene.elements as readonly ExcalidrawElement[]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeScene = (raw: unknown): TabScene => {
  if (Array.isArray(raw)) {
    return { elements: raw as ExcalidrawElement[], appState: {} };
  }
  if (!isRecord(raw)) {
    return createEmptyScene();
  }
  return {
    elements: Array.isArray(raw.elements)
      ? (raw.elements as ExcalidrawElement[])
      : [],
    appState: isRecord(raw.appState) ? (raw.appState as Partial<AppState>) : {},
  };
};

/**
 * Devolve um workspace válido a partir de qualquer coisa que tenha sido
 * persistida: o formato novo, a cena única antiga (`{ elements, appState }`)
 * ou um mero array de elementos. Garante sempre ao menos uma aba e uma aba
 * ativa existente.
 */
export const normalizeWorkspace = (raw: unknown): Workspace => {
  if (isRecord(raw) && Array.isArray(raw.tabs)) {
    const tabs = (raw.tabs as unknown[]).filter(isRecord).map((tab) => ({
      id: typeof tab.id === "string" && tab.id ? tab.id : createTabId(),
      name: typeof tab.name === "string" ? tab.name : "",
      ...normalizeScene(tab),
    }));

    if (tabs.length) {
      const activeTabId =
        typeof raw.activeTabId === "string" &&
        tabs.some((tab) => tab.id === raw.activeTabId)
          ? raw.activeTabId
          : tabs[0].id;
      return { v: WORKSPACE_VERSION, tabs, activeTabId };
    }
    return createWorkspace();
  }

  // cena única (formato antigo) ou vazio
  const scene = normalizeScene(raw);
  if (!scene.elements.length && !Object.keys(scene.appState).length) {
    return createWorkspace();
  }

  const tab = createTab();
  return {
    v: WORKSPACE_VERSION,
    tabs: [{ ...tab, ...scene }],
    activeTabId: tab.id,
  };
};

/** cópia rasa o suficiente para serializar/entregar a outra camada */
export const cloneWorkspace = (workspace: Workspace): Workspace => ({
  v: WORKSPACE_VERSION,
  activeTabId: workspace.activeTabId,
  tabs: workspace.tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    elements: tab.elements,
    appState: tab.appState,
  })),
});
