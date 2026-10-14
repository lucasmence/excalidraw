import { Excalidraw } from "@excalidraw/excalidraw";
import { act } from "@testing-library/react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import React from "react";

import { AccountDialog } from "../account/AccountDialog";
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
} from "../auth/session";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

/**
 * O diálogo precisa do editor montado por baixo: ele renderiza num portal
 * dentro do container do Excalidraw. Renderizar sem `<Excalidraw>` deixaria o
 * portal sem destino (o diálogo não apareceria).
 *
 * O `await` importa: se o teste terminar antes do render resolver, o cleanup
 * desmonta o editor e a espera interna do render fica órfã.
 */
const renderDialog = (dialog: "key" | "logout") => {
  appJotaiStore.set(accountDialogAtom, dialog);

  return render(
    <Provider store={appJotaiStore}>
      <Excalidraw>
        <AccountDialog />
      </Excalidraw>
    </Provider>,
  );
};

const words = () =>
  [...document.querySelectorAll(".account-words__word")].map(
    (word) => word.textContent,
  );

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(async () => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  createFakeApiServer();
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

describe("diálogos da conta", () => {
  it("mostra a chave de login para quem está logado", async () => {
    await renderDialog("key");

    await waitFor(() => expect(words()).toHaveLength(12));
    expect(words()).toEqual(ALICE_KEY.split(" "));
    expect(
      screen.getByText(/keep these 12 words offline/i),
    ).toBeInTheDocument();
  });

  it("registra que a chave já foi entregue", async () => {
    await renderDialog("key");

    expect(
      await screen.findByText(/recorded on the server/i),
    ).toBeInTheDocument();
  });

  it("sai da conta e apaga a cópia local ao confirmar", async () => {
    const accountId = getActiveSession()!.accountId;
    localStorage.setItem(
      `${STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS}:${accountId}`,
      JSON.stringify([{ id: "el1", isDeleted: false }]),
    );

    await renderDialog("logout");

    expect(await screen.findByText(/sign out\?/i)).toBeInTheDocument();

    // cancelar não mexe em nada
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(appJotaiStore.get(accountDialogAtom)).toBeNull(),
    );
    expect(getActiveSession()).not.toBeNull();

    act(() => appJotaiStore.set(accountDialogAtom, "logout"));
    fireEvent.click(await screen.findByRole("button", { name: /^sign out$/i }));

    await waitFor(() => expect(getActiveSession()).toBeNull());
    expect(
      localStorage.getItem(
        `${STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS}:${accountId}`,
      ),
    ).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT)).toBeNull();
  });
});
