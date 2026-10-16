import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { act } from "@testing-library/react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import React from "react";

import { AccountMenuItems } from "../account/AccountMenuItems";
import { accountDialogAtom } from "../account/account-state";
import { Provider, appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";
import {
  accountAtom,
  bindAccountStore,
  createAccount,
  getActiveSession,
  logout,
  markLoginKeyRevealed,
  rememberSession,
} from "../auth/session";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

let server: ReturnType<typeof createFakeApiServer>;

const TestApp = () => (
  <Provider store={appJotaiStore}>
    <Excalidraw>
      <MainMenu>
        <AccountMenuItems />
      </MainMenu>
    </Excalidraw>
  </Provider>
);

const openMenu = () => {
  fireEvent.click(document.querySelector(".dropdown-menu-button")!);
};

/** a conta ativa, como ela fica guardada no navegador */
const storedAccount = () => {
  const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT);
  const stored = raw ? JSON.parse(raw) : null;
  return (
    stored?.accounts?.find(
      (account: any) => account.accountId === stored.activeAccountId,
    ) ?? null
  );
};

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(async () => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();

  // mesmo binding que o AccountBoundary faz no app
  bindAccountStore((state) => appJotaiStore.set(accountAtom, state));

  await createAccount({ loginKey: ALICE_KEY, remember: true });
  await markLoginKeyRevealed();
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("menu da conta", () => {
  it("mostra a conta logada e o registro da entrega da chave", async () => {
    await render(<TestApp />);

    openMenu();

    const accountId = getActiveSession()!.accountId;
    expect(
      await screen.findByText(
        `${accountId.slice(0, 6)}…${accountId.slice(-4)}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/key first shown on/i)).toBeInTheDocument();
    expect(
      server.calls.some((call) => call.path === "/api/session/key-revealed"),
    ).toBe(true);
  });

  it("abre o diálogo da chave ao selecionar o item", async () => {
    await render(<TestApp />);

    openMenu();
    fireEvent.click(
      (await screen.findByText(/view my login key/i)).closest("button")!,
    );

    await waitFor(() =>
      expect(appJotaiStore.get(accountDialogAtom)).toBe("key"),
    );
  });

  it("pede confirmação de saída ao selecionar sair", async () => {
    await render(<TestApp />);

    openMenu();
    fireEvent.click(
      (await screen.findByText(/^sign out$/i)).closest("button")!,
    );

    await waitFor(() =>
      expect(appJotaiStore.get(accountDialogAtom)).toBe("logout"),
    );
    // o menu fecha, mas a sessão continua até confirmar
    expect(getActiveSession()).not.toBeNull();
  });

  it("liga e desliga o login automático", async () => {
    await render(<TestApp />);

    openMenu();

    const checkbox = await screen.findByLabelText(/keep me signed in/i);
    expect(checkbox).toBeChecked();
    expect(storedAccount().loginKey).toBe(ALICE_KEY);

    fireEvent.click(checkbox);

    await waitFor(() => expect(storedAccount().loginKey).toBeNull());
    // a sessão continua ativa nesta aba, só não fica salva para a próxima
    expect(getActiveSession()).not.toBeNull();
    expect(storedAccount().remember).toBe(false);

    act(() => rememberSession(true));
    expect(storedAccount().loginKey).toBe(ALICE_KEY);
  });
});
