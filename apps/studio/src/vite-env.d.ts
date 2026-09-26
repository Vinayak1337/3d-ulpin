/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** `off` disables the local data layer in development. */
  readonly VITE_LOCAL_DATA?: 'on' | 'off';
}
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
declare module '*?raw' {
  const content: string;
  export default content;
}
