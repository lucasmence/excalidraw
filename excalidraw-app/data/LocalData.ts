/**
 * This file deals with saving data state (appState, elements, images, ...) .
 *
 * Notes:
 *
 * - DataState refers to full state of the app: appState, elements, images,
 *   though some state is saved separately (collab username, library) for one
 *   reason or another. We also save different data to different storage
 *   (localStorage, indexedDB).
 *
 * - The MySQL API (see `server/`) is the primary storage. The browser storage
 *   is kept as a *cache* so the app keeps working when the API is unreachable,
 *   and as the fallback when it's explicitly disabled (`VITE_APP_STORAGE=browser`).
 */

import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  debounce,
} from "@excalidraw/common";
import {
  createStore,
  entries,
  del,
  getMany,
  set,
  setMany,
  get,
} from "idb-keyval";

import { getNonDeletedElements } from "@excalidraw/element";

import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { MaybePromise } from "@excalidraw/common/utility-types";

import { appJotaiStore, atom } from "../app-jotai";
import { SAVE_TO_LOCAL_STORAGE_TIMEOUT, STORAGE_KEYS } from "../app_constants";
import { getActiveSession } from "../auth/session";

import {
  fetchRemoteFiles,
  fetchRemoteLibrary,
  fetchRemoteScene,
  isRemoteStorageEnabled,
  pruneRemoteFiles,
  saveRemoteFiles,
  saveRemoteLibrary,
  saveRemoteScene,
} from "./apiStorage";
import { FileManager } from "./FileManager";
import { FileStatusStore } from "./fileStatusStore";
import { Locker } from "./Locker";
import { importFromLocalStorage, scopedStorageKey } from "./localStorage";
import { updateBrowserStateVersion } from "./tabSync";

import type { RemoteScene } from "./apiStorage";

const filesStore = createStore("files-db", "files-store");

/** imagens sem uso (nem no canvas) por mais de 1 dia podem sair do banco */
const FILE_USAGE_TTL_MS = 24 * 3600 * 1000;

export const localStorageQuotaExceededAtom = atom(false);

type PersistedScene = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
};

/**
 * Removes everything that shouldn't be persisted, no matter the storage.
 */
const getPersistableScene = (
  elements: readonly ExcalidrawElement[],
  appState: AppState | Partial<AppState>,
): PersistedScene => {
  const _appState = clearAppStateForLocalStorage(appState);

  if (
    _appState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
    _appState.openSidebar.tab === CANVAS_SEARCH_TAB
  ) {
    _appState.openSidebar = null;
  }

  return {
    elements: getNonDeletedElements(elements),
    appState: _appState,
  };
};

const isQuotaExceededError = (error: any) => {
  return error instanceof DOMException && error.name === "QuotaExceededError";
};

// -----------------------------------------------------------------------------
// cache/fallback no navegador
// -----------------------------------------------------------------------------

const writeSceneToBrowserStorage = (
  { elements, appState }: PersistedScene,
  { bumpVersion = true }: { bumpVersion?: boolean } = {},
) => {
  const localStorageQuotaExceeded = appJotaiStore.get(
    localStorageQuotaExceededAtom,
  );
  try {
    localStorage.setItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS),
      JSON.stringify(elements),
    );
    localStorage.setItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE),
      JSON.stringify(appState),
    );
    if (bumpVersion) {
      updateBrowserStateVersion(STORAGE_KEYS.VERSION_DATA_STATE);
    }
    if (localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, false);
    }
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
    if (isQuotaExceededError(error) && !localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, true);
    }
  }
};

/**
 * Set when a save couldn't reach the API. On the next load the local copy wins
 * (it holds edits the database never saw) and is pushed back to MySQL.
 */
const hasPendingSync = () => {
  try {
    return (
      localStorage.getItem(
        scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC),
      ) === "1"
    );
  } catch (error: any) {
    console.error(error);
    return false;
  }
};

const setPendingSync = (pending: boolean) => {
  try {
    const key = scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC);
    if (pending) {
      localStorage.setItem(key, "1");
    } else {
      localStorage.removeItem(key);
    }
  } catch (error: any) {
    console.error(error);
  }
};

// -----------------------------------------------------------------------------
// uso das imagens (só no cliente: no banco não existe timestamp em claro)
// -----------------------------------------------------------------------------

const readFileUsage = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_FILE_USAGE),
    );
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch (error: any) {
    console.error(error);
    return {};
  }
};

const writeFileUsage = (usage: Record<string, number>) => {
  try {
    localStorage.setItem(
      scopedStorageKey(STORAGE_KEYS.LOCAL_STORAGE_FILE_USAGE),
      JSON.stringify(usage),
    );
  } catch (error: any) {
    console.error(error);
  }
};

const rememberFileUsage = (files: { id: FileId; lastRetrieved?: number }[]) => {
  if (!isRemoteStorageEnabled() || !files.length) {
    return;
  }

  const usage = readFileUsage();
  for (const file of files) {
    usage[file.id] = file.lastRetrieved ?? Date.now();
  }
  writeFileUsage(usage);
};

