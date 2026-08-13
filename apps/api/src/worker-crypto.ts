/**
 * Web Crypto methods require their Crypto receiver in the Workers runtime.
 * Do not use `crypto.randomUUID` as a callback/default value directly.
 */
type RandomUuidSource = { randomUUID(): string };

export const createWorkerId = (webCrypto: RandomUuidSource = globalThis.crypto) => webCrypto.randomUUID();
