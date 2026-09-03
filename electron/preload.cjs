const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge exposed to the renderer (the Next.js app).
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send("win:minimize"),
  close: () => ipcRenderer.send("win:close"),
  togglePin: () => ipcRenderer.invoke("win:toggle-pin"),
  cycleOpacity: () => ipcRenderer.invoke("win:cycle-opacity"),
  // Stealth: exclude the overlay from screen capture / screen share.
  stealth: {
    get: () => ipcRenderer.invoke("stealth:get"),
    set: (enabled) => ipcRenderer.invoke("stealth:set", enabled),
    toggle: () => ipcRenderer.invoke("stealth:toggle"),
    onChanged: (callback) => {
      const handler = (_e, enabled) => callback(enabled);
      ipcRenderer.on("stealth-changed", handler);
      return () => ipcRenderer.removeListener("stealth-changed", handler);
    },
  },
  // Subscribe to the global "generate" hotkey. Returns an unsubscribe fn.
  onGenerate: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("global-generate", handler);
    return () => ipcRenderer.removeListener("global-generate", handler);
  },
  // Live-coding copilot: screen capture + global hotkeys.
  coding: {
    listSources: () => ipcRenderer.invoke("coding:list-sources"),
    capture: (sourceId) => ipcRenderer.invoke("coding:capture", sourceId),
    onToggle: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("coding-toggle", handler);
      return () => ipcRenderer.removeListener("coding-toggle", handler);
    },
    onCapture: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("coding-capture", handler);
      return () => ipcRenderer.removeListener("coding-capture", handler);
    },
  },
  // Embedded ChatGPT: native WebContentsView over the ChatGPT page.
  chatgpt: {
    enter: () => ipcRenderer.invoke("chatgpt:enter"),
    leave: () => ipcRenderer.invoke("chatgpt:leave"),
    layout: (bounds) => ipcRenderer.send("chatgpt:layout", bounds),
    reload: () => ipcRenderer.invoke("chatgpt:reload"),
    home: () => ipcRenderer.invoke("chatgpt:home"),
    navigate: (url) => ipcRenderer.invoke("chatgpt:navigate", url),
    goBack: () => ipcRenderer.invoke("chatgpt:back"),
    goForward: () => ipcRenderer.invoke("chatgpt:forward"),
    clearSession: () => ipcRenderer.invoke("chatgpt:clear-session"),
    onNav: (callback) => {
      const handler = (_e, state) => callback(state);
      ipcRenderer.on("chatgpt-nav", handler);
      return () => ipcRenderer.removeListener("chatgpt-nav", handler);
    },
    onError: (callback) => {
      const handler = (_e, message) => callback(message);
      ipcRenderer.on("chatgpt-error", handler);
      return () => ipcRenderer.removeListener("chatgpt-error", handler);
    },
  },
  // Windows Live Captions bridge.
  liveCaptions: {
    start: () => ipcRenderer.send("livecaptions:start"),
    stop: () => ipcRenderer.send("livecaptions:stop"),
    onText: (callback) => {
      const handler = (_e, text) => callback(text);
      ipcRenderer.on("live-caption-text", handler);
      return () => ipcRenderer.removeListener("live-caption-text", handler);
    },
    onError: (callback) => {
      const handler = (_e, message) => callback(message);
      ipcRenderer.on("live-caption-error", handler);
      return () => ipcRenderer.removeListener("live-caption-error", handler);
    },
  },
});
