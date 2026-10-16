import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { STORAGE_KEYS } from "../app_constants";
import { createAccount, logout } from "../auth/session";
import { LocalData } from "../data/LocalData";
import {
  bindWorkspace,
  getWorkspace,
  setCanvasTabId,
} from "../tabs/tabs-store";
import { normalizeWorkspace } from "../tabs/workspace";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

const element = (id: string) => ({ id, isDeleted: false } as ExcalidrawElement);

const scoped = (key: string, accountId: string) => `${key}:${accountId}`;

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

const currentAccountId = () => [...server.accounts.keys()].at(-1)!;

describe("persistência das abas", () => {
  it("grava e restaura todas as abas, com a aba ativa", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();

    bindWorkspace(
      normalizeWorkspace({
        tabs: [
          {
            id: "t1",
            name: "Primeira",
            elements: [element("a1")],
            appState: {},
          },
          {
            id: "t2",
            name: "Segunda",
            elements: [element("b1")],
            appState: {},
          },
        ],
        activeTabId: "t2",
      }),
    );

    LocalData.saveWorkspace(getWorkspace(), {}, () => {});
    LocalData.flushSave();

    await vi.waitFor(() => expect(server.scenes.size).toBe(1));

    const workspace = await LocalData.loadWorkspace();
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    expect(workspace.tabs.map((tab) => tab.name)).toEqual([
      "Primeira",
      "Segunda",
    ]);
    expect(workspace.activeTabId).toBe("t2");
    expect(workspace.tabs[0].elements).toEqual([element("a1")]);
    expect(workspace.tabs[1].elements).toEqual([element("b1")]);

    // a cópia local do navegador guarda o workspace inteiro
    const cached = localStorage.getItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, accountId),
    );
    expect(cached).toContain("a1");
    expect(cached).toContain("b1");
  });

  it("o save do canvas entra na aba ativa, sem tocar nas outras", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });

    bindWorkspace(
      normalizeWorkspace({
        tabs: [
          { id: "t1", name: "", elements: [], appState: {} },
          { id: "t2", name: "", elements: [], appState: {} },
        ],
        activeTabId: "t2",
      }),
    );
    // o canvas mostra a aba 2: é nela que o save do editor entra
    setCanvasTabId("t2");

    LocalData.save(
      [element("no-canvas")],
      { viewBackgroundColor: "#a5d8ff" } as AppState,
      {},
      () => {},
    );
    LocalData.flushSave();

    await vi.waitFor(() => expect(server.scenes.size).toBe(1));

    const workspace = await LocalData.loadWorkspace();
    expect(workspace.tabs[1].elements).toEqual([element("no-canvas")]);
    expect(workspace.tabs[1].appState).toMatchObject({
      viewBackgroundColor: "#a5d8ff",
    });
    expect(workspace.tabs[0].elements).toEqual([]);
  });

  it("migra a cena única guardada no navegador para uma aba", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    const accountId = currentAccountId();

    localStorage.setItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS, accountId),
      JSON.stringify([element("velho")]),
    );
    localStorage.setItem(
      scoped(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE, accountId),
      JSON.stringify({ viewBackgroundColor: "#ffffff" }),
    );

    // sem banco: a cópia do navegador é o que vale
    server.fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });

    const workspace = await LocalData.loadWorkspace();
    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs[0].elements).toEqual([element("velho")]);
    expect(workspace.tabs[0].appState).toMatchObject({
      viewBackgroundColor: "#ffffff",
    });
  });
});
