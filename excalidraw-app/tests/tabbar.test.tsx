import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../App";
import { LocalData } from "../data/LocalData";
import { importWorkspaceFromLocalStorage } from "../data/localStorage";
import { CLOSE_TAB_CONFIRM_DELAY_SECONDS } from "../tabs/CloseTabDialog";

const { h } = window;

vi.mock("../../excalidraw-app/data/firebase.ts", () => {
  return {
    loadFromFirebase: async () => null,
    saveToFirebase: async () => null,
    isSavedToFirebase: () => true,
    loadFilesFromFirebase: async () => ({ loadedFiles: [], erroredFiles: [] }),
    saveFilesToFirebase: async () => ({ savedFiles: [], erroredFiles: [] }),
  };
});

vi.mock("socket.io-client", () => {
  return {
    default: () => ({
      close: () => {},
      on: () => {},
      once: () => {},
      off: () => {},
      emit: () => {},
    }),
  };
});

const elementIds = () => h.elements.map((element) => element.id);

/** abre o app com uma aba só */
const renderApp = async () => {
  window.history.replaceState({}, "", "/");

  await render(<ExcalidrawApp />);
  await waitFor(() => expect(screen.getByTestId("tab-0")).toBeDefined());
};

/**
 * Abre o diálogo de fechar a aba `tabIndex` com a contagem sob controle do
 * teste: os timers falsos são instalados *antes* do clique, senão o timeout de
 * 1s do diálogo nasceria real e `advanceTimersByTime` não teria efeito.
 */
const openCloseDialog = async (tabIndex: number) => {
  vi.useFakeTimers();

  try {
    fireEvent.click(screen.getByTestId(`tab-close-${tabIndex}`));
    // deixa os efeitos do diálogo rodarem (o portal do modal monta num efeito)
    await act(async () => {});

    return screen.getByTestId("close-tab-confirm");
  } catch (error) {
    vi.useRealTimers();
    throw error;
  }
};

