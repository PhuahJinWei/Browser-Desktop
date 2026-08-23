import type {
  AppFile,
  AppManifest,
  AppSearchHit,
  BootMessage,
  CallMessage,
  FromSandbox,
  ToSandbox,
} from './protocol';

/**
 * The sandbox bootstrap.
 *
 * This is the only code the desktop puts inside the iframe. It builds the `os` object an app
 * programs against, loads the app's source, and relays every request to the host over
 * postMessage. It runs in an opaque origin with `connect-src 'none'`, so it has no storage, no
 * network and no access to the page that hosts it — which is what makes running a stranger's code
 * here a reasonable thing to do.
 *
 * Compiled and inlined into app-runner.html by tools/build-app-runner.mjs, because a document with
 * an opaque origin cannot use `script-src 'self'` — `'self'` matches nothing when the origin is
 * opaque, so an external script file could not be allowed without also allowing a network fetch.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const pending = new Map<number, Pending>();
const listeners = new Map<string, Set<(payload: unknown) => void>>();
let nextId = 1;
let token = '';
let booted = false;

function send(message: FromSandbox): void {
  parent.postMessage(message, '*');
}

function call<T>(method: string, args: unknown[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const message: CallMessage = { kind: 'call', id, token, method, args };
    send(message);
  });
}

/** The object an app sees as `os`. Everything here is a message to the host. */
function makeApi(manifest: AppManifest, args: unknown) {
  return {
    manifest,
    args,

    fs: {
      list: (folder?: string) => call<AppFile[]>('fs.list', [folder ?? null]),
      readText: (id: string) => call<string>('fs.readText', [id]),
      readBytes: (id: string) => call<ArrayBuffer>('fs.readBytes', [id]),
      writeText: (name: string, text: string) => call<AppFile>('fs.writeText', [name, text]),
      createFolder: (name: string) => call<AppFile>('fs.createFolder', [name]),
      remove: (id: string) => call<boolean>('fs.remove', [id]),
    },

    ai: {
      embed: (texts: string[]) => call<number[][]>('ai.embed', [texts]),
      search: (query: string, limit?: number) =>
        call<AppSearchHit[]>('ai.search', [query, limit ?? 10]),
    },

    ui: {
      notify: (title: string, body?: string) => call<void>('ui.notify', [title, body ?? null]),
      setTitle: (title: string) => call<void>('ui.setTitle', [title]),
      close: () => call<void>('ui.close', []),
    },

    clipboard: {
      writeText: (text: string) => call<void>('clipboard.writeText', [text]),
    },

    storage: {
      get: <T>(key: string) => call<T | null>('storage.get', [key]),
      set: (key: string, value: unknown) => call<void>('storage.set', [key, value]),
    },

    on(topic: string, handler: (payload: unknown) => void): () => void {
      const set = listeners.get(topic) ?? new Set();
      set.add(handler);
      listeners.set(topic, set);
      return () => set.delete(handler);
    },
  };
}

/**
 * Runs the app's source.
 *
 * A blob script rather than `eval` or `new Function`: those need `'unsafe-eval'`, and a sandbox
 * that permits arbitrary string evaluation is harder to reason about than one that only permits
 * loading a blob it created itself. The app is wrapped in a function so its top-level
 * declarations do not collide with this bootstrap.
 */
function runApp(source: string): void {
  const wrapped = `(function(os){"use strict";\n${source}\n})(window.__tabulaOs);`;
  const blob = new Blob([wrapped], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  const script = document.createElement('script');
  script.src = url;
  script.addEventListener('error', () => {
    send({ kind: 'crash', token, message: 'The app script failed to load' });
    URL.revokeObjectURL(url);
  });
  script.addEventListener('load', () => URL.revokeObjectURL(url));
  document.head.append(script);
}

globalThis.addEventListener('message', (event: MessageEvent<ToSandbox>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.kind === 'boot') {
    // One boot per instance: a second one would be an attempt to replace the running app.
    if (booted) return;
    booted = true;
    token = (message as BootMessage).token;

    document.documentElement.dataset['theme'] = message.theme;
    document.documentElement.dataset['skin'] = message.skin;
    (window as unknown as { __tabulaOs: unknown }).__tabulaOs = makeApi(
      message.manifest,
      message.args,
    );

    try {
      runApp(message.source);
      send({ kind: 'ready', token });
    } catch (error) {
      send({
        kind: 'crash',
        token,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
    }
    return;
  }

  if (message.kind === 'result' || message.kind === 'error') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.kind === 'result') entry.resolve(message.value);
    else entry.reject(new Error(message.message));
    return;
  }

  if (message.kind === 'event') {
    for (const handler of listeners.get(message.topic) ?? []) {
      try {
        handler(message.payload);
      } catch {
        // An app's own event handler throwing must not take down the bridge.
      }
    }
  }
});

// Announce readiness for a boot message. The host also retries, so neither side depends on
// winning the race to attach its listener first.
send({ kind: 'hello' });

// Anything the app throws asynchronously is reported to the host rather than lost in a console
// nobody can see — the sandbox has no devtools of its own that a user would think to open.
globalThis.addEventListener('error', (event) => {
  if (!booted) return;
  send({ kind: 'crash', token, message: event.message });
});
globalThis.addEventListener('unhandledrejection', (event) => {
  if (!booted) return;
  send({ kind: 'crash', token, message: String((event as PromiseRejectionEvent).reason) });
});
