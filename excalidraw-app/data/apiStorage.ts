/**
 * Persistência remota da conta (server/index.mjs).
 *
 * Tudo o que sai daqui está cifrado com a chave derivada da chave de login:
 * cena e biblioteca viram um envelope AES-GCM, e cada imagem vira um envelope
 * endereçado por um *índice cego* (HMAC do id real). Assim o servidor consegue
 * guardar e devolver os dados sem saber o que eles são — nem quais são os ids
 * dos arquivos.
 *
 * Quem decide *quando* usar a API (e o que fazer se ela estiver fora do ar) é o
 * `LocalData`, que cai para o storage do navegador como cache/fallback.
 */
import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import {
  blindIndex,
  decryptJson,
  encryptJson,
  isEncryptedPayload,
  type EncryptedPayload,
} from "../auth/crypto";
import { aadFor } from "../auth/keys";
import { requireActiveSession } from "../auth/session";

import { api, isRemoteStorageEnabled } from "./apiClient";

import type { Workspace } from "../tabs/workspace";

export { isRemoteStorageEnabled };

export type RemoteFiles = {
  loadedFiles: BinaryFileData[];
  erroredFiles: Map<FileId, true>;
};

/** conteúdo cifrado de uma imagem, como guardado no banco */
type StoredFile = {
  id: FileId;
  mimeType: string;
  dataURL: string;
  created?: number;
  lastRetrieved?: number;
};

/** separa o conteúdo do arquivo do `id` (que vira índice cego, fora do envelope) */
const storedFile = (id: FileId, fileData: BinaryFileData): StoredFile => ({
  id,
  mimeType: fileData.mimeType,
  dataURL: fileData.dataURL,
  created: fileData.created ?? Date.now(),
  lastRetrieved: fileData.lastRetrieved ?? Date.now(),
});

const sceneAad = (accountId: string) => aadFor(accountId, "scene");
const libraryAad = (accountId: string) => aadFor(accountId, "library");
const fileAad = (accountId: string) => aadFor(accountId, "file");

/** id real do arquivo → índice cego que o servidor usa como chave da linha */
export const remoteFileKey = async (id: FileId) => {
  const { keys } = requireActiveSession();
  return blindIndex({ key: keys.indexKey, namespace: "file", value: id });
};

// -----------------------------------------------------------------------------
// cena
// -----------------------------------------------------------------------------

export const fetchRemoteWorkspace = async (): Promise<unknown> => {
  const { accountId, keys } = requireActiveSession();
  const data = await api.get<{ scene: unknown }>("/scene", keys.authSecret);

  if (!isEncryptedPayload(data?.scene)) {
    return null;
  }

  return decryptJson<unknown>({
    key: keys.contentKey,
    aad: sceneAad(accountId),
    payload: data.scene,
  });
};

export const saveRemoteWorkspace = async (workspace: Workspace) => {
  const { accountId, keys } = requireActiveSession();

  const payload = await encryptJson({
    key: keys.contentKey,
    aad: sceneAad(accountId),
    value: workspace,
  });

  await api.put("/scene", { payload }, keys.authSecret);
};

// -----------------------------------------------------------------------------
// imagens
// -----------------------------------------------------------------------------

export const fetchRemoteFiles = async (ids: FileId[]): Promise<RemoteFiles> => {
  const erroredFiles = new Map<FileId, true>();

  if (!ids.length) {
    return { loadedFiles: [], erroredFiles };
  }

  const { accountId, keys } = requireActiveSession();

  const keysById = new Map<FileId, string>();
  for (const id of ids) {
    keysById.set(id, await remoteFileKey(id));
  }

  const data = await api.get<{ files: { key: string; payload: unknown }[] }>(
    `/files?keys=${encodeURIComponent([...keysById.values()].join(","))}`,
    keys.authSecret,
  );

  const byKey = new Map((data?.files || []).map((file) => [file.key, file]));

  const loadedFiles: BinaryFileData[] = [];

  for (const [id, key] of keysById) {
    const entry = byKey.get(key);

    if (!entry || !isEncryptedPayload(entry.payload)) {
      erroredFiles.set(id, true);
      continue;
    }

    try {
      const file = await decryptJson<StoredFile>({
        key: keys.contentKey,
        aad: fileAad(accountId),
        payload: entry.payload,
      });

      loadedFiles.push({
        id: file.id,
        mimeType: file.mimeType,
        dataURL: file.dataURL as BinaryFileData["dataURL"],
        created: file.created,
        lastRetrieved: Date.now(),
      } as BinaryFileData);
    } catch (error) {
      console.warn("[storage] imagem ilegível nesta conta", error);
      erroredFiles.set(id, true);
    }
  }

  return { loadedFiles, erroredFiles };
};

export const saveRemoteFiles = async (
  addedFiles: Map<FileId, BinaryFileData>,
): Promise<{
  savedFiles: Map<FileId, BinaryFileData>;
  erroredFiles: Map<FileId, BinaryFileData>;
}> => {
  const savedFiles = new Map<FileId, BinaryFileData>();
  const erroredFiles = new Map<FileId, BinaryFileData>();

  if (!addedFiles.size) {
    return { savedFiles, erroredFiles };
  }

  const { accountId, keys } = requireActiveSession();

  const files = await Promise.all(
    [...addedFiles].map(async ([id, fileData]) => ({
      key: await remoteFileKey(id),
      payload: await encryptJson({
        key: keys.contentKey,
        aad: fileAad(accountId),
        value: storedFile(id, fileData),
      }),
    })),
  );

  const response = await api.put<{ saved: string[] }>(
    "/files",
    { files },
    keys.authSecret,
  );
  const savedKeys = new Set(response?.saved ?? []);

  for (const [id, fileData] of addedFiles) {
    if (savedKeys.has(await remoteFileKey(id))) {
      savedFiles.set(id, fileData);
    } else {
      erroredFiles.set(id, fileData);
    }
  }

  return { savedFiles, erroredFiles };
};

/** remove do banco as imagens que o cliente sabe que ficaram órfãs */
export const pruneRemoteFiles = async ({
  remove,
  keep,
}: {
  remove: FileId[];
  keep: FileId[];
}) => {
  if (!remove.length) {
    return 0;
  }

  const { keys } = requireActiveSession();

  const data = await api.post<{ deleted: number }>(
    "/files/prune",
    {
      remove: await Promise.all(remove.map((id) => remoteFileKey(id))),
      keep: await Promise.all(keep.map((id) => remoteFileKey(id))),
    },
    keys.authSecret,
  );

  return data?.deleted ?? 0;
};

// -----------------------------------------------------------------------------
// biblioteca
// -----------------------------------------------------------------------------

export const fetchRemoteLibrary =
  async (): Promise<LibraryPersistedData | null> => {
    const { accountId, keys } = requireActiveSession();
    const data = await api.get<{ library: unknown }>(
      "/library",
      keys.authSecret,
    );

    if (!isEncryptedPayload(data?.library)) {
      return null;
    }

    return decryptJson<LibraryPersistedData>({
      key: keys.contentKey,
      aad: libraryAad(accountId),
      payload: data.library,
    });
  };

export const saveRemoteLibrary = async (data: LibraryPersistedData) => {
  const { accountId, keys } = requireActiveSession();

  const payload: EncryptedPayload = await encryptJson({
    key: keys.contentKey,
    aad: libraryAad(accountId),
    value: { libraryItems: data.libraryItems ?? [] },
  });

  await api.put("/library", { payload }, keys.authSecret);
};
