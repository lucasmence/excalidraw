import type { AppState, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { STORAGE_KEYS } from "../app_constants";
import { createAccount, logout } from "../auth/session";
import { LocalData } from "../data/LocalData";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const element = (id: string) => ({ id, isDeleted: false } as ExcalidrawElement);
const fid = (id: string) => id as FileId;

/** o FileManager só salva imagens referenciadas por elementos do tipo `image` */
const imageElement = (fileId: string) =>
  ({
    id: `element-${fileId}`,
    type: "image",
    fileId: fid(fileId),
    status: "saved",
    isDeleted: false,
  } as unknown as ExcalidrawElement);

const makeAppState = (viewBackgroundColor: string) =>
  ({ viewBackgroundColor } as Partial<AppState>);

const scoped = (key: string, accountId: string) => `${key}:${accountId}`;

const seedLocalCopy = (accountId: string, ids: string[]) => {
  localStorage.setItem(
    scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, accountId),
    JSON.stringify(ids.map(element)),
  );
  localStorage.setItem(
    scoped(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE, accountId),
    JSON.stringify({ viewBackgroundColor: "#ffffff" }),
  );
};

let server: ReturnType<typeof createFakeApiServer>;

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** a conta criada por último (a que está ativa no teste) */
const currentAccountId = () => [...server.accounts.keys()].at(-1)!;

describe("LocalData", () => {
  it("grava a cena no banco e restaura no próximo load", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    LocalData.save(
      [element("el1")],
      makeAppState("#a5d8ff") as AppState,
      {},
      () => {},
    );
    LocalData.flushSave();

    await vi.waitFor(() => expect(server.scenes.size).toBe(1));

    const { elements, appState } = await LocalData.loadScene();
    expect(elements).toEqual([element("el1")]);
    expect(appState?.viewBackgroundColor).toBe("#a5d8ff");

    // e a cópia local fica como cache, com a chave da conta
    expect(
      localStorage.getItem(
        scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, currentAccountId()),
      ),
    ).toContain("el1");
  });

  it("marca pendência quando o save não chega ao banco", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();

    server.fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    LocalData.save(
      [element("offline")],
      makeAppState("#ffffff") as AppState,
      {},
      () => {},
    );
    LocalData.flushSave();

    await vi.waitFor(() =>
      expect(
        localStorage.getItem(
          scoped(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC, accountId),
        ),
      ).toBe("1"),
    );

    expect(
      localStorage.getItem(
        scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, accountId),
      ),
    ).toContain("offline");
  });

  it("usa a cópia local quando a API está fora do ar", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    seedLocalCopy(currentAccountId(), ["local-1"]);

    server.fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(LocalData.loadScene()).resolves.toMatchObject({
      elements: [element("local-1")],
    });
  });

  it("reenvia a cópia local quando o save anterior falhou", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();
    seedLocalCopy(accountId, ["so-no-navegador"]);
    localStorage.setItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC, accountId),
      "1",
    );

    const { elements } = await LocalData.loadScene();

    expect(elements).toEqual([element("so-no-navegador")]);
    await vi.waitFor(() => expect(server.scenes.get(accountId)).toBeDefined());
    expect(
      localStorage.getItem(
        scoped(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC, accountId),
      ),
    ).toBeNull();
  });

  it("não mistura dados entre contas do mesmo navegador", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const aliceId = currentAccountId();
    localStorage.setItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, aliceId),
      JSON.stringify([element("da-alice")]),
    );

    logout();
    await createAccount({ loginKey: BOB_KEY, remember: false });
    const bobId = currentAccountId();

    expect(bobId).not.toBe(aliceId);
    await expect(LocalData.loadScene()).resolves.toMatchObject({
      elements: [],
    });

    // a cópia da Alice continua no lugar dela, intocada
    expect(
      localStorage.getItem(
        scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, aliceId),
      ),
    ).toContain("da-alice");
  });

  it("apaga a cópia local da conta ao sair", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();
    seedLocalCopy(accountId, ["el1"]);
    localStorage.setItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC, accountId),
      "1",
    );

    LocalData.clearAccountData();

    for (const key of [
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      STORAGE_KEYS.LOCAL_STORAGE_PENDING_SYNC,
      STORAGE_KEYS.LOCAL_STORAGE_FILE_USAGE,
    ]) {
      expect(localStorage.getItem(scoped(key, accountId))).toBeNull();
    }
  });

  it("poda no servidor as imagens que ficaram órfãs", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();

    const used = {
      id: fid("em-uso"),
      mimeType: "image/png",
      dataURL: "data:image/png;base64,USADA" as BinaryFileData["dataURL"],
      created: 1,
      lastRetrieved: Date.now(),
    } as BinaryFileData;
    const old = {
      id: fid("esquecida"),
      mimeType: "image/png",
      dataURL: "data:image/png;base64,VELHA" as BinaryFileData["dataURL"],
      created: 1,
      // usada ontem → pode sair
      lastRetrieved: Date.now() - 25 * 3600 * 1000,
    } as BinaryFileData;

    await LocalData.fileStorage.saveFiles({
      elements: [imageElement("em-uso"), imageElement("esquecida")],
      files: { [used.id]: used, [old.id]: old },
    });

    expect(server.files.get(accountId)?.size).toBe(2);

    await LocalData.fileStorage.clearObsoleteFiles({
      currentFileIds: [used.id],
    });

    const remaining = [...(server.files.get(accountId)?.values() ?? [])];
    expect(remaining).toHaveLength(1);
  });
});
