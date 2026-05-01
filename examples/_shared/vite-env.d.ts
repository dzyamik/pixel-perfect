// Type declarations for Vite-specific import suffixes used by the
// demos' code-panel module. `?raw` returns the file's source as a
// string at build time; tsc doesn't know about the suffix without
// this hint.

declare module '*?raw' {
    const src: string;
    export default src;
}
