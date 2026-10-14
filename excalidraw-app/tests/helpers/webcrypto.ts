import { webcrypto } from "node:crypto";

/**
 * O jsdom expõe `crypto.getRandomValues`, mas não `crypto.subtle` — então nos
 * testes a implementação do Node entra no lugar quando falta.
 */
export const ensureWebcrypto = () => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
      writable: true,
    });
  }
};
