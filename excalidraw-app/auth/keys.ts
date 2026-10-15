/**
 * Chave de login (seed phrase) e derivação das chaves da conta.
 *
 * Não existe email/senha: a conta *é* a frase de 12 palavras (BIP39). A partir
 * dela derivamos, sem nunca sair do navegador:
 *
 *   frase (12 palavras)
 *     └── seed (BIP39: PBKDF2-SHA512, 2048 iterações)
 *           └── HKDF-SHA256, com um `info` diferente por uso:
 *                 ├── accountId   → identificador opaco da conta (login)
 *                 ├── authSecret  → credencial enviada ao servidor (Bearer);
 *                 │                 o servidor guarda apenas o sha256 dela
 *                 ├── contentKey  → AES-GCM 256 que cifra cena/imagens/biblioteca
 *                 ├── indexKey    → HMAC-SHA256 para os índices cegos (ids de arquivo)
 *                 └── collab*     → par fixo da sala de colaboração da conta
 *
 * A sala fixa é o par `#room=<roomId>,<roomKey>` que o app sempre abre para a
 * conta: derivado da frase, o link é sempre o mesmo (as outras pessoas com o
 * link caem na mesma sala) e a chave nunca sai do hash da URL.
 *
 * Consequência: quem tem a frase tem os dados; quem não tem, não tem — nem o
 * servidor, que só armazena envelopes cifrados.
 */
import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { bytesToBase64Url } from "./crypto";

/** 128 bits de entropia = 12 palavras, o tamanho pedido para a chave de login */
export const LOGIN_KEY_WORD_COUNT = 12;
const LOGIN_KEY_STRENGTH = 128;

/** salt fixo do HKDF: separa o app de qualquer outro uso da mesma frase */
const HKDF_SALT = "excalidraw-e2ee-v1";

/**
 * Sala de colaboração fixa da conta: 128 bits de chave (viram um base64url de
 * 22 caracteres, o formato que o link de sala e o AES-GCM do socket esperam) e
 * 80 bits de id (mesmo tamanho de `ROOM_ID_BYTES`, em hex).
 */
const COLLAB_ROOM_KEY_BITS = 128;
const COLLAB_ROOM_ID_BITS = 80;

export type AccountKeys = {
  /** identificador público da conta (derivado da frase, não reversível) */
  accountId: string;
  /** credencial de autenticação; funciona como um token bearer */
  authSecret: string;
  /** chave AES-GCM que cifra o conteúdo da conta */
  contentKey: CryptoKey;
  /** chave HMAC usada para os índices cegos */
  indexKey: CryptoKey;
  /** id fixo da sala de colaboração da conta (hex, `[a-zA-Z0-9_-]+`) */
  collabRoomId: string;
  /** chave E2E da sala fixa, vai no hash do link (`#room=<id>,<key>`) */
  collabRoomKey: string;
};

/** bytes em hex: formato aceito no `roomId` do link de sala */
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const generateLoginKey = () =>
  generateMnemonic(wordlist, LOGIN_KEY_STRENGTH);

/** aceita colagem com espaços/quebras de linha e maiúsculas */
export const normalizeLoginKey = (value: string) =>
  value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");

export const isValidLoginKey = (value: string) => {
  const mnemonic = normalizeLoginKey(value);
  return (
    mnemonic.split(" ").length === LOGIN_KEY_WORD_COUNT &&
    validateMnemonic(mnemonic, wordlist)
  );
};

/** texto único (aad) que amarra um envelope ao dono e ao uso */
export const aadFor = (accountId: string, namespace: string) =>
  `excalidraw:${accountId}:${namespace}`;

export const deriveAccountKeys = async (
  loginKey: string,
): Promise<AccountKeys> => {
  const mnemonic = normalizeLoginKey(loginKey);

  if (!isValidLoginKey(mnemonic)) {
    throw new Error("Chave de login inválida");
  }

  const seed = await mnemonicToSeed(mnemonic);
  const baseKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, [
    "deriveBits",
  ]);

  const derive = async (info: string, bits = 256) => {
    const derived = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(HKDF_SALT),
        info: new TextEncoder().encode(info),
      },
      baseKey,
      bits,
    );
    return new Uint8Array(derived);
  };

  const [
    contentMaterial,
    indexMaterial,
    authMaterial,
    idMaterial,
    collabKeyMaterial,
    collabRoomMaterial,
  ] = await Promise.all([
    derive("excalidraw-e2ee/content"),
    derive("excalidraw-e2ee/index"),
    derive("excalidraw-e2ee/auth"),
    derive("excalidraw-e2ee/account"),
    derive("excalidraw-e2ee/collab-key", COLLAB_ROOM_KEY_BITS),
    derive("excalidraw-e2ee/collab-room", COLLAB_ROOM_ID_BITS),
  ]);

  return {
    accountId: bytesToBase64Url(idMaterial),
    authSecret: bytesToBase64Url(authMaterial),
    collabRoomId: bytesToHex(collabRoomMaterial),
    collabRoomKey: bytesToBase64Url(collabKeyMaterial),
    contentKey: await crypto.subtle.importKey(
      "raw",
      contentMaterial,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
    indexKey: await crypto.subtle.importKey(
      "raw",
      indexMaterial,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
  };
};
