const { contextBridge, ipcRenderer } = require('electron')

function safeSubscribe(channel, callback) {
  const listener = (_, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('appApi', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  
  gitOperation: (payload) => ipcRenderer.invoke('git:operation', payload),
  scanSvgs: (path) => ipcRenderer.invoke('scan:svgs', path),
  
  onStatusUpdate: (callback) => safeSubscribe('status:update', callback)
})
