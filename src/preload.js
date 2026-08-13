const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petHost', {
  showMenu: () => ipcRenderer.send('pet:menu'),
  toggleAuto: () => ipcRenderer.send('pet:toggle-auto'),
  forceMove: () => ipcRenderer.send('pet:force-move'),
  toggleFocusMode: () => ipcRenderer.send('pet:toggle-focus-mode'),
  resetSettings: () => ipcRenderer.send('pet:reset-settings'),
  triggerInteract: (details) => ipcRenderer.send('pet:trigger-interact', details),
  beginPixelDrag: (details) => ipcRenderer.send('pet:pixel-drag-start', details),
  movePixelDrag: (details) => ipcRenderer.send('pet:pixel-drag-move', details),
  endPixelDrag: (details) => ipcRenderer.send('pet:pixel-drag-end', details),
  quit: () => ipcRenderer.send('pet:quit'),
  adjustScale: (action) => ipcRenderer.send('pet:scale', action),
  adjustMoveSpeed: (action) => ipcRenderer.send('pet:move-speed', action),
  setBehaviorActivity: (value) => ipcRenderer.send('pet:behavior-activity', value),
  adjustCharacterDistance: (action) => ipcRenderer.send('pet:character-distance', action),
  setPointerOverControls: (isOverControls) => ipcRenderer.send('pet:pointer-over-controls', isOverControls),
  setPointerOverPet: (isOverPet) => ipcRenderer.send('pet:pointer-over-pet', isOverPet),
  setConfigurationMode: (active) => ipcRenderer.send('pet:configuration-mode', active),
  setControlsHidden: (hidden) => ipcRenderer.send('pet:controls-hidden', hidden),
  getProfiles: () => ipcRenderer.invoke('pet:profiles:get'),
  selectProfiles: (pair) => ipcRenderer.invoke('pet:profiles:select', pair),
  reportProfileRuntime: (payload) => ipcRenderer.send('pet:profiles:runtime-report', payload),
  lookupPritsOperator: (name) => ipcRenderer.invoke('pet:prts:lookup', name),
  openLastPritsDebug: () => ipcRenderer.invoke('pet:prts:open-last-debug'),
  downloadPritsProfile: (request) => ipcRenderer.invoke('pet:prts:download', request),
  cancelPritsDownload: () => ipcRenderer.send('pet:prts:cancel-download'),
  exportFeedbackDiagnostics: () => ipcRenderer.invoke('pet:feedback:export-diagnostics'),
  openFeedbackForm: () => ipcRenderer.invoke('pet:feedback:open-form'),
  getAppInfo: () => ipcRenderer.invoke('pet:app-info'),
  diagnostic: (payloadOrEvent, details) => {
    const payload = typeof payloadOrEvent === 'string'
      ? { event: payloadOrEvent, details }
      : payloadOrEvent;
    ipcRenderer.send('pet:diagnostic', payload);
  },
  onBehavior: (callback) => ipcRenderer.on('pet:behavior', (_event, behavior) => callback(behavior)),
  onScale: (callback) => ipcRenderer.on('pet:scale', (_event, scale, layout) => callback(scale, layout)),
  onMoveSpeed: (callback) => ipcRenderer.on('pet:move-speed', (_event, speed) => callback(speed)),
  onBehaviorActivity: (callback) => ipcRenderer.on('pet:behavior-activity', (_event, activity) => callback(activity)),
  onCharacterDistance: (callback) => ipcRenderer.on('pet:character-distance', (_event, layout) => callback(layout)),
  onFocusMode: (callback) => ipcRenderer.on('pet:focus-mode', (_event, enabled) => callback(enabled)),
  onControlsHiddenState: (callback) => ipcRenderer.on('pet:controls-hidden-state', (_event, hidden) => callback(hidden)),
  onProfilesState: (callback) => ipcRenderer.on('pet:profiles-state', (_event, state) => callback(state)),
  onPritsDownloadProgress: (callback) => ipcRenderer.on('pet:prts-download-progress', (_event, progress) => callback(progress)),
  onShowControls: (callback) => ipcRenderer.on('pet:show-controls', callback),
  onAutoState: (callback) => ipcRenderer.on('pet:auto-state', (_event, enabled) => callback(enabled))
});
