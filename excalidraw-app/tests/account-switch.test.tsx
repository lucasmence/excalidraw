import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../App";
import { switchToAccount } from "../account/account-actions";
import { resetAccountSwitch } from "../account/account-switch";
import {
  bindAccountStore,
  createAccount,
  logout,
  markLoginKeyRevealed,
  type AccountState,
} from "../auth/session";
import { LocalData } from "../data/LocalData";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

// a recarga é observada, não executada: o jsdom não navega (e é justamente a
// recarga que a troca de conta espera que aconteça)
vi.mock("../account/reload", () => ({ reloadApp: vi.fn() }));

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

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const element = (id: string) =>
  API.createElement({ type: "rectangle", id, width: 100, height: 100 });

let server: ReturnType<typeof createFakeApiServer>;

/** conta pronta no servidor e guardada neste navegador (a última fica ativa) */
const givenAccount = async (loginKey: string) => {
  await createAccount({ loginKey, remember: true });
  await markLoginKeyRevealed();
  return [...server.accounts.keys()].at(-1)!;
};

const elementIds = () => window.h.elements.map((element) => element.id);

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  // a troca de conta termina em recarga na vida real; aqui o módulo é o mesmo
  // entre os testes, então cada um começa antes da troca
  resetAccountSwitch();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
  bindAccountStore((_state: AccountState) => {});
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("troca de conta", () => {
  it("não bloqueia a recarga que a própria troca de conta faz", async () => {
    const alice = await givenAccount(ALICE_KEY);
    await givenAccount(BOB_KEY);

    await render(<ExcalidrawApp />);
    await waitFor(() => expect(window.collab.isCollaborating()).toBe(true));

    // a conta ativa desenha: a sala fica com alteração que ainda não foi
    // gravada — é o estado em que o `Collab` arma o aviso de saída
    await act(async () => {
      API.updateScene({
        elements: [element("da-bob")],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await waitFor(() => expect(elementIds()).toEqual(["da-bob"]));

    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    // sair no meio de uma edição continua merecendo o aviso do navegador
    expect(before.defaultPrevented).toBe(true);

    await act(async () => {
      await switchToAccount(alice);
    });

    // a troca recarrega o app para carregar a cena da conta que entrou: esse
    // aviso não pode barrar a recarga que a própria troca disparou
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("não grava a cena de quem saiu na conta que entrou", async () => {
    const alice = await givenAccount(ALICE_KEY);
    await givenAccount(BOB_KEY);

    await render(<ExcalidrawApp />);
    await waitFor(() => expect(window.collab.isCollaborating()).toBe(true));

    // a conta ativa (Bob) desenha
    await act(async () => {
      API.updateScene({
        elements: [element("da-bob")],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await waitFor(() => expect(elementIds()).toEqual(["da-bob"]));
    await LocalData.flushSaveAsync();

    expect(
      (await LocalData.loadWorkspace()).tabs.flatMap((tab) => tab.elements),
    ).toMatchObject([{ id: "da-bob" }]);

    // troca para a Alice: a sessão passa a ser dela e o app recarrega
    await act(async () => {
      await switchToAccount(alice);
    });

    // ...se a recarga não acontecer, o canvas continua com a cena da Bob. Um
    // `onChange` do editor (qualquer edição) não pode levar essa cena para a
    // conta que entrou.
    await act(async () => {
      window.h.app.updateScene({
        appState: { viewBackgroundColor: "#ff0000" },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await LocalData.flushSaveAsync();

    expect(
      (await LocalData.loadWorkspace()).tabs.flatMap((tab) => tab.elements),
    ).toEqual([]);
  });
});
