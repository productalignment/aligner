/// <reference types="vite/client" />

declare global {
  interface Window {
    __alignerNavigate?: (spec: Record<string, unknown>) => void;
  }
}
export {};
