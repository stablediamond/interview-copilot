// Typed accessor for the preload bridge exposed by the Electron shell.
// Returns null in a normal browser so the same UI works everywhere.
export interface CodingSource {
  id: string;
  name: string;
  /** Small preview data URL for the picker. */
  thumbnail: string;
  displayId: string;
}

export interface ChatgptNavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface ChatgptBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface JobTrackStoredSession {
  token: string;
  email: string;
  expiresAt: number;
  firstname?: string;
  lastname?: string;
  privilege?: string;
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
  chatgpt: {
    enter: () => Promise<void>;
    leave: () => Promise<void>;
    layout: (bounds: ChatgptBounds) => void;
    reload: () => Promise<void>;
    home: () => Promise<void>;
    navigate: (url: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    clearSession: () => Promise<void>;
    submit: (text: string) => Promise<{ ok: boolean; error?: string }>;
    zoomIn: () => Promise<number>;
    zoomOut: () => Promise<number>;
    getZoom: () => Promise<number>;
    onNav: (callback: (state: ChatgptNavState) => void) => () => void;
    onError: (callback: (message: string) => void) => () => void;
  };
  jobTrack: {
    getSession: () => Promise<JobTrackStoredSession | null>;
    setSession: (session: JobTrackStoredSession | null) => Promise<boolean>;
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
