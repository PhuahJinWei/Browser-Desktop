/**
 * The wire protocol between a sandboxed app and the desktop.
 *
 * Shared by both sides, which is the point: the host validates against exactly the shape the
 * client sends, and neither can drift without the other failing to compile.
 *
 * Everything crossing this boundary is untrusted. The host treats every field as hostile input —
 * an app is a stranger's code running inside the user's desktop, and the only reason that is
 * acceptable is that this boundary is narrow and enforced.
 */

/** What an app may ask to do. Nothing is implied; each is granted separately. */
export type Capability =
  'fs:read' | 'fs:write' | 'ai:embed' | 'ai:search' | 'notifications' | 'clipboard' | 'storage';

export const CAPABILITY_LABELS: Record<Capability, string> = {
  'fs:read': 'Read files you open with it',
  'fs:write': 'Create and change files in its own folder',
  'ai:embed': 'Use the embedding model',
  'ai:search': 'Search your indexed files',
  notifications: 'Show notifications',
  clipboard: 'Write to the clipboard',
  storage: 'Store its own settings',
};

/**
 * There is deliberately no network capability, and there never will be one: the sandbox document
 * is served with `connect-src 'none'`, so an app cannot reach the network even if the desktop
 * wanted to let it.
 */
export const NETWORK_CAPABILITY_EXISTS = false;

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Author-supplied, shown in Settings. Not verified — it is a claim, not an identity. */
  author?: string;
  permissions: Capability[];
  /** Which file types this app offers to open. */
  handles?: string[];
  defaultSize?: { width: number; height: number };
}

/* -------------------------------------------------------------------------------------------- */
/* Messages                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/** Host to sandbox: the app's code and the environment it starts in. */
export interface BootMessage {
  kind: 'boot';
  manifest: AppManifest;
  source: string;
  /** Opaque token the app must echo on every call; proves the message came from this instance. */
  token: string;
  args: unknown;
  theme: 'light' | 'dark';
  /**
   * Which skin the desktop is wearing.
   *
   * Sent for the same reason as `theme`: an app that starts on a surface unlike everything around
   * it looks broken rather than distinct. The runner turns it into a `data-skin` attribute and a
   * set of variables; an app that overrides them still wins, because this is a starting point
   * rather than a rule.
   */
  skin: 'modern' | 'classic';
  /**
   * Whether the desktop is drawing the era's own pointers.
   *
   * Its own field rather than something the runner infers from `skin`, because it is its own
   * setting: the pointers can be switched off while the classic skin stays on, since a custom
   * cursor is the one part of a skin that overrides an operating-system accessibility choice.
   * A frame does not inherit its embedder's cursor, so without this an app's window is the one
   * rectangle on a classic desktop still showing the modern pointing hand.
   */
  cursors: 'classic' | 'system';
}

/** Sandbox to host: a request to do something the app cannot do itself. */
export interface CallMessage {
  kind: 'call';
  id: number;
  token: string;
  method: string;
  args: unknown[];
}

export interface ResultMessage {
  kind: 'result';
  id: number;
  value: unknown;
}

export interface ErrorMessage {
  kind: 'error';
  id: number;
  message: string;
}

/** Host to sandbox: something happened that the app subscribed to. */
export interface EventMessage {
  kind: 'event';
  topic: string;
  payload: unknown;
}

/**
 * Sandbox to host: the frame is loaded and waiting for its app.
 *
 * Without this the two sides race: an iframe can finish loading before the host has attached its
 * listener, and a boot message sent into that gap is simply lost.
 */
export interface HelloMessage {
  kind: 'hello';
}

/** Sandbox to host: the app is up, or it failed to start. */
export interface ReadyMessage {
  kind: 'ready';
  token: string;
}

export interface CrashMessage {
  kind: 'crash';
  token: string;
  message: string;
  stack?: string;
}

export type ToSandbox = BootMessage | ResultMessage | ErrorMessage | EventMessage;
export type FromSandbox = HelloMessage | CallMessage | ReadyMessage | CrashMessage;

/* -------------------------------------------------------------------------------------------- */
/* The API surface                                                                                */
/* -------------------------------------------------------------------------------------------- */

/** A file, as an app sees it. Deliberately less than the kernel's node: no parent ids, no hashes. */
export interface AppFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  modifiedAt: number;
}

export interface AppSearchHit {
  fileId: string;
  fileName: string;
  snippet: string;
  score: number;
}

/**
 * Which capability each method needs.
 *
 * A single table rather than checks scattered through the handlers: this way the answer to "what
 * can an app with only `fs:read` actually call?" is one thing to read, and adding a method
 * without deciding its permission is a type error rather than an accidental hole.
 */
export const METHOD_CAPABILITIES = {
  'fs.list': 'fs:read',
  'fs.readText': 'fs:read',
  'fs.readBytes': 'fs:read',
  'fs.writeText': 'fs:write',
  'fs.createFolder': 'fs:write',
  'fs.remove': 'fs:write',
  'ai.embed': 'ai:embed',
  'ai.search': 'ai:search',
  'ui.notify': 'notifications',
  'ui.setTitle': null,
  'ui.close': null,
  'clipboard.writeText': 'clipboard',
  'storage.get': 'storage',
  'storage.set': 'storage',
} as const satisfies Record<string, Capability | null>;

export type AppMethod = keyof typeof METHOD_CAPABILITIES;

export function capabilityFor(method: string): Capability | null | undefined {
  return (METHOD_CAPABILITIES as Record<string, Capability | null>)[method];
}
