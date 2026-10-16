import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../App";

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

describe("barra de abas", () => {
  it("cria abas e mantém a cena de cada uma", async () => {
    window.history.replaceState({}, "", "/");

    await render(<ExcalidrawApp />);

    // o app abre com uma aba só
    await waitFor(() => expect(screen.getByTestId("tab-0")).toBeDefined());
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

  it("fechar a última aba deixa uma aba em branco", async () => {
    window.history.replaceState({}, "", "/");

    await render(<ExcalidrawApp />);
    await waitFor(() => expect(screen.getByTestId("tab-0")).toBeDefined());

    fireEvent.click(screen.getByTestId("tab-close-0"));

    await waitFor(() => expect(screen.getByTestId("tab-0")).toBeDefined());
    expect(screen.queryByTestId("tab-1")).toBeNull();
  });
});
