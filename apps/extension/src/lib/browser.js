// Firefox exposes the promise-based `browser` namespace; Chrome MV3's `chrome` returns promises too.
export const ext = globalThis.browser ?? globalThis.chrome;
