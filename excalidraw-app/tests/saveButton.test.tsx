import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../App";
import {
  bindAccountStore,
  createAccount,
  logout,
  markLoginKeyRevealed,
  type AccountState,
} from "../auth/session";
import {
  SAVE_COOLDOWN_SECONDS,
  SAVED_LABEL_SECONDS,
} from "../components/SaveButton";
import { LocalData } from "../data/LocalData";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

// a sala da conta conecta sozinha ao abrir o app: nada de rede de verdade
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

vi.mock("../data/firebase.ts", () => ({
  loadFromFirebase: async () => null,
  saveToFirebase: async () => null,
  isSavedToFirebase: () => true,
  loadFilesFromFirebase: async () => ({ loadedFiles: [], erroredFiles: [] }),
  saveFilesToFirebase: async () => ({ savedFiles: [], erroredFiles: [] }),
}));

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

let server: ReturnType<typeof createFakeApiServer>;

const elementIds = () => window.h.elements.map((element) => element.id);

/** saves da cena que chegaram à API nesta sessão de teste */
const sceneWrites = () =>
  server.calls.filter(
    (call) => call.method === "PUT" && call.path === "/api/scene",
  );

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
  bindAccountStore((_state: AccountState) => {});
});

afterEach(() => {
  vi.useRealTimers();
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const renderAppWithAccount = async () => {
  await createAccount({ loginKey: ALICE_KEY, remember: true });
  await markLoginKeyRevealed();

  await render(<ExcalidrawApp />);
  await waitFor(() => expect(elementIds()).toEqual([]));
};

describe("botão de salvar", () => {
  it("fica ao lado do menu, na linha do canto esquerdo", async () => {
    await renderAppWithAccount();

    const button = screen.getByTestId("save-button");
    const row = button.closest(".excalidraw-ui-top-left");

    expect(row).not.toBeNull();
    // a mesma linha do menu: é "ao lado do menu", não noutro canto
    expect(row?.querySelector('[data-testid="main-menu-trigger"]')).not.toBe(
      null,
    );
    expect(button).toHaveAccessibleName("Save");
    expect(button).not.toBeDisabled();
  });

  it("grava a cena no banco e trava por 20 segundos", async () => {
    await renderAppWithAccount();

    await act(async () => {
      API.updateScene({
        elements: [API.createElement({ type: "rectangle", id: "A" })],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await waitFor(() => expect(elementIds()).toEqual(["A"]));
    // o save automático (debounced) termina; o botão é outro caminho
    await LocalData.flushSaveAsync();

    const writesBefore = sceneWrites().length;

    // a trava é contada em segundos de relógio: com timers falsos o teste não
    // espera 20 s de verdade
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByTestId("save-button"));
      await vi.advanceTimersByTimeAsync(1000);
    });

    // o clique foi até a API...
    expect(sceneWrites().length).toBeGreaterThan(writesBefore);
    // ...o botão ficou travado e confirma que salvou
    expect(screen.getByTestId("save-button")).toBeDisabled();
    expect(screen.getByTestId("save-button")).toHaveAccessibleName("Saved");

    // passada a confirmação, o rótulo mostra a contagem da trava
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVED_LABEL_SECONDS * 1000);
    });
    expect(screen.getByTestId("save-button")).toHaveAccessibleName(
      `Save (${SAVE_COOLDOWN_SECONDS - SAVED_LABEL_SECONDS - 1}s)`,
    );

    // e destrava sozinho quando a contagem acaba
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_COOLDOWN_SECONDS * 1000);
    });

    expect(screen.getByTestId("save-button")).not.toBeDisabled();
    expect(screen.getByTestId("save-button")).toHaveAccessibleName("Save");
  });
});
