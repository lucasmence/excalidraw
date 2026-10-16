/**
 * Estado das abas em memória.
 *
 * Duas camadas de propósito:
 *
 *   - os *metadados* (id, nome, ordem, aba ativa) vivem em atoms do jotai,
 *     porque é o que a barra de abas precisa para re-renderizar;
 *   - as *cenas* das abas inativas ficam num Map fora do React. A cena da aba
 *     ativa é a que está no canvas do Excalidraw; ela é sincronizada de volta
 *     para o Map a cada alteração (ver `updateActiveTabScene`), de modo que ao
 *     trocar de aba basta ler o Map da outra aba.
 *
 * Isso evita copiar cenas inteiras a cada render — só a lista de metadados
 * entra no React.
 */
import {
  bumpElementVersions,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { reconcileElements } from "@excalidraw/excalidraw";

import type {
  ReconciledExcalidrawElement,
  RemoteExcalidrawElement,
} from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";

import {
  cloneWorkspace,
  createTab,
  createWorkspace,
  normalizeWorkspace,
  type TabScene,
  type Workspace,
  type WorkspaceTab,
} from "./workspace";

import type { TabId } from "./workspace";

export type TabMeta = Pick<WorkspaceTab, "id" | "name">;

/** metadados das abas, na ordem exibida */
export const tabsAtom = atom<TabMeta[]>([]);
/** aba em foco */
export const activeTabIdAtom = atom<TabId>("");

/** cenas de todas as abas; a da aba ativa é espelhada do canvas */
const sceneCache = new Map<TabId, TabScene>();

/**
 * Ids de abas que já vieram da sala alguma vez. Serve para distinguir "aba que
 * eu criei localmente" de "aba que existia na sala e foi fechada lá" — só a
 * segunda deve sumir daqui quando deixa de aparecer.
 */
let knownRemoteTabIds = new Set<TabId>();

/**
 * Qual aba o canvas está *de fato* mostrando.
 *
 * Não é o mesmo que a aba em foco (`activeTabIdAtom`): no instante da troca o
 * foco muda antes de a cena nova chegar ao canvas, e nesse meio-tempo qualquer
 * alteração emitida pelo editor ainda pertence à aba antiga. Escrever pelo
 * `canvasTabId` evita que a cena de uma aba vaze para a outra.
 */
let canvasTabId: TabId = "";

export const getCanvasTabId = () => canvasTabId;

export const setCanvasTabId = (id: TabId) => {
  canvasTabId = id;
};

type WorkspaceListener = (tabs: TabMeta[]) => void;
const listeners = new Set<WorkspaceListener>();

/** avisa quando a lista de abas muda (criar/fechar/renomear/reordenar) */
export const subscribeTabs = (listener: WorkspaceListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emitTabs = () => {
  const tabs = getTabs();
  for (const listener of listeners) {
    listener(tabs);
  }
};

/** aplica os metadados nos atoms */
const setTabsMeta = (tabs: TabMeta[], activeTabId: TabId) => {
  appJotaiStore.set(tabsAtom, tabs);
  appJotaiStore.set(activeTabIdAtom, activeTabId);
};

export const getTabs = (): TabMeta[] => appJotaiStore.get(tabsAtom);

export const getActiveTabId = (): TabId => appJotaiStore.get(activeTabIdAtom);

export const getTabScene = (id: TabId): TabScene | undefined =>
  sceneCache.get(id);

export const setTabScene = (id: TabId, scene: TabScene) => {
  sceneCache.set(id, scene);
};

/** espelha a cena do canvas de volta para o cache da aba que ele mostra */
export const updateActiveTabScene = (scene: TabScene) => {
  if (canvasTabId) {
    sceneCache.set(canvasTabId, scene);
  }
};

/** snapshot completo (metadados + cenas), como o persistidor espera */
export const getWorkspace = (): Workspace => {
  const tabs = getTabs();
  const activeTabId = getActiveTabId();

  const allTabs: WorkspaceTab[] =
    tabs.length > 0
      ? tabs.map((meta) => ({
          id: meta.id,
          name: meta.name,
          ...(sceneCache.get(meta.id) ?? { elements: [], appState: {} }),
        }))
      : createWorkspace().tabs;

  return normalizeWorkspace({
    tabs: allTabs,
    activeTabId: activeTabId || allTabs[0].id,
  });
};

/** substitui todo o estado em memória (load inicial, entrar/sair de sala) */
export const bindWorkspace = (raw: unknown): Workspace => {
  const workspace = normalizeWorkspace(raw);
  sceneCache.clear();
  knownRemoteTabIds = new Set();
  canvasTabId = "";
  for (const tab of workspace.tabs) {
    sceneCache.set(tab.id, { elements: tab.elements, appState: tab.appState });
  }
  setTabsMeta(
    workspace.tabs.map(({ id, name }) => ({ id, name })),
    workspace.activeTabId,
  );
  emitTabs();
  return cloneWorkspace(workspace);
};

/** esquece tudo (logout) */
export const resetWorkspace = () => {
  sceneCache.clear();
  knownRemoteTabIds = new Set();
  canvasTabId = "";
  const workspace = createWorkspace();
  setTabsMeta(
    workspace.tabs.map(({ id, name }) => ({ id, name })),
    workspace.activeTabId,
  );
  emitTabs();
};

const tabIndex = (id: TabId) => getTabs().findIndex((tab) => tab.id === id);

/**
 * Cria uma aba nova (vazia) e a coloca em foco, logo depois da aba atual.
 * Devolve o id criado.
 */
export const createTabAfterActive = (name = ""): TabId => {
  const tabs = getTabs();
  const tab = createTab(name);
  const at = Math.max(tabIndex(getActiveTabId()), 0) + 1;

  const next = [...tabs];
  next.splice(at, 0, { id: tab.id, name: tab.name });

  sceneCache.set(tab.id, { elements: tab.elements, appState: tab.appState });
  setTabsMeta(next, tab.id);
  emitTabs();
  return tab.id;
};

export const renameTab = (id: TabId, name: string) => {
  const tabs = getTabs().map((tab) => (tab.id === id ? { ...tab, name } : tab));
  setTabsMeta(tabs, getActiveTabId());
  emitTabs();
};

export const selectTab = (id: TabId) => {
  if (getActiveTabId() === id || tabIndex(id) === -1) {
    return;
  }
  setTabsMeta(getTabs(), id);
};

/**
 * Fecha uma aba. Se era a última, o workspace fica com uma aba vazia no lugar
 * (nunca zero abas). Devolve o id da aba que passou a ficar em foco — quem
 * chama compara com o anterior para saber se precisa trocar a cena do canvas.
 */
export const closeTab = (id: TabId): TabId => {
  const tabs = getTabs();
  const at = tabs.findIndex((tab) => tab.id === id);

  let next = tabs.filter((tab) => tab.id !== id);
  if (next.length === 0) {
    const fresh = createTab();
    sceneCache.set(fresh.id, {
      elements: fresh.elements,
      appState: fresh.appState,
    });
    next = [{ id: fresh.id, name: fresh.name }];
  }

  sceneCache.delete(id);

  const activeTabId = getActiveTabId();
  const nextActive =
    activeTabId === id
      ? next[Math.min(at, next.length - 1)]?.id ?? next[0].id
      : activeTabId;

  setTabsMeta(next, nextActive);
  emitTabs();
  return nextActive;
};

export const moveTab = (id: TabId, toIndex: number) => {
  const tabs = [...getTabs()];
  const from = tabs.findIndex((tab) => tab.id === id);
  if (from === -1) {
    return;
  }
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
  setTabsMeta(tabs, getActiveTabId());
  emitTabs();
};

/**
 * Reconcilia os metadados com os que vieram da sala: a lista remota manda na
 * existência, no nome e na ordem das abas compartilhadas, mas as cenas locais
 * das abas que continuam existindo são preservadas.
 */
const isMeaningfulTab = (tab: TabMeta) =>
  !!tab.name || !!sceneCache.get(tab.id)?.elements.length;

/**
 * Reconcilia os metadados com os que vieram da sala.
 *
 * A lista remota manda no nome e na ordem das abas que ela conhece. Abas que
 * já foram vistas na sala e agora sumiram foram *fechadas* em outro cliente e
 * saem daqui também — mas as abas locais que a sala nunca viu (e que têm
 * conteúdo ou nome) ficam, porque são trabalho deste cliente. Use
 * `merge: false` para adotar a lista remota tal e qual (entrar numa sala
 * existente).
 */
export const applyRemoteTabs = (
  remoteTabs: TabMeta[],
  { merge = true }: { merge?: boolean } = {},
) => {
  const localTabs = getTabs();
  const remoteIds = new Set(remoteTabs.map((tab) => tab.id));

  // fechadas na sala: estavam no remoto antes e não estão mais
  for (const id of knownRemoteTabIds) {
    if (!remoteIds.has(id)) {
      sceneCache.delete(id);
    }
  }
  knownRemoteTabIds = new Set(remoteIds);

  const localExtras = merge
    ? localTabs.filter((tab) => !remoteIds.has(tab.id) && isMeaningfulTab(tab))
    : [];

  // limpa cenas de abas locais que saíram (fechadas localmente antes disso)
  const keptIds = new Set([
    ...remoteTabs.map((tab) => tab.id),
    ...localExtras.map((tab) => tab.id),
  ]);
  for (const id of [...sceneCache.keys()]) {
    if (!keptIds.has(id)) {
      sceneCache.delete(id);
    }
  }

  for (const tab of remoteTabs) {
    if (!sceneCache.has(tab.id)) {
      sceneCache.set(tab.id, { elements: [], appState: {} });
    }
  }

  const next = [
    ...remoteTabs.map(({ id, name }) => ({ id, name })),
    ...localExtras.map(({ id, name }) => ({ id, name })),
  ];

  if (!next.length) {
    // a sala não tem abas e não há nada local relevante: mantém uma em branco
    const fresh = createTab();
    sceneCache.set(fresh.id, {
      elements: fresh.elements,
      appState: fresh.appState,
    });
    setTabsMeta([{ id: fresh.id, name: fresh.name }], fresh.id);
    emitTabs();
    return;
  }

  const activeTabId = getActiveTabId();
  setTabsMeta(
    next,
    next.some((tab) => tab.id === activeTabId) ? activeTabId : next[0].id,
  );
  emitTabs();
};

/**
 * Funde elementos que chegaram da sala na cena da aba indicada e devolve o
 * resultado reconciliado (para o canvas, quando for a aba ativa).
 */
export const mergeRemoteSceneElements = (
  tabId: TabId,
  remoteElements: readonly RemoteExcalidrawElement[],
  appState: AppState,
  /** a aba ativa reconcilia contra o canvas, que pode estar à frente do cache */
  localElements?: readonly OrderedExcalidrawElement[],
): ReconciledExcalidrawElement[] => {
  const existing = (localElements ??
    sceneCache.get(tabId)?.elements ??
    []) as readonly OrderedExcalidrawElement[];

  const restored = restoreElements(remoteElements, existing);
  const reconciled = bumpElementVersions(
    reconcileElements(existing, restored, appState),
    existing,
  );

  sceneCache.set(tabId, {
    elements: reconciled,
    appState: sceneCache.get(tabId)?.appState ?? {},
  });

  return reconciled;
};
