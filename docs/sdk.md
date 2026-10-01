# Writing an app for Tabula

An app is **one JavaScript file**. There is no build step, no package format, and no registry —
partly because the desktop has no backend to host one, and partly because a single readable file
is something you can inspect before you trust it.

> **Stability.** The SDK is at `v0` and will change. Method names and shapes are not frozen until
> the surface has been used by apps nobody on this project wrote. Anything below may move; it will
> not move silently, and the version is in `docs/sdk.md` history.

## The shape of an app

```js
/* tabula-app
{
  "id": "com.example.wordcount",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Counts words in the file you open it with",
  "author": "Your name",
  "permissions": ["fs:read"],
  "defaultSize": { "width": 480, "height": 320 }
}
*/

os.ui.setTitle('Word Count');

if (os.args.fileId) {
  os.fs.readText(os.args.fileId).then(function (text) {
    document.body.textContent = text.trim().split(/\s+/).length + ' words';
  });
} else {
  document.body.textContent = 'Open a text file with this app.';
}
```

The manifest is JSON inside a leading `/* tabula-app … */` comment. Everything after it is your
app, running in a document of its own with `os` in scope.

Two optional fields shape the window. `"resizable": false` opens it at exactly its size and keeps
it there — no resizing, snapping or maximising — and lets it be smaller than a resizable window
may be (160×120 rather than 320×200). `"skinSizes": { "classic": {…}, "modern": {…} }` gives a size
per skin, for an app whose two looks are different shapes; the document's `data-skin` attribute
says which one it is in, and changes when the user switches. The bundled Calculator uses both.

Install it in **Settings → Apps → Install from file**, or share it as a link — the whole app is
encoded into the URL fragment, which browsers never send to a server.

## What the sandbox is

Your app runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. Measured
consequences, not promises:

|                                                          |                                      |
| -------------------------------------------------------- | ------------------------------------ |
| `localStorage`, `sessionStorage`, cookies                | `SecurityError`                      |
| `indexedDB`, `caches`                                    | `SecurityError`                      |
| Origin private file system                               | promise rejects with `SecurityError` |
| `parent.document`, `parent.localStorage`, `top.location` | `SecurityError`                      |
| `location.origin`                                        | `null` — the origin is opaque        |
| `fetch`, remote images, WebSocket                        | blocked by `connect-src 'none'`      |

**There is no network permission and there will not be one.** If your app needs data from the
internet, it is not an app for this desktop.

You have a normal DOM to build a UI with, and `os` for everything else.

## Permissions

Declare what you need in the manifest. Declaring grants nothing: the user is asked the first time
your app actually calls a method, and can revoke it later in Settings.

| Capability      | What it allows                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `fs:read`       | Read files in your own folder, and the one file the user opened your app with |
| `fs:write`      | Create and change files in your own folder                                    |
| `ai:embed`      | Turn text into vectors with the desktop's embedding model                     |
| `ai:search`     | Search the user's indexed documents                                           |
| `notifications` | Show a desktop notification                                                   |
| `clipboard`     | Write text to the clipboard                                                   |
| `storage`       | Keep your own settings                                                        |

A refused call rejects with a message. Handle it — a denial is a normal outcome, not a bug:

```js
os.ai.search('invoices').then(showResults, function (error) {
  status.textContent = error.message; // "Permission denied: ai:search"
});
```

## Files are scoped

Your app has a folder at `Apps/<Your App Name>/`. That is what `fs:read` and `fs:write` reach,
plus `os.args.fileId` if the user opened a specific file with you. Anything else is refused:

```
write into own folder: ALLOWED
list own folder:       ALLOWED
read the home folder:  REFUSED — An app may only read its own files, or the file it was opened with
list the home folder:  REFUSED — An app may only list its own folder
remove a file outside: REFUSED — An app may only remove its own files
```

(That is the actual output of the boundary test in `docs/benchmarks/`, written by a sandboxed app
about itself.)

## The API

```ts
os.manifest                    // your own manifest
os.args                        // launch arguments; args.fileId when opened with a file

os.fs.list(folderId?)          // AppFile[] — your folder, or a subfolder of it
os.fs.readText(id)             // string
os.fs.readBytes(id)            // ArrayBuffer
os.fs.writeText(name, text)    // AppFile — always into your own folder
os.fs.createFolder(name)       // AppFile
os.fs.remove(id)               // true — moves to Trash

os.ai.embed(texts)             // number[][] — 384-dimensional, normalised
os.ai.search(query, limit?)    // { fileId, fileName, snippet, score }[]

os.ui.setTitle(title)          // window title, prefixed with your app's name
os.ui.notify(title, body?)     // a desktop notification
os.ui.close()                  // close your window

os.clipboard.writeText(text)
os.storage.get(key)            // whatever you stored, or null
os.storage.set(key, value)     // JSON-serialisable, up to 200 KB

os.on(topic, handler)          // returns an unsubscribe function
```

`AppFile` is `{ id, name, mime, size, modifiedAt }` — deliberately less than the desktop's own
node type. You get no parent ids and no content hashes, because you have no use for them.

## Practical notes

- **Everything is async.** The desktop is on the other side of a `postMessage`.
- **Your errors are visible.** An uncaught error or rejection is reported to the desktop and shown
  on your window, because the sandbox has no devtools a user would think to open.
- **Batch your embeddings** — `os.ai.embed` accepts up to 64 strings per call and is much cheaper
  that way.
- **Write plain ES2020.** Your source is executed as-is; there is no transpiler.
- **`os` is a parameter, not a global.** Your code runs inside a function that receives it, so
  your top-level `var`s are yours alone.

## The bundled apps are the reference

Three apps ship with the desktop, written against exactly this API and nothing else:

- **Calculator** — declares no permissions at all, and is never prompted.
- **Find** — `ai:search`, `clipboard`, `notifications`. Groups search results by document.
- **Scratchpad** — `fs:read`, `fs:write`, `storage`. Includes a button that deliberately asks for
  a file outside its folder, so you can watch the refusal.

Their source is in `src/shell/sampleAppSources.ts`, and you can read any installed app's source by
sharing it to a link and decoding the fragment.
