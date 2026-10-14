/**
 * Criptografia do lado do cliente.
 *
 * Todo o conteúdo (cena, imagens e biblioteca) é cifrado no navegador com uma
 * chave derivada da chave de login (a frase de 12 palavras) e só então enviado
 * ao servidor. O servidor guarda apenas envelopes opacos — ele nunca vê a frase
 * nem consegue decifrar o que armazena.
 *
 * Formato do envelope (`EncryptedPayload`): um JSON pequeno com o vetor de
 * inicialização e o texto cifrado, ambos em base64url. O `aad` amarra cada
 * envelope ao seu dono e ao seu uso (ex.: `...:scene`), então um envelope de uma
 * conta/coleção não pode ser trocado pelo de outra.
 */

/** AES-GCM com IV de 96 bits, como recomendado pelo NIST */
const IV_BYTES = 12;
/** tamanho do rótulo de autenticação (AES-GCM) em bits */
const TAG_LENGTH = 128;

export type EncryptedPayload = {
  /** versão do formato, para permitir rotação sem quebrar dados antigos */
  v: 1;
  /** vetor de inicialização (base64url) */
  iv: string;
  /** texto cifrado + tag (base64url) */
  ct: string;
};

export const CRYPTO_UNAVAILABLE_MESSAGE =
  "WebCrypto (crypto.subtle) indisponível neste ambiente: não é possível cifrar os dados";

const getCrypto = () => {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) {
    throw new Error(CRYPTO_UNAVAILABLE_MESSAGE);
  }
  return webcrypto;
};

const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// -----------------------------------------------------------------------------
// base64 / base64url
// -----------------------------------------------------------------------------

/** `btoa` em blocos, para não estourar a pilha com imagens grandes */
const BASE64_CHUNK_SIZE = 0x8000;

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** base64url: seguro em URL, header e como chave de linha no banco */
export const bytesToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const base64UrlToBytes = (value: string) =>
  base64ToBytes(
    value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4),
  );

// -----------------------------------------------------------------------------
// envelopes
// -----------------------------------------------------------------------------

export const isEncryptedPayload = (
  value: unknown,
): value is EncryptedPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<EncryptedPayload>;
  return (
    payload.v === 1 &&
    typeof payload.iv === "string" &&
    typeof payload.ct === "string"
  );
};

export const encryptJson = async ({
  key,
  aad,
  value,
}: {
  key: CryptoKey;
  aad: string;
  value: unknown;
}): Promise<EncryptedPayload> => {
  const iv = randomBytes(IV_BYTES);

  const ciphertext = await getCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(aad),
      tagLength: TAG_LENGTH,
    },
    key,
    encoder.encode(JSON.stringify(value)),
  );

  return {
    v: 1,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
};

export const decryptJson = async <T>({
  key,
  aad,
  payload,
}: {
  key: CryptoKey;
  aad: string;
  payload: EncryptedPayload;
}): Promise<T> => {
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(payload.iv),
      additionalData: encoder.encode(aad),
      tagLength: TAG_LENGTH,
    },
    key,
    base64UrlToBytes(payload.ct),
  );

  return JSON.parse(decoder.decode(plaintext)) as T;
};

/**
 * Índice cego: valor determinístico derivado da chave, usado para o servidor
 * localizar uma linha sem conhecer o id real. Como é um HMAC com chave secreta,
 * o banco não consegue reverter nem correlacionar com ids de outro usuário.
 */
export const blindIndex = async ({
  key,
  namespace,
  value,
}: {
  key: CryptoKey;
  namespace: string;
  value: string;
}) =>
  bytesToBase64Url(
    new Uint8Array(
      await getCrypto().subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${namespace}:${value}`),
      ),
    ),
  );
