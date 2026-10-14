import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

import { Provider, appJotaiStore } from "../app-jotai";
import { accountAtom } from "../auth/session";
import { STORAGE_KEYS } from "../app_constants";
import { AccountBoundary } from "../account/AccountBoundary";
import {
  bindAccountStore,
  createAccount,
  logout,
  markLoginKeyRevealed,
  type AccountState,
} from "../auth/session";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

let server: ReturnType<typeof createFakeApiServer>;
let states: AccountState[];

const renderApp = () =>
  render(
    <Provider store={appJotaiStore}>
      <AccountBoundary>
        <div data-testid="editor">editor</div>
      </AccountBoundary>
    </Provider>,
  );

const words = () => document.querySelectorAll(".account-words__word");

const checkConfirm = () =>
  fireEvent.click(screen.getByLabelText(/anotei|wrote down/i));

/** conta pronta no servidor, como se já tivesse sido usada antes */
const givenRegisteredAccount = async (remember = true) => {
  await createAccount({ loginKey: ALICE_KEY, remember });
  await markLoginKeyRevealed();
  logout();
  localStorage.clear();
};

beforeAll(() => {
  ensureWebcrypto();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_APP_STORAGE", "mysql");
  server = createFakeApiServer();
  states = [];
  bindAccountStore((state: AccountState) => states.push(state));
});

afterEach(() => {
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AccountBoundary", () => {
  it("não monta o editor sem conta", async () => {
    renderApp();

    expect(screen.queryByTestId("editor")).toBeNull();
    expect(
      await screen.findByText(/your account is a key of 12 words/i),
    ).toBeInTheDocument();
  });

  it("cria a conta, mostra a chave uma única vez e entra", async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole("button", { name: /create account/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /generate my login key/i }),
    );

    // a chave aparece: 12 palavras
    await waitFor(() => expect(words()).toHaveLength(12));

    const continueButton = screen.getByRole("button", {
      name: /open my account/i,
    });
    // sem confirmar que anotou, não passa
    expect(continueButton).toBeDisabled();

    checkConfirm();
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    // entra direto no editor (a entrega da chave já foi registrada)
    expect(await screen.findByTestId("editor")).toBeInTheDocument();

    expect(server.calls.some((call) => call.path === "/api/accounts")).toBe(
      true,
    );
    expect(
      server.calls.some((call) => call.path === "/api/session/key-revealed"),
    ).toBe(true);
  });

  it("entra com uma chave já registrada, sem exigir a chave de novo", async () => {
    await givenRegisteredAccount(false);

    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /^sign in$/i }));

    const field = await screen.findByPlaceholderText(/twelve words/i);
    fireEvent.change(field, { target: { value: ALICE_KEY } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByTestId("editor")).toBeInTheDocument();
  });

  it("recusa entrar com uma frase inválida", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /^sign in$/i }));

    const field = await screen.findByPlaceholderText(/twelve words/i);
    fireEvent.change(field, {
      target: { value: "palavras que não são uma chave" },
    });

    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
    expect(screen.getByText(/not a valid login key/i)).toBeInTheDocument();
  });

  it("pede a confirmação da chave quando ela nunca foi registrada", async () => {
    // conta criada mas a chave nunca foi confirmada (a aba fechou antes)
    await createAccount({ loginKey: ALICE_KEY, remember: true });

    renderApp();

    await waitFor(() => expect(words()).toHaveLength(12));
    expect(screen.queryByTestId("editor")).toBeNull();

    checkConfirm();
    fireEvent.click(screen.getByRole("button", { name: /open my account/i }));

    expect(await screen.findByTestId("editor")).toBeInTheDocument();
    // o estado que o resto do app (menu) enxerga vem do atom
    expect(appJotaiStore.get(accountAtom)).toMatchObject({
      status: "authenticated",
      remote: { keyRevealedAt: expect.any(String) },
    });
  });

  it("volta direto para o editor quando a chave está salva no navegador", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: true });
    await markLoginKeyRevealed();

    expect(states.at(-1)).toMatchObject({ status: "authenticated" });

    renderApp();

    expect(await screen.findByTestId("editor")).toBeInTheDocument();
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACCOUNT),
    ).not.toBeNull();
  });

  it("não entra sozinho quando o usuário não pediu para manter conectado", async () => {
    await createAccount({ loginKey: ALICE_KEY, remember: false });
    await markLoginKeyRevealed();

    renderApp();

    expect(
      await screen.findByText(/your account is a key of 12 words/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();
  });
});
