/** Just enough of `chrome.storage.local` for modules that queue and remember things, installed as the global `chrome`. */
export function installFakeBrowser() {
  const data = {};
  const pick = (keys) => {
    if (keys === null || keys === undefined) return structuredClone(data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => pick(keys),
        set: async (items) => void Object.assign(data, structuredClone(items)),
        remove: async (keys) => [keys].flat().forEach((key) => delete data[key]),
      },
    },
  };
  return data;
}
