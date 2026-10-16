import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { STORAGE_KEYS } from "../app_constants";
import { getActiveSession } from "../auth/session";
import { getActiveTab, normalizeWorkspace } from "../tabs/workspace";

import type { Workspace } from "../tabs/workspace";

/**
 * Cena, appState e flags de sincronização são guardados por conta: dois logins
 * no mesmo navegador não misturam dados. Sem conta (modo `browser`) as chaves
 * ficam como sempre foram.
 */
export const scopedStorageKey = (key: string) => {
  const accountId = getActiveSession()?.accountId;
  return accountId ? `${key}:${accountId}` : key;
};

export const saveUsernameToLocalStorage = (username: string) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_COLLAB,
      JSON.stringify({ username }),
    );
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
  }
};

export const importUsernameFromLocalStorage = (): string | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    if (data) {
      return JSON.parse(data).username;
    }
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  return null;
};

/**
 * Lê o workspace guardado no navegador.
 *
 * Aceita os três formatos que já existiram: o workspace novo (com `tabs`), a
 * cena única antiga (array de elementos em `LOCAL_STORAGE_ELEMENTS` + appState
 * em `LOCAL_STORAGE_APP_STATE`) e um `{ elements, appState }` no primeiro key.
 */
export const importWorkspaceFromLocalStorage = (): Workspace => {
  let savedElements = null;
  let savedState = null;

  try {
    savedElements = localStorage.getItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS),
    );
    savedState = localStorage.getItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE),
    );
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  let parsed: unknown = null;
  if (savedElements) {
    try {
      parsed = JSON.parse(savedElements);
    } catch (error: any) {
      console.error(error);
      // Do nothing because elements array is already empty
    }
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { tabs?: unknown }).tabs)
  ) {
    return normalizeWorkspace(parsed);
  }

  const elements = Array.isArray(parsed) ? parsed : [];

  let appState: Partial<AppState> | null = null;
  if (savedState) {
    try {
      appState = clearAppStateForLocalStorage(
        JSON.parse(savedState) as Partial<AppState>,
      );
    } catch (error: any) {
      console.error(error);
      // Do nothing because appState is already null
    }
  }

  // cena antiga: elementos soltos + appState em outra chave
  return normalizeWorkspace({
    elements,
    appState: appState ?? (parsed as { appState?: unknown })?.appState ?? {},
  });
};

/** a cena da aba ativa, no formato antigo (quem só quer "a cena") */
export const importFromLocalStorage = () => {
  const tab = getActiveTab(importWorkspaceFromLocalStorage());
  return {
    elements: tab.elements as ExcalidrawElement[],
    appState: { ...getDefaultAppState(), ...tab.appState },
  };
};

export const getElementsStorageSize = () => {
  try {
    const elements = localStorage.getItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS),
    );
    const elementsSize = elements?.length || 0;
    return elementsSize;
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getTotalStorageSize = () => {
  try {
    const appState = localStorage.getItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE),
    );
    const collab = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);

    const appStateSize = appState?.length || 0;
    const collabSize = collab?.length || 0;

    return appStateSize + collabSize + getElementsStorageSize();
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};
