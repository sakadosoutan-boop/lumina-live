'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep this surface exactly aligned with src/types.ts: LuminaDesktop.
// Neither IPC events nor a generic invoke/send/path API cross the bridge.
contextBridge.exposeInMainWorld('lumina', Object.freeze({
  getAssets: () => ipcRenderer.invoke('lumina:get-assets'),
  importMedia: () => ipcRenderer.invoke('lumina:import-media'),
  getDisplays: () => ipcRenderer.invoke('lumina:get-displays'),
  openOutput: displayId => {
    if (displayId !== undefined && !Number.isSafeInteger(displayId)) return Promise.reject(new TypeError('Invalid display ID'));
    return ipcRenderer.invoke('lumina:open-output', displayId);
  },
  saveShow: data => {
    if (typeof data !== 'string' || data.length > 10 * 1024 * 1024) return Promise.reject(new TypeError('Show must be JSON of at most 10 MiB'));
    return ipcRenderer.invoke('lumina:save-show', data);
  },
  loadShow: () => ipcRenderer.invoke('lumina:load-show'),
  onRemote: callback => {
    if (typeof callback !== 'function') throw new TypeError('Remote callback must be a function');
    const listener = (_event, message) => {
      if (!message || typeof message.address !== 'string' || !/^\/lumina\/(play|stop|next|prev|tap|blackout|crossfade|master|clip)$/.test(message.address) ||
          !Array.isArray(message.args) || message.args.length > 1 || !message.args.every(Number.isFinite)) return;
      callback({ address: message.address, args: [...message.args] });
    };
    ipcRenderer.on('lumina:remote', listener);
    return () => ipcRenderer.removeListener('lumina:remote', listener);
  },
}));

// Only a real activation of an HTTPS anchor can ask main to launch a browser.
// This is private to the isolated preload; the page has no openExternal API.
function externalClick(event) {
  if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
  const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
  if (!anchor || anchor.hasAttribute('download')) return;
  let url;
  try { url = new URL(anchor.href); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send('lumina:external-click', url.href);
}
window.addEventListener('click', externalClick, true);
window.addEventListener('auxclick', externalClick, true);
