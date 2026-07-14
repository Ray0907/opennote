declare module '*.sql?raw' {
  const src: string
  export default src
}

interface Window {
  /** Injected by the Electron preload bridge; absent in plain browsers. */
  opennote?: import('./shell').ShellApi
}
