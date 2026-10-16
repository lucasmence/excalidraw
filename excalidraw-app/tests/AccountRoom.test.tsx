import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import React from "react";

import ExcalidrawApp from "../App";
import { isAccountRoomLink, resolveRoomLink } from "../account/account-actions";
import { deriveAccountKeys } from "../auth/keys";
import {
  bindAccountStore,
  createAccount,
  getActiveSession,
  logout,
  markLoginKeyRevealed,
  type AccountState,
} from "../auth/session";
import { getCollaborationLink } from "../data";

import { createFakeApiServer } from "./helpers/fakeApiServer";
import { ensureWebcrypto } from "./helpers/webcrypto";

// o jsdom não navega: uma recarga acidental é observada, não executada
vi.mock("../account/reload", () => ({ reloadApp: vi.fn() }));

// a sala da conta conecta sozinha ao abrir o app: nada de rede de verdade
vi.mock("socket.io-client", () => {
  return {
    default: () => {
      return {
        close: () => {},
        on: () => {},
        once: () => {},
        off: () => {},
        emit: () => {},
      };
    },
  };
});

vi.mock("../data/firebase.ts", () => {
  const loadFromFirebase = async () => null;
  const saveToFirebase = () => {};
  const isSavedToFirebase = () => true;
  const loadFilesFromFirebase = async () => ({
    loadedFiles: [],
    erroredFiles: [],
  });
  const saveFilesToFirebase = async () => ({
    savedFiles: new Map(),
    erroredFiles: new Map(),
  });

  return {
    loadFromFirebase,
    saveToFirebase,
    isSavedToFirebase,
    loadFilesFromFirebase,
    saveFilesToFirebase,
  };
});

const ALICE_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const BOB_KEY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let server: ReturnType<typeof createFakeApiServer>;

/** conta pronta no servidor e guardada neste navegador (a última fica ativa) */
const givenAccount = async (loginKey: string) => {
  await createAccount({ loginKey, remember: true });
  await markLoginKeyRevealed();
  return [...server.accounts.keys()].at(-1)!;
};

const roomLinkOf = async (loginKey: string) => {
  const keys = await deriveAccountKeys(loginKey);
  return { roomId: keys.collabRoomId, roomKey: keys.collabRoomKey };
};

/** como se o link (de outra conta) tivesse sido colado na barra de endereços */
const givenUrl = (room: { roomId: string; roomKey: string }) =>
  window.history.replaceState({}, "", getCollaborationLink(room));

const hashOf = (room: { roomId: string; roomKey: string }) =>
  `#room=${room.roomId},${room.roomKey}`;

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
  logout();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("sala privada da conta", () => {
  it("devolve a própria sala e reescreve a URL quando o link é de outra conta", async () => {
    const alice = await givenAccount(ALICE_KEY);
    const bob = await givenAccount(BOB_KEY);
    const aliceRoom = await roomLinkOf(ALICE_KEY);
    const bobRoom = await roomLinkOf(BOB_KEY);

    // a Bob está logada e a URL traz o link da sala da Alice
    givenUrl(aliceRoom);

    expect(resolveRoomLink(aliceRoom)).toEqual(bobRoom);
    expect(window.location.hash).toBe(hashOf(bobRoom));
    // a conta ativa continua sendo a dela: a sala é que mudou, não a sessão
    expect(getActiveSession()?.accountId).toBe(bob);
    expect(bob).not.toBe(alice);
  });

  it("não mexe na URL quando o link já é o da própria sala", async () => {
    await givenAccount(BOB_KEY);
    const bobRoom = await roomLinkOf(BOB_KEY);

    givenUrl(bobRoom);

    expect(isAccountRoomLink(bobRoom)).toBe(true);
    expect(resolveRoomLink(bobRoom)).toEqual(bobRoom);
    expect(window.location.hash).toBe(hashOf(bobRoom));
  });

  it("trata o id da própria sala com chave trocada como sala alheia", async () => {
    await givenAccount(BOB_KEY);
    const bobRoom = await roomLinkOf(BOB_KEY);

    // par adulterado: id da própria sala, mas a chave não é a da conta
    const tampered = { roomId: bobRoom.roomId, roomKey: "y".repeat(22) };
    givenUrl(tampered);

    expect(isAccountRoomLink(tampered)).toBe(false);
    expect(resolveRoomLink(tampered)).toEqual(bobRoom);
    expect(window.location.hash).toBe(hashOf(bobRoom));
  });

  it("abre a própria sala ao carregar o app com o link de outra conta na URL", async () => {
    await givenAccount(ALICE_KEY);
    await givenAccount(BOB_KEY);
    const aliceRoom = await roomLinkOf(ALICE_KEY);
    const bobRoom = await roomLinkOf(BOB_KEY);

    givenUrl(aliceRoom);

    await render(<ExcalidrawApp />);

    // o app entra na sala da Bob, e não na sala que veio no link
    await waitFor(() => expect(window.location.hash).toBe(hashOf(bobRoom)));
    expect(window.location.hash).not.toContain(aliceRoom.roomId);
    // e não é só a URL: a conexão é com a sala da conta
    await waitFor(() =>
      expect(window.collab.portal.roomId).toBe(bobRoom.roomId),
    );
    expect(window.collab.portal.roomKey).toBe(bobRoom.roomKey);
    expect(window.collab.portal.roomId).not.toBe(aliceRoom.roomId);
  });

  it("volta para a própria sala quando o link alheio chega com o app aberto", async () => {
    await givenAccount(ALICE_KEY);
    await givenAccount(BOB_KEY);
    const aliceRoom = await roomLinkOf(ALICE_KEY);
    const bobRoom = await roomLinkOf(BOB_KEY);

    await render(<ExcalidrawApp />);
    await waitFor(() => expect(window.location.hash).toBe(hashOf(bobRoom)));

    // com o app já na sala da conta, o link da sala de outra conta é colado
    await act(async () => {
      givenUrl(aliceRoom);
      window.dispatchEvent(new Event("hashchange"));
    });

    await waitFor(() => expect(window.location.hash).toBe(hashOf(bobRoom)));
    expect(window.location.hash).not.toContain(aliceRoom.roomId);
    // a conexão continua na sala da conta: o link alheio não abre a sala dele
    expect(window.collab.portal.roomId).toBe(bobRoom.roomId);
    expect(window.collab.portal.roomId).not.toBe(aliceRoom.roomId);
  });

  it("sem conta, o link da URL continua valendo (modo sem login)", async () => {
    await givenAccount(ALICE_KEY);
    logout();

    const room = { roomId: "sala-sem-conta", roomKey: "x".repeat(22) };
    givenUrl(room);

    expect(resolveRoomLink(room)).toEqual(room);
    expect(window.location.hash).toBe(hashOf(room));
  });
});
