import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { type Bridge, EVENTS, type EventName, isMethod } from '../shared/ipc.ts';

const bridge: Bridge = {
  call: async (method, ...args) =>
    isMethod(method)
      ? ipcRenderer.invoke('enve:call', method, args)
      : { ok: false, error: { code: 'unknown_method', message: `Unknown method ${JSON.stringify(method)}.` } },
  on: (event: EventName, listener) => {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event ${event}.`);
    const wrapped = (_event: Electron.IpcRendererEvent, ...payload: unknown[]) => listener(...payload);
    ipcRenderer.on(`enve:${event}`, wrapped);
    return () => void ipcRenderer.removeListener(`enve:${event}`, wrapped);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('enve', bridge);