const forgetFileUsage = (ids: FileId[]) => {
  const usage = readFileUsage();
  let changed = false;

  for (const id of ids) {
    if (id in usage) {
      delete usage[id];
      changed = true;
    }
  }

  if (changed) {
    writeFileUsage(usage);
  }
};

const normalizeRemoteScene = (remote: RemoteScene): PersistedScene => ({
  elements: (remote.elements || []) as ExcalidrawElement[],
  appState: {
    ...getDefaultAppState(),
    ...clearAppStateForLocalStorage(remote.appState as Partial<AppState>),
  },
});

// -----------------------------------------------------------------------------
// imagens
// -----------------------------------------------------------------------------

const idbGetFiles = (ids: FileId[]) =>
  getMany(ids, filesStore).then(
    async (filesData: (BinaryFileData | undefined)[]) => {
      const loadedFiles: BinaryFileData[] = [];
      const erroredFiles = new Map<FileId, true>();

      const filesToSave: [FileId, BinaryFileData][] = [];

      filesData.forEach((data, index) => {
        const id = ids[index];
        if (data) {
          const _data: BinaryFileData = {
            ...data,
            lastRetrieved: Date.now(),
          };
          filesToSave.push([id, _data]);
          loadedFiles.push(_data);
        } else {
          erroredFiles.set(id, true);
        }
      });

      try {
        // save loaded files back to storage with updated `lastRetrieved`
        setMany(filesToSave, filesStore);
      } catch (error) {
        console.warn(error);
      }

      return { loadedFiles, erroredFiles };
    },
  );

