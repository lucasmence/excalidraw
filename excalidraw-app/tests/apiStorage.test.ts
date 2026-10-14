import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { createAccount, login, logout } from "../auth/session";
import {
  fetchRemoteFiles,
  fetchRemoteLibrary,
  fetchRemoteScene,
  isRemoteStorageEnabled,
  pruneRemoteFiles,
  remoteFileKey,
  saveRemoteFiles,
  saveRemoteLibrary,
  saveRemoteScene,
} from "../data/apiStorage";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

/** vetores de teste do BIP39 */
const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const element = (id: string) => ({ id, isDeleted: false } as ExcalidrawElement);

const fid = (id: string) => id as FileId;

const makeFile = (id: string, dataURL: string): BinaryFileData => ({
  id: fid(id),
  mimeType: "image/png",
  dataURL: dataURL as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
});

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

describe("apiStorage", () => {
  it("usa a API por padrão e o navegador com VITE_APP_STORAGE=browser", () => {
    expect(isRemoteStorageEnabled()).toBe(true);
    vi.stubEnv("VITE_APP_STORAGE", "browser");
    expect(isRemoteStorageEnabled()).toBe(false);
  });

  it("não fala com o servidor sem conta ativa", async () => {
    await expect(fetchRemoteScene()).rejects.toThrow("Nenhuma conta ativa");
    await expect(
      saveRemoteScene({ elements: [], appState: {} }),
    ).rejects.toThrow("Nenhuma conta ativa");
  });

  it("grava a cena cifrada e devolve igual na leitura", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    const elements = [element("SECRET-ELEMENT")];
    const appState = { viewBackgroundColor: "#ffec99" };

    await saveRemoteScene({ elements, appState });

    // o servidor não pode ter visto nada em texto puro
    expect(server.dump()).not.toContain("SECRET-ELEMENT");
    expect(server.dump()).not.toContain("#ffec99");
    expect(server.dump()).not.toContain(ALICE_KEY.split(" ")[0]);

    await expect(fetchRemoteScene()).resolves.toEqual({ elements, appState });
  });

  it("manda a credencial da conta no header", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    await saveRemoteScene({ elements: [], appState: {} });

    const sceneCall = server.calls.find((call) => call.path === "/api/scene");
    expect(sceneCall?.method).toBe("PUT");
  });

  it("isola as contas: cada uma vê só a própria cena", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    await saveRemoteScene({
      elements: [element("da-alice")],
      appState: {},
    });

    logout();
    await createAccount({ loginKey: BOB_KEY, remember: false });
    await expect(fetchRemoteScene()).resolves.toBeNull();

    await saveRemoteScene({ elements: [element("do-bob")], appState: {} });
    logout();

    await login({ loginKey: ALICE_KEY, remember: false });
    await expect(fetchRemoteScene()).resolves.toEqual({
      elements: [element("da-alice")],
      appState: {},
    });
  });

  it("grava imagens endereçadas por índice cego", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    const file = makeFile("file-1", "data:image/png;base64,SUPERSECRETO");
    const { savedFiles, erroredFiles } = await saveRemoteFiles(
      new Map([[file.id, file]]),
    );

    expect([...savedFiles.keys()]).toEqual(["file-1"]);
    expect(erroredFiles.size).toBe(0);

    // no banco o id real não aparece: só o índice cego derivado da chave
    expect(server.dump()).not.toContain("file-1");
    expect(server.dump()).not.toContain("SUPERSECRETO");

    const storedKeys = [
      ...(server.files.get([...server.accounts.keys()][0]) ?? new Map()).keys(),
    ];
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0]).toBe(await remoteFileKey(file.id));
    expect(storedKeys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const { loadedFiles, erroredFiles: errors } = await fetchRemoteFiles([
      file.id,
      fid("arquivo-que-nao-existe"),
    ]);

    expect(loadedFiles).toHaveLength(1);
    expect(loadedFiles[0].dataURL).toBe("data:image/png;base64,SUPERSECRETO");
    expect([...errors.keys()]).toEqual(["arquivo-que-nao-existe"]);
  });

  it("poda só as imagens indicadas e respeita o keep", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    const a = makeFile("file-a", "data:image/png;base64,AAAA");
    const b = makeFile("file-b", "data:image/png;base64,BBBB");
    await saveRemoteFiles(
      new Map([
        [a.id, a],
        [b.id, b],
      ]),
    );

    await expect(
      pruneRemoteFiles({ remove: [a.id, b.id], keep: [a.id] }),
    ).resolves.toBe(1);

    const { loadedFiles } = await fetchRemoteFiles([a.id, b.id]);
    expect(loadedFiles.map((file) => file.id)).toEqual(["file-a"]);
  });

  it("grava e lê a biblioteca cifrada", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    const libraryItems = [
      { id: "LIB-SECRETA", status: "published", created: 1, elements: [] },
    ];

    await saveRemoteLibrary({
      libraryItems,
    } as unknown as LibraryPersistedData);

    expect(server.dump()).not.toContain("LIB-SECRETA");
    await expect(fetchRemoteLibrary()).resolves.toEqual({ libraryItems });
  });

  it("não deixa uma conta ler o envelope cifrado de outra", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    await saveRemoteScene({ elements: [element("da-alice")], appState: {} });
    const aliceAccountId = [...server.accounts.keys()][0];

    logout();
    await createAccount({ loginKey: BOB_KEY, remember: false });

    // servidor devolve o envelope da Alice para a conta do Bob (simulando um
    // banco adulterado): a `aad` da conta impede a decifragem
    server.scenes.set(
      [...server.accounts.keys()][1],
      server.scenes.get(aliceAccountId)!,
    );

    await expect(fetchRemoteScene()).rejects.toThrow();
  });
});
