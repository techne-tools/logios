// Globals the addon sandbox provides. Declared (not imported) so the bundle
// typechecks; see addon/bootstrap.js for where the sandbox is built and
// src/index.ts for what it exposes.

declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare const addon: import("../src/addon").default;

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const __env__: "production" | "development";

// Present on the addon's window but absent from the sandbox typings.
declare function requestAnimationFrame(callback: FrameRequestCallback): number;
declare function cancelAnimationFrame(handle: number): void;
