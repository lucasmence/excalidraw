import {
  base64ToBytes,
  blindIndex,
  bytesToBase64,
  bytesToBase64Url,
  base64UrlToBytes,
  decryptJson,
  encryptJson,
  type EncryptedPayload,
} from "../auth/crypto";
import {
  aadFor,
  deriveAccountKeys,
  generateLoginKey,
  isValidLoginKey,
  normalizeLoginKey,
} from "../auth/keys";

import { ensureWebcrypto } from "./helpers/webcrypto";

const KNOWN_LOGIN_KEY =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

beforeAll(() => {
  ensureWebcrypto();
});

describe("chave de login", () => {
  it("gera 12 palavras válidas, diferentes a cada chamada", () => {
    const a = generateLoginKey();
    const b = generateLoginKey();

    expect(a.split(" ")).toHaveLength(12);
    expect(isValidLoginKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("normaliza espaços e maiúsculas na hora de validar", () => {
    expect(normalizeLoginKey("  LEGAL   winner\nTHANK year ")).toBe(
      "legal winner thank year",
    );
    expect(isValidLoginKey(`  ${KNOWN_LOGIN_KEY.toUpperCase()}  `)).toBe(true);
  });

  it("recusa frase com tamanho ou checksum errado", () => {
    expect(isValidLoginKey("legal winner thank")).toBe(false);
    expect(
      isValidLoginKey(
        "legal winner thank year wave sausage worth useful legal winner thank wrong",
      ),
    ).toBe(false);
    expect(isValidLoginKey("")).toBe(false);
  });
});

describe("derivação da conta", () => {
  it("deriva sempre as mesmas chaves da mesma frase", async () => {
    const first = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const second = await deriveAccountKeys(`  ${KNOWN_LOGIN_KEY}  `);

    expect(second.accountId).toBe(first.accountId);
    expect(second.authSecret).toBe(first.authSecret);
    expect(second.contentKey).toEqual(first.contentKey);
  });

  it("deriva chaves diferentes para frases diferentes", async () => {
    const first = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const second = await deriveAccountKeys(generateLoginKey());

    expect(second.accountId).not.toBe(first.accountId);
    expect(second.authSecret).not.toBe(first.authSecret);
  });

  it("não deixa a frase aparecer no que vai para o servidor", async () => {
    const keys = await deriveAccountKeys(KNOWN_LOGIN_KEY);

    for (const word of KNOWN_LOGIN_KEY.split(" ")) {
      expect(keys.accountId).not.toContain(word);
      expect(keys.authSecret).not.toContain(word);
    }
  });

  it("recusa frase inválida", async () => {
    await expect(deriveAccountKeys("uma frase qualquer aqui")).rejects.toThrow(
      "Chave de login inválida",
    );
  });
});

describe("envelopes cifrados", () => {
  it("cifra e decifra preservando o conteúdo", async () => {
    const { contentKey, accountId } = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const aad = aadFor(accountId, "scene");
    const scene = {
      elements: [{ id: "el1" }],
      appState: { viewBackgroundColor: "#fff" },
    };

    const payload = await encryptJson({ key: contentKey, aad, value: scene });

    expect(payload.v).toBe(1);
    expect(payload.ct).not.toContain("elements");
    await expect(
      decryptJson({ key: contentKey, aad, payload }),
    ).resolves.toEqual(scene);
  });

  it("usa um IV diferente a cada cifragem", async () => {
    const { contentKey, accountId } = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const aad = aadFor(accountId, "scene");

    const first = await encryptJson({ key: contentKey, aad, value: { a: 1 } });
    const second = await encryptJson({ key: contentKey, aad, value: { a: 1 } });

    expect(second.iv).not.toBe(first.iv);
    expect(second.ct).not.toBe(first.ct);
  });

  it("recusa envelope de outro uso, de outra conta ou adulterado", async () => {
    const alice = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const bob = await deriveAccountKeys(generateLoginKey());

    const payload = await encryptJson({
      key: alice.contentKey,
      aad: aadFor(alice.accountId, "scene"),
      value: { elements: [] },
    });

    // mesmo conteúdo, aad de outro namespace (ex.: trocar cena por biblioteca)
    await expect(
      decryptJson({
        key: alice.contentKey,
        aad: aadFor(alice.accountId, "library"),
        payload,
      }),
    ).rejects.toThrow();

    // chave de outra conta
    await expect(
      decryptJson({
        key: bob.contentKey,
        aad: aadFor(alice.accountId, "scene"),
        payload,
      }),
    ).rejects.toThrow();

    // texto cifrado adulterado
    const tampered: EncryptedPayload = {
      ...payload,
      ct: `${payload.ct.slice(0, -2)}AA`,
    };
    await expect(
      decryptJson({
        key: alice.contentKey,
        aad: aadFor(alice.accountId, "scene"),
        payload: tampered,
      }),
    ).rejects.toThrow();
  });
});

describe("índice cego", () => {
  it("é determinístico e não revela o id original", async () => {
    const { indexKey } = await deriveAccountKeys(KNOWN_LOGIN_KEY);

    const first = await blindIndex({
      key: indexKey,
      namespace: "file",
      value: "abc123",
    });
    const second = await blindIndex({
      key: indexKey,
      namespace: "file",
      value: "abc123",
    });

    expect(second).toBe(first);
    expect(first).not.toContain("abc123");
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("separa por namespace e por valor", async () => {
    const alice = await deriveAccountKeys(KNOWN_LOGIN_KEY);
    const bob = await deriveAccountKeys(generateLoginKey());

    const file = await blindIndex({
      key: alice.indexKey,
      namespace: "file",
      value: "abc123",
    });

    expect(
      await blindIndex({
        key: alice.indexKey,
        namespace: "other",
        value: "abc123",
      }),
    ).not.toBe(file);
    expect(
      await blindIndex({
        key: alice.indexKey,
        namespace: "file",
        value: "abc124",
      }),
    ).not.toBe(file);
    expect(
      await blindIndex({
        key: bob.indexKey,
        namespace: "file",
        value: "abc123",
      }),
    ).not.toBe(file);
  });
});

describe("base64url", () => {
  it("faz ida e volta com dados grandes", () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);

    const urlSafe = bytesToBase64Url(bytes);
    expect(urlSafe).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(urlSafe)).toEqual(bytes);
  });
});
