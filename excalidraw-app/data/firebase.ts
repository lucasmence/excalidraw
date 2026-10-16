import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  runTransaction,
  Bytes,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes } from "firebase/storage";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { FILE_CACHE_MAX_AGE_SEC } from "../app_constants";

import { getSyncableElements } from ".";

import type { Workspace } from "../tabs/workspace";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

// private
// -----------------------------------------------------------------------------

let FIREBASE_CONFIG: Record<string, any>;
try {
  FIREBASE_CONFIG = JSON.parse(import.meta.env.VITE_APP_FIREBASE_CONFIG);
} catch (error: any) {
  console.warn(
    `Error JSON parsing firebase config. Supplied value: ${
      import.meta.env.VITE_APP_FIREBASE_CONFIG
    }`,
  );
  FIREBASE_CONFIG = {};
}

let firebaseApp: ReturnType<typeof initializeApp> | null = null;
let firestore: ReturnType<typeof getFirestore> | null = null;
let firebaseStorage: ReturnType<typeof getStorage> | null = null;

const _initializeFirebase = () => {
  if (!firebaseApp) {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
  }
  return firebaseApp;
};

const _getFirestore = () => {
  if (!firestore) {
    firestore = getFirestore(_initializeFirebase());
  }
  return firestore;
};

const _getStorage = () => {
  if (!firebaseStorage) {
    firebaseStorage = getStorage(_initializeFirebase());
  }
  return firebaseStorage;
};

// -----------------------------------------------------------------------------

export const loadFirebaseStorage = async () => {
  return _getStorage();
};

type FirebaseStoredScene = {
  sceneVersion: number;
  iv: Bytes;
  ciphertext: Bytes;
};

/** uma aba como ela viaja na sala (id, nome e elementos sincronizáveis) */
export type RoomTab = {
  id: string;
  name: string;
  elements: SyncableExcalidrawElement[];
};

/** o workspace da sala: todas as abas compartilhadas */
export type RoomWorkspace = {
  tabs: RoomTab[];
};

/** qualquer coisa no formato do workspace da sala (a versão local serve) */
type WorkspaceLike = {
  tabs: readonly { elements: readonly ExcalidrawElement[] }[];
};

const workspaceElements = (workspace: WorkspaceLike) =>
  workspace.tabs.reduce<ExcalidrawElement[]>(
    (acc, tab) => acc.concat(tab.elements),
    [],
  );

/**
 * Normaliza o que estava guardado na sala: o formato novo (`{ tabs }`) ou o
 * antigo (um array de elementos, quando a sala tinha uma cena só).
 */
export const normalizeRoomWorkspace = (raw: unknown): RoomWorkspace => {
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { tabs?: unknown }).tabs)
  ) {
    const tabs = ((raw as RoomWorkspace).tabs || [])
      .filter((tab) => tab && typeof tab === "object")
      .map((tab) => ({
        id: typeof tab.id === "string" && tab.id ? tab.id : "default",
        name: typeof tab.name === "string" ? tab.name : "",
        elements: Array.isArray(tab.elements) ? tab.elements : [],
      }));

    return {
      tabs: tabs.length ? tabs : [{ id: "default", name: "", elements: [] }],
    };
  }

  return {
    tabs: [
      {
        id: "default",
        name: "",
        elements: Array.isArray(raw)
          ? (raw as SyncableExcalidrawElement[])
          : [],
      },
    ],
  };
};

const encryptWorkspace = async (
  key: string,
  workspace: RoomWorkspace,
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(workspace);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptWorkspace = async (
  data: FirebaseStoredScene,
  roomKey: string,
): Promise<unknown> => {
  const ciphertext = data.ciphertext.toUint8Array() as Uint8Array<ArrayBuffer>;
  const iv = data.iv.toUint8Array() as Uint8Array<ArrayBuffer>;

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

class FirebaseSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return FirebaseSceneVersionCache.cache.get(socket);
  };
  static set = (socket: Socket, version: number) => {
    FirebaseSceneVersionCache.cache.set(socket, version);
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  workspace: WorkspaceLike,
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(workspaceElements(workspace));

    return FirebaseSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const storage = await loadFirebaseStorage();

  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const storageRef = ref(storage, `${prefix}/${id}`);
        await uploadBytes(storageRef, buffer, {
          cacheControl: `public, max-age=${FILE_CACHE_MAX_AGE_SEC}`,
        });
        savedFiles.push(id);
      } catch (error: any) {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createFirebaseSceneDocument = async (
  workspace: RoomWorkspace,
  roomKey: string,
) => {
  const sceneVersion = getSceneVersion(workspaceElements(workspace));
  const { ciphertext, iv } = await encryptWorkspace(roomKey, workspace);
  return {
    sceneVersion,
    ciphertext: Bytes.fromUint8Array(new Uint8Array(ciphertext)),
    iv: Bytes.fromUint8Array(iv),
  } as FirebaseStoredScene;
};

/** elementos vindos do banco, prontos para reconciliar */
const restoreRoomWorkspace = (workspace: RoomWorkspace): RoomWorkspace => ({
  tabs: workspace.tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    elements: getSyncableElements(
      restoreElements(tab.elements, null, { deleteInvisibleElements: true }),
    ),
  })),
});