/** anda a contagem de segundo em segundo, deixando o React atualizar */
const advanceCountdown = async (seconds: number) => {
  for (let second = 0; second < seconds; second++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
};

describe("barra de abas", () => {
  it("cria abas e mantém a cena de cada uma", async () => {
    await renderApp();

    // o app abre com uma aba só
    expect(screen.queryByTestId("tab-1")).toBeNull();

    // "+" cria a segunda aba e já a deixa em foco
    fireEvent.click(screen.getByTestId("tab-add"));
    await waitFor(() => expect(screen.getByTestId("tab-1")).toBeDefined());

    // desenha na aba 2
    const rect = API.createElement({
      type: "rectangle",
      id: "A",
      width: 100,
      height: 100,
    });
    API.updateScene({
      elements: [rect],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitFor(() => expect(elementIds()).toEqual(["A"]));

    // a aba 1 continua vazia
    fireEvent.click(screen.getByTestId("tab-0"));
    await waitFor(() => expect(h.elements).toEqual([]));

    // e voltar para a aba 2 traz o desenho de volta
    fireEvent.click(screen.getByTestId("tab-1"));
    await waitFor(() => expect(elementIds()).toEqual(["A"]));
  });

  it("nomeia a aba pelo lápis, com espaços no nome", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("tab-rename-0"));

    const input = await waitFor(() => screen.getByTestId("tab-rename-input"));

    // o espaço é do nome: o atalho da aba (Enter/espaço seleciona) não pode
    // engolir a tecla — era o que fazia "Minha aba" virar "Minhaaba"
    const space = createEvent.keyDown(input, { key: " " });
    fireEvent(input, space);
    expect(space.defaultPrevented).toBe(false);
    expect(screen.getByTestId("tab-rename-input")).toBe(input);

    fireEvent.change(input, { target: { value: "Minha aba de trabalho" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("tab-0").textContent).toContain(
        "Minha aba de trabalho",
      ),
    );
    expect(screen.queryByTestId("tab-rename-input")).toBeNull();
  });

  it("guarda o nome da aba sem depender de outra edição", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("tab-rename-0"));
    const input = await waitFor(() => screen.getByTestId("tab-rename-input"));
    fireEvent.change(input, { target: { value: "Minha aba" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("tab-0").textContent).toContain("Minha aba"),
    );

    // renomear agenda o save sozinho: sem isto o nome só chegaria ao servidor
    // na próxima alteração da cena (e se perderia num reload)
    await LocalData.flushSaveAsync();

    expect(
      importWorkspaceFromLocalStorage().tabs.map((tab) => tab.name),
    ).toEqual(["Minha aba"]);
  });

  it("renomeia com duplo clique e desiste com Escape", async () => {
    await renderApp();

    fireEvent.doubleClick(screen.getByTestId("tab-0"));
    const input = await waitFor(() => screen.getByTestId("tab-rename-input"));

    fireEvent.change(input, { target: { value: "Vai ser descartado" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("tab-rename-input")).toBeNull(),
    );
    expect(screen.getByTestId("tab-0").textContent).not.toContain(
      "Vai ser descartado",
    );
  });

  it("fechar a última aba deixa uma aba em branco", async () => {
    await renderApp();

    // a única aba tem conteúdo: é o que se perde ao apagá-la
    API.updateScene({
      elements: [
        API.createElement({
          type: "rectangle",
          id: "A",
          width: 10,
          height: 10,
        }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitFor(() => expect(elementIds()).toEqual(["A"]));

    const confirm = await openCloseDialog(0);

    // confirmar antes da contagem acabar não faz nada
    fireEvent.click(confirm);
    expect(elementIds()).toEqual(["A"]);

    await advanceCountdown(CLOSE_TAB_CONFIRM_DELAY_SECONDS);
    vi.useRealTimers();

    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    // a aba apagada não some do app: sobra uma aba em branco no lugar
    await waitFor(() => expect(h.elements).toEqual([]));
    expect(screen.getByTestId("tab-0")).toBeDefined();
    expect(screen.queryByTestId("tab-1")).toBeNull();
  });

  it("pede confirmação antes de apagar a aba", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("tab-add"));
    await waitFor(() => expect(screen.getByTestId("tab-1")).toBeDefined());

    fireEvent.click(screen.getByTestId("tab-close-1"));

    const confirm = await waitFor(() =>
      screen.getByTestId("close-tab-confirm"),
    );

    // é um diálogo do app (não o alert/confirm do navegador) e a aba continua lá
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByTestId("tab-1")).toBeDefined();

    // o apagar só libera depois da contagem, que aparece no próprio botão
    expect(confirm).toBeDisabled();
    expect(confirm.textContent).toMatch(
      new RegExp(`\\(${CLOSE_TAB_CONFIRM_DELAY_SECONDS}\\)$`),
    );

    // cancelar fecha o diálogo sem apagar nada
    fireEvent.click(screen.getByTestId("close-tab-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("close-tab-confirm")).toBeNull(),
    );
    expect(screen.getByTestId("tab-1")).toBeDefined();
  });

  it("libera o apagar depois da contagem e apaga a aba", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("tab-add"));
    await waitFor(() => expect(screen.getByTestId("tab-1")).toBeDefined());

    const confirm = await openCloseDialog(1);
    expect(confirm).toBeDisabled();

    try {
      // a contagem anda de segundo em segundo
      await advanceCountdown(1);
      expect(confirm.textContent).toMatch(
        new RegExp(`\\(${CLOSE_TAB_CONFIRM_DELAY_SECONDS - 1}\\)$`),
      );

      await advanceCountdown(CLOSE_TAB_CONFIRM_DELAY_SECONDS - 1);
    } finally {
      vi.useRealTimers();
    }

    // acabou a contagem: sem os segundos no rótulo e o botão liberado
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(confirm.textContent).not.toMatch(/\(/);

    fireEvent.click(confirm);

    // a aba vai embora e a primeira continua
    await waitFor(() => expect(screen.queryByTestId("tab-1")).toBeNull());
    expect(screen.getByTestId("tab-0")).toBeDefined();
    expect(screen.queryByTestId("close-tab-confirm")).toBeNull();
  });
});
