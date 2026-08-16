/**
 * One declaration for the injected provider, shared by every component.
 * Two files declaring `window.ethereum` with different shapes is a TS2717
 * compile error — this file is the single source of that truth.
 */
interface InjectedEthereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (accounts: string[]) => void) => void;
  removeListener?: (event: string, handler: (accounts: string[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: InjectedEthereum;
  }
}

export {};