/**
 * Reconcilia, aba a aba, o workspace que este cliente quer gravar com o que já
 * está na sala — a mesma lógica de antes, só que por aba (o id da aba é a
 * chave). Abas novas (que a sala ainda não tem) entram inteiras.
 */
const reconcileRoomWorkspace = (
  incoming: RoomWorkspace,
  stored: RoomWorkspace,
  appState: AppState,
): RoomWorkspace => {
  const storedById = new Map(stored.tabs.map((tab) => [tab.id, tab]));

  return {
    tabs: incoming.tabs.map((tab) => {
      const prev = storedById.get(tab.id);
      if (!prev) {
        return {
          ...tab,
          elements: getSyncableElements(tab.elements),
        };
      }

      return {
        ...tab,
        elements: getSyncableElements(
          reconcileElements(
            tab.elements as OrderedExcalidrawElement[],
            prev.elements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
            appState,
          ),
        ),
      };
    }),
  };
};

export const saveToFirebase = async (
  portal: Portal,
  workspace: Workspace,
  appState: AppState,
): Promise<RoomWorkspace | null> => {
  const { roomId, roomKey, socket } = portal;

  const incoming: RoomWorkspace = {
    tabs: workspace.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      elements: getSyncableElements(
        tab.elements as readonly OrderedExcalidrawElement[],
      ),
    })),
  };

  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, incoming)
  ) {
    return null;
  }

  const firestore = _getFirestore();
  const docRef = doc(firestore, "scenes", roomId);

  const storedScene = await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists()) {
      const storedScene = await createFirebaseSceneDocument(incoming, roomKey);

      transaction.set(docRef, storedScene);

      return storedScene;
    }

    const prevStoredScene = snapshot.data() as FirebaseStoredScene;
    const prevWorkspace = restoreRoomWorkspace(
      normalizeRoomWorkspace(await decryptWorkspace(prevStoredScene, roomKey)),
    );

    const mergedWorkspace = reconcileRoomWorkspace(
      incoming,
      prevWorkspace,
      appState,
    );

    const storedScene = await createFirebaseSceneDocument(
      mergedWorkspace,
      roomKey,
    );

    transaction.update(docRef, storedScene);

    // Return the stored scene as the in memory `mergedWorkspace` could have mutated in the meantime
    return storedScene;
  });

  const storedWorkspace = restoreRoomWorkspace(
    normalizeRoomWorkspace(await decryptWorkspace(storedScene, roomKey)),
  );

  FirebaseSceneVersionCache.set(
    socket,
    getSceneVersion(workspaceElements(storedWorkspace)),
  );

  return storedWorkspace;
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<RoomWorkspace | null> => {
  const firestore = _getFirestore();
  const docRef = doc(firestore, "scenes", roomId);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) {
    return null;
  }
  const storedScene = docSnap.data() as FirebaseStoredScene;
  const workspace = restoreRoomWorkspace(
    normalizeRoomWorkspace(await decryptWorkspace(storedScene, roomKey)),
  );

  if (socket) {
    FirebaseSceneVersionCache.set(
      socket,
      getSceneVersion(workspaceElements(workspace)),
    );
  }

  return workspace;
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const url = `https://firebasestorage.googleapis.com/v0/b/${
          FIREBASE_CONFIG.storageBucket
        }/o/${encodeURIComponent(prefix.replace(/^\//, ""))}%2F${id}`;
        const response = await fetch(`${url}?alt=media`);
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
