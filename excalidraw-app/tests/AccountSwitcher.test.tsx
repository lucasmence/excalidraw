import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";

// o `render` do test-utils espera o canvas do editor: só vale para o TestApp
import { render as renderEditor } from "@excalidraw/excalidraw/tests/test-utils";

import { AccountBoundary } from "../account/AccountBoundary";
import { AccountDialog } from "../account/AccountDialog";
import { AccountMenuItems } from "../account/AccountMenuItems";
import {
  accountDialogAtom,
  addingAccountAtom,
  shortAccountId,
} from "../account/account-state";
import { reloadApp } from "../account/reload";
import { Provider, appJotaiStore } from "../app-jotai";
import {
  accountAtom,
  bindAccountStore,
  createAccount,
  forgetAccount,
  getActiveSession,
  logout,
  markLoginKeyRevealed,
  switchAccount,
} from "../auth/session";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

// o jsdom não navega: a recarga que fecha a troca de conta é observada aqui
vi.mock("../account/reload", () => ({ reloadApp: vi.fn() }));

const reloadMock = vi.mocked(reloadApp);

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let server: ReturnType<typeof createFakeApiServer>;

/** editor com o menu e os diálogos da conta, como no app */
const TestApp = () => (
  <Provider store={appJotaiStore}>
    <Excalidraw>
      <MainMenu>
        <AccountMenuItems />
      </MainMenu>
      <AccountDialog />
    </Excalidraw>
  </Provider>
);

const renderBoundary = () =>
  render(
    <Provider store={appJotaiStore}>
      <AccountBoundary>
        <div data-testid="editor">editor</div>
      </AccountBoundary>
    </Provider>,
  );

const openMenu = () => {
  fireEvent.click(document.querySelector(".dropdown-menu-button")!);
};

/** conta pronta no servidor e guardada neste navegador (login automático) */
const givenAccount = async (loginKey: string) => {
  await createAccount({ loginKey, remember: true });
  await markLoginKeyRevealed();
  return [...server.accounts.keys()].at(-1)!;
};

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
  reloadMock.mockClear();
  appJotaiStore.set(addingAccountAtom, null);
  appJotaiStore.set(accountDialogAtom, null);

  // mesmo binding que o AccountBoundary faz no app
  bindAccountStore((state) => appJotaiStore.set(accountAtom, state));
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("alternar entre contas", () => {
  it("troca a conta ativa pelo diálogo do menu", async () => {
    const alice = await givenAccount(ALICE_KEY);
    const bob = await givenAccount(BOB_KEY);

    await renderEditor(<TestApp />);

    openMenu();
    fireEvent.click(
      (await screen.findByText(/^switch account$/i)).closest("button")!,
    );

    await waitFor(() =>
      expect(appJotaiStore.get(accountDialogAtom)).toBe("accounts"),
    );

    // a conta ativa (Bob) se identifica; a outra pode ser aberta num clique
    expect(screen.getByText(shortAccountId(bob))).toBeInTheDocument();
    expect(screen.getByText(shortAccountId(alice))).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /^switch$/i }));

    await waitFor(() => expect(getActiveSession()?.accountId).toBe(alice));
    expect(reloadMock).toHaveBeenCalled();
  });

  it("tira uma conta do navegador sem mexer na sessão", async () => {
    const alice = await givenAccount(ALICE_KEY);
    const bob = await givenAccount(BOB_KEY);

    await renderEditor(<TestApp />);

    openMenu();
    fireEvent.click(
      (await screen.findByText(/^switch account$/i)).closest("button")!,
    );

    await waitFor(() =>
      expect(appJotaiStore.get(accountDialogAtom)).toBe("accounts"),
    );

    fireEvent.click(await screen.findByRole("button", { name: /^remove$/i }));

    await waitFor(() =>
      expect(screen.queryByText(shortAccountId(alice))).toBeNull(),
    );
    // a Bob continua ativa, e ninguém recarregou nada
    expect(getActiveSession()?.accountId).toBe(bob);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("oferece as contas guardadas quando ninguém está logado", async () => {
    const alice = await givenAccount(ALICE_KEY);
    const bob = await givenAccount(BOB_KEY);
    // sai da Alice (a ativa): a Bob continua guardada, sem sessão ativa
    await switchAccount(alice);
    logout();

    renderBoundary();

    expect(await screen.findByText(/^choose an account$/i)).toBeInTheDocument();
    expect(screen.getByText(shortAccountId(bob))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

    await waitFor(() => expect(getActiveSession()?.accountId).toBe(bob));
    expect(reloadMock).toHaveBeenCalled();
  });
});

describe("adicionar conta", () => {
  it("abre a tela de conta no lugar do editor e entra com a conta nova", async () => {
    const alice = await givenAccount(ALICE_KEY);
    const bob = await givenAccount(BOB_KEY);
    // a Alice volta a ser a ativa; a Bob fica só no servidor
    await switchAccount(alice);
    forgetAccount(bob);

    renderBoundary();
    expect(await screen.findByTestId("editor")).toBeInTheDocument();

    act(() => appJotaiStore.set(addingAccountAtom, alice));

    // o editor sai de cena: nada pode ser salvo no meio da troca de conta
    expect(await screen.findByText(/^add account$/i)).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    fireEvent.change(await screen.findByPlaceholderText(/twelve words/i), {
      target: { value: BOB_KEY },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(getActiveSession()?.accountId).toBe(bob));
    // a conta nova só aparece com a cena dela: recarrega o app
    expect(reloadMock).toHaveBeenCalled();
  });

  it("volta para o editor sem trocar de conta", async () => {
    const alice = await givenAccount(ALICE_KEY);

    renderBoundary();
    expect(await screen.findByTestId("editor")).toBeInTheDocument();

    act(() => appJotaiStore.set(addingAccountAtom, alice));
    fireEvent.click(
      await screen.findByRole("button", { name: /back to my editor/i }),
    );

    expect(await screen.findByTestId("editor")).toBeInTheDocument();
    expect(getActiveSession()?.accountId).toBe(alice);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
