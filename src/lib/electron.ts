// Typed accessor for the preload bridge exposed by the Electron shell.
// Returns null in a normal browser so the same UI works everywhere.
export interface CodingSource {
  id: string;
  name: string;
  /** Small preview data URL for the picker. */
  thumbnail: string;
  displayId: string;
}

export interface ElectronAPI {
  isElectron: true;
  platform: NodeJS.Platform;
  minimize: () => void;
  close: () => void;
  togglePin: () => Promise<boolean>;
  cycleOpacity: () => Promise<number>;
  stealth: {
    get: () => Promise<boolean>;
    set: (enabled: boolean) => Promise<boolean>;
    toggle: () => Promise<boolean>;
    onChanged: (callback: (enabled: boolean) => void) => () => void;
  };
  onGenerate: (callback: () => void) => () => void;
  coding: {
    /** Screens + windows available to capture (for the one-time source picker). */
    listSources: () => Promise<CodingSource[]>;
    /** Capture a fresh high-res PNG data URL of the chosen source, or null. */
    capture: (sourceId: string) => Promise<string | null>;
    /** Global hotkey to open/close the coding panel. Returns an unsubscribe fn. */
    onToggle: (callback: () => void) => () => void;
    /** Global hotkey to capture the shared screen. Returns an unsubscribe fn. */
    onCapture: (callback: () => void) => () => void;
  };
  liveCaptions: {
    start: () => void;
    stop: () => void;
    onText: (callback: (text: string) => void) => () => void;
    onError: (callback: (message: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export function isElectron(): boolean {
  return getElectronAPI() !== null;
}
