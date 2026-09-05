import { contextBridge, ipcRenderer } from 'electron';

const listenerMap = new Map<string, (...args: any[]) => void>();

function safeOn(channel: string, cb: (...args: any[]) => void) {
  const wrapped = (_event: any, ...args: any[]) => cb(...args);
  listenerMap.set(`${channel}:${cb.toString().slice(0, 50)}`, wrapped);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld('assistant', {
  showWindow: () => ipcRenderer.send('show-window'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  resizeToOrb: () => ipcRenderer.send('resize-to-orb'),
  resizeToOnboarding: () => ipcRenderer.send('resize-to-onboarding'),
  resizeToPanel: () => ipcRenderer.send('resize-to-panel'),
  resizeToWidget: () => ipcRenderer.send('resize-to-widget'),
  sendAudio: (audio: ArrayBuffer) => ipcRenderer.send('send-audio', audio),
  sendText: (text: string) => ipcRenderer.send('send-text', text),
  stopSpeech: () => ipcRenderer.send('stop-speech'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enable: boolean) => ipcRenderer.invoke('autostart:set', enable),
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  pullOllamaModel: () => ipcRenderer.invoke('ollama:pull'),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  runSetupSequence: () => ipcRenderer.invoke('setup:run'),
  retrySetup: () => ipcRenderer.invoke('setup:retry'),
  getSetupLogs: () => ipcRenderer.invoke('setup:logs'),
  getDbStatus: () => ipcRenderer.invoke('db:status'),
  getSystemStatus: () => ipcRenderer.invoke('sys:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  setSttModel: (modelName: string) => ipcRenderer.invoke('stt:set-model', modelName),
  setTtsVoice: (voiceName: string) => ipcRenderer.invoke('tts:set-voice', voiceName),
  onTranscript: (cb: (data: { text: string }) => void) =>
    safeOn('transcript', cb),
  offTranscript: (cb: (data: { text: string }) => void) => {
    ipcRenderer.removeAllListeners('transcript');
  },
  onResponse: (cb: (response: { spoken?: string; display?: string }) => void) =>
    safeOn('response', cb),
  offResponse: () => {
    ipcRenderer.removeAllListeners('response');
  },
  onWindowShown: (cb: () => void) =>
    safeOn('window-shown', cb),
  offWindowShown: () => {
    ipcRenderer.removeAllListeners('window-shown');
  },
  onSetupProgress: (cb: (data: { progress: number; text: string }) => void) =>
    safeOn('setup:progress', cb),
  offSetupProgress: () => {
    ipcRenderer.removeAllListeners('setup:progress');
  },
});
