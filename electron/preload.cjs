// CommonJS on purpose：package.json 是 "type":"module"，但 Electron 的沙箱 preload
// 走自己的 require 加载器，.cjs 后缀让它按 CJS 解析，避开 ESM-in-sandboxed-preload 的限制。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agentText', {
  updater: {
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    restart: () => ipcRenderer.invoke('updater:restart'),
    openDownloadPage: () => ipcRenderer.invoke('updater:open-download'),
    onStatus: (cb) => {
      const handler = (_e, status) => cb(status)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    },
  },
})
