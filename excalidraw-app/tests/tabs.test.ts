import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  applyRemoteTabs,
  bindWorkspace,
  closeTab,
  createTabAfterActive,
  getActiveTabId,
  getCanvasTabId,
  getTabScene,
  getTabs,
  getWorkspace,
  moveTab,
  renameTab,
  selectTab,
  setCanvasTabId,
  setTabScene,
  updateActiveTabScene,
} from "../tabs/tabs-store";
import {
  createWorkspace,
  getActiveTab,
  normalizeWorkspace,
} from "../tabs/workspace";

const element = (id: string) =>
  ({ id, version: 1, isDeleted: false } as ExcalidrawElement);

const tabIds = () => getTabs().map((tab) => tab.id);

describe("workspace", () => {
  it("trata a cena única antiga como uma aba", () => {
    const workspace = normalizeWorkspace({
      elements: [element("el1")],
      appState: { viewBackgroundColor: "#a5d8ff" },
    });

    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs[0].elements).toEqual([element("el1")]);
    expect(workspace.tabs[0].appState).toEqual({
      viewBackgroundColor: "#a5d8ff",
    });
    expect(workspace.activeTabId).toBe(workspace.tabs[0].id);
  });

  it("trata um array de elementos solto como uma aba", () => {
    const workspace = normalizeWorkspace([element("solto")]);
    expect(workspace.tabs[0].elements).toEqual([element("solto")]);
  });

  it("sempre devolve ao menos uma aba ativa válida", () => {
    expect(normalizeWorkspace(null).tabs).toHaveLength(1);
    expect(normalizeWorkspace({ tabs: [] }).tabs).toHaveLength(1);

    const workspace = normalizeWorkspace({
      tabs: [{ id: "a" }, { id: "b" }],
      // id que não existe: cai na primeira aba
      activeTabId: "nao-existe",
    });

    expect(workspace.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(workspace.activeTabId).toBe("a");
  });

  it("preserva o workspace novo no round-trip", () => {
    const workspace = normalizeWorkspace({
      tabs: [
        { id: "t1", name: "Primeira", elements: [element("a")], appState: {} },
        { id: "t2", name: "", elements: [element("b")], appState: {} },
      ],
      activeTabId: "t2",
    });

    expect(workspace.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    expect(workspace.activeTabId).toBe("t2");
    expect(getActiveTab(workspace).elements).toEqual([element("b")]);
  });
});

describe("abas", () => {
  beforeEach(() => {
    bindWorkspace(createWorkspace());
  });

  it("cria uma aba e mantém a nova em foco", () => {
    const first = getActiveTabId();
    const created = createTabAfterActive("Nova");

    expect(getTabs().map((tab) => tab.name)).toEqual(["", "Nova"]);
    expect(getActiveTabId()).toBe(created);
    expect(created).not.toBe(first);
  });

  it("guarda a cena de cada aba separadamente", () => {
    const first = getActiveTabId();
    const second = createTabAfterActive("Segunda");

    setTabScene(first, { elements: [element("da-primeira")], appState: {} });
    setTabScene(second, { elements: [element("da-segunda")], appState: {} });

    expect(getTabScene(first)?.elements).toEqual([element("da-primeira")]);
    expect(getTabScene(second)?.elements).toEqual([element("da-segunda")]);
  });

  it("espelha a cena do canvas na aba que ele mostra", () => {
    const first = getActiveTabId();
    setCanvasTabId(first);
    updateActiveTabScene({ elements: [element("do-canvas")], appState: {} });
    expect(getTabScene(first)?.elements).toEqual([element("do-canvas")]);
  });

  it("no instante da troca, o editor ainda grava na aba que está no canvas", () => {
    const first = getActiveTabId();
    const second = createTabAfterActive();

    // o canvas ainda mostra a primeira, embora o foco já tenha ido embora
    setCanvasTabId(first);
    selectTab(second);

    updateActiveTabScene({
      elements: [element("ainda-na-primeira")],
      appState: {},
    });

    expect(getTabScene(first)?.elements).toEqual([
      element("ainda-na-primeira"),
    ]);
    expect(getTabScene(second)?.elements ?? []).toEqual([]);
    expect(getCanvasTabId()).toBe(first);
  });

  it("fecha a aba ativa e foca a vizinha", () => {
    const a = getActiveTabId();
    const b = createTabAfterActive();
    const c = createTabAfterActive();

    selectTab(b);
    expect(closeTab(b)).toBe(c);
    expect(tabIds()).toEqual([a, c]);
    expect(getTabScene(b)).toBeUndefined();
  });

  it("nunca fica sem aba: a última vira uma aba em branco", () => {
    const only = getActiveTabId();
    const nextActive = closeTab(only);

    expect(getTabs()).toHaveLength(1);
    expect(nextActive).not.toBe(only);
    expect(getActiveTabId()).toBe(nextActive);
  });

  it("não deixa a aba ativa apontar para uma aba que não existe", () => {
    const a = getActiveTabId();
    const b = createTabAfterActive();
    selectTab(b);
    closeTab(a);
    expect(tabIds()).toContain(getActiveTabId());
  });

  it("renomeia e reordena", () => {
    const a = getActiveTabId();
    const b = createTabAfterActive();
    const c = createTabAfterActive();

    renameTab(a, "Renomeada");
    expect(getTabs()[0].name).toBe("Renomeada");

    moveTab(c, 0);
    expect(tabIds()).toEqual([c, a, b]);
  });

  it("o workspace devolvido reflete as abas e a cena ativa", () => {
    const first = getActiveTabId();
    const second = createTabAfterActive("Segunda");

    setTabScene(first, { elements: [element("primeira")], appState: {} });
    setCanvasTabId(second);
    updateActiveTabScene({ elements: [element("segunda")], appState: {} });

    const workspace = getWorkspace();
    expect(workspace.activeTabId).toBe(second);
    expect(workspace.tabs.map((tab) => tab.id)).toEqual([first, second]);
    expect(workspace.tabs[0].elements).toEqual([element("primeira")]);
    expect(workspace.tabs[1].elements).toEqual([element("segunda")]);
  });
});

describe("abas vindas da sala", () => {
  beforeEach(() => {
    bindWorkspace(createWorkspace());
  });

  it("entrar numa sala adota as abas de lá", () => {
    // aba local em branco e sem nome: não deve sobreviver à entrada
    applyRemoteTabs(
      [
        { id: "r1", name: "" },
        { id: "r2", name: "Do time" },
      ],
      { merge: false },
    );

    expect(tabIds()).toEqual(["r1", "r2"]);
    expect(getTabs()[1].name).toBe("Do time");
  });

  it("na sala fixa da conta as abas locais com conteúdo são preservadas", () => {
    const local = createTabAfterActive("Minha");
    setTabScene(local, { elements: [element("meu")], appState: {} });

    applyRemoteTabs([{ id: "r1", name: "" }], { merge: true });

    expect(tabIds()).toEqual(["r1", local]);
  });

  it("aba fechada na sala desaparece aqui, mas as locais ficam", () => {
    applyRemoteTabs([{ id: "r1", name: "" }], { merge: true });
    const local = createTabAfterActive("Minha");

    // r1 era conhecida da sala e sumiu: foi fechada lá
    applyRemoteTabs([{ id: "r2", name: "" }], { merge: true });

    expect(tabIds()).toEqual(["r2", local]);
    expect(getTabScene("r1")).toBeUndefined();
  });
});
