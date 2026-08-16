// Types for the Electron preload bridge (see preload.js and main.cjs).
export interface HimsServerInfo {
  isServer: boolean;
  running: boolean;
  error?: string;
  superadminUsername?: string;
  superadminPassword?: string;
}

declare global {
  interface Window {
    hims?: {
      getServerInfo: () => Promise<HimsServerInfo>;
    };
  }
}

export {};
