const { contextBridge, ipcRenderer } = require('electron')

function safeSubscribe(channel, callback) {
  const listener = (_, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('appApi', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  startClone: (payload) =>
    ipcRenderer.invoke('git:cloneStart', {
      repoUrl: payload?.repoUrl,
      branch: payload?.branch,
      destinationFolder: payload?.destinationFolder,
      token: payload?.token
    }),
  cancelClone: (jobId) => ipcRenderer.invoke('git:cancelClone', { jobId }),
  onCloneProgress: (callback) => safeSubscribe('git:progress', callback),
  onCloneDone: (callback) => safeSubscribe('git:done', callback),
  listSvgs: (rootDirectory) => ipcRenderer.invoke('svg:list', { rootDirectory }),
  loadSvgPreview: (svgPath) => ipcRenderer.invoke('svg:loadPreview', { svgPath })
})