const idbSaveFiles = async ({
  addedFiles,
}: {
  addedFiles: Map<FileId, BinaryFileData>;
}) => {
  const savedFiles = new Map<FileId, BinaryFileData>();
  const erroredFiles = new Map<FileId, BinaryFileData>();

  await Promise.all(
    [...addedFiles].map(async ([id, fileData]) => {
      try {
        await set(id, fileData, filesStore);
        savedFiles.set(id, fileData);
      } catch (error: any) {
        console.error(error);
        erroredFiles.set(id, fileData);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

class LocalFileManager extends FileManager {
  clearObsoleteFiles = async (opts: { currentFileIds: FileId[] }) => {
    if (isRemoteStorageEnabled()) {
      try {
        // o servidor não guarda data de uso (seria metadado em claro), então
        // quem sabe o que ficou velho é o cliente
        const usage = readFileUsage();
        const stale = Object.entries(usage)
          .filter(
            ([id, lastRetrieved]) =>
              Date.now() - lastRetrieved > FILE_USAGE_TTL_MS &&
              !opts.currentFileIds.includes(id as FileId),
          )
          .map(([id]) => id as FileId);

        if (stale.length) {
          await pruneRemoteFiles({
            remove: stale,
            keep: opts.currentFileIds,
          });
          forgetFileUsage(stale);
        }
      } catch (error) {
        console.warn(
          "[storage] não consegui limpar imagens órfãs no MySQL; limpando só o navegador",
          error,
        );
      }
    }

    await entries(filesStore).then((entries) => {
      for (const [id, imageData] of entries as [FileId, BinaryFileData][]) {
        // if image is unused (not on canvas) & is older than 1 day, delete it
        // from storage. We check `lastRetrieved` we care about the last time
        // the image was used (loaded on canvas), not when it was initially
        // created.
        if (
          (!imageData.lastRetrieved ||
            Date.now() - imageData.lastRetrieved > 24 * 3600 * 1000) &&
          !opts.currentFileIds.includes(id as FileId)
        ) {
          del(id, filesStore);
        }
      }
    });
  };
}

type SavingLockTypes = "collaboration";

export class LocalData {
  private static _save = debounce(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      await this.saveDataState(elements, appState);

      await this.fileStorage.saveFiles({
        elements,
        files,
      });
      onFilesSaved();
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /** Saves DataState, including files. Bails if saving is paused */
  static save = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    // we need to make the `isSavePaused` check synchronously (undebounced)
    if (!this.isSavePaused()) {
      this._save(elements, appState, files, onFilesSaved);
    }
  };

  /**
   * Writes the scene to MySQL. If the API is unreachable the scene is kept in
   * the browser and marked for re-sync, so nothing is lost while offline.
   */
  private static saveDataState = async (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => {
    const scene = getPersistableScene(elements, appState);

    if (!isRemoteStorageEnabled()) {
      writeSceneToBrowserStorage(scene);
      return;
    }

    try {
      await saveRemoteScene(scene);
      setPendingSync(false);
      // espelha localmente: alimenta o fallback offline e o sync entre abas
      writeSceneToBrowserStorage(scene);
    } catch (error) {
      console.warn(
        "[storage] MySQL indisponível; guardando a cena no navegador até reconectar",
        error,
      );
      writeSceneToBrowserStorage(scene);
      setPendingSync(true);
    }
  };

  /**
   * Loads the scene from MySQL, falling back to the browser copy when the API
   * is unreachable. Local edits that never reached the database win, and are
   * pushed back.
   */
  static loadScene = async (): Promise<{
    elements: ExcalidrawElement[];
    appState: Partial<AppState> | null;
  }> => {
    const local = importFromLocalStorage();

    if (!isRemoteStorageEnabled()) {
      return local;
    }

    try {
      const remote = await fetchRemoteScene();

      if (hasPendingSync()) {
        await this.pushSceneToRemote(local);
        return local;
      }

      if (remote) {
        const scene = normalizeRemoteScene(remote);
        // cache only: bumping the version would make other tabs reload
        writeSceneToBrowserStorage(scene, { bumpVersion: false });
        return {
          elements: scene.elements as ExcalidrawElement[],
          appState: scene.appState,
        };
      }

      // empty database: migrate whatever the browser already had
      if (local.elements.length || local.appState) {
        await this.pushSceneToRemote(local);
      }
      return local;
    } catch (error) {
      console.warn(
        "[storage] não consegui ler a cena do MySQL; usando a cópia do navegador",
        error,
      );
      return local;
    }
  };

  private static pushSceneToRemote = async (local: {
    elements: ExcalidrawElement[];
    appState: Partial<AppState> | null;
  }) => {
    try {
      await saveRemoteScene(
        getPersistableScene(local.elements, local.appState || {}),
      );
      setPendingSync(false);
    } catch (error) {
      console.warn(
        "[storage] ainda não consegui enviar a cena local para o MySQL",
        error,
      );
      setPendingSync(true);
    }
  };

  static flushSave = () => {
    this._save.flush();
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  /**
   * Chamado no logout: sem a cópia local, outro login no mesmo navegador não
   * encontra a cena de quem saiu (nem em texto puro no localStorage). As chaves
   * são por conta, então isso não afeta outras contas.
   */
  static clearAccountData = () => {
    const accountId = getActiveSession()?.accountId;

    if (!accountId) {
      return;
    }

    for (const key of [
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC,
      STORAGE_KEYS.LOCAL_STORAGE_FILE_USAGE,
    ]) {
      try {
        localStorage.removeItem(`${key}:${accountId}`);
      } catch (error: any) {
        console.error(error);
      }
    }
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new LocalFileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles: async (ids) => {
      if (isRemoteStorageEnabled()) {
        try {
          const result = await fetchRemoteFiles(ids);
          rememberFileUsage(result.loadedFiles);
          return result;
        } catch (error) {
          console.warn(
            "[storage] não consegui ler imagens do MySQL; usando o navegador",
            error,
          );
        }
      }
      return idbGetFiles(ids);
    },
    async saveFiles({ addedFiles }) {
      // before we use `storage` event synchronization, let's update the flag
      // optimistically. Hopefully nothing fails, and an IDB read executed
      // before an IDB write finishes will read the latest value.
      updateBrowserStateVersion(STORAGE_KEYS.VERSION_FILES);

      if (isRemoteStorageEnabled()) {
        try {
          const result = await saveRemoteFiles(addedFiles);
          rememberFileUsage([...result.savedFiles.values()]);
          return result;
        } catch (error) {
          console.warn(
            "[storage] não consegui salvar imagens no MySQL; usando o navegador",
            error,
          );
        }
      }

      return idbSaveFiles({ addedFiles });
    },
  });
}

export class LibraryIndexedDBAdapter {
  /** IndexedDB database and store name */
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  /** library data store key */
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBAdapter.key,
      LibraryIndexedDBAdapter.store,
    );

    return IDBData || null;
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    return set(
      LibraryIndexedDBAdapter.key,
      data,
      LibraryIndexedDBAdapter.store,
    );
  }
}

/**
 * Library adapter backed by MySQL, falling back to IndexedDB when the API is
 * unreachable or disabled.
 */
export class LibraryApiAdapter {
  static async load(): Promise<LibraryPersistedData | null> {
    if (isRemoteStorageEnabled()) {
      try {
        const data = await fetchRemoteLibrary();
        if (data) {
          return data;
        }
      } catch (error) {
        console.warn(
          "[storage] não consegui ler a biblioteca do MySQL; usando o navegador",
          error,
        );
      }
    }

    return LibraryIndexedDBAdapter.load();
  }

  static async save(data: LibraryPersistedData): Promise<void> {
    if (isRemoteStorageEnabled()) {
      try {
        await saveRemoteLibrary(data);
      } catch (error) {
        console.warn(
          "[storage] não consegui salvar a biblioteca no MySQL; usando o navegador",
          error,
        );
        return LibraryIndexedDBAdapter.save(data);
      }
    }

    return LibraryIndexedDBAdapter.save(data);
  }
}

/** LS Adapter used only for migrating LS library data
 * to indexedDB */
export class LibraryLocalStorageMigrationAdapter {
  static load() {
    const LSData = localStorage.getItem(
      STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY,
    );
    if (LSData != null) {
      const libraryItems: ImportedDataState["libraryItems"] =
        JSON.parse(LSData);
      if (libraryItems) {
        return { libraryItems };
      }
    }
    return null;
  }
  static clear() {
    localStorage.removeItem(STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY);
  }
}
