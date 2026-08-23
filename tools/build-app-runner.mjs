/**
 * Builds public/app-runner.html — the document every sandboxed app runs inside.
 *
 * Two things force this to be a generated file with its script inlined:
 *
 *  1. The iframe is sandboxed without `allow-same-origin`, so the document has an **opaque
 *     origin**. In an opaque origin the CSP keyword `'self'` matches nothing, so an external
 *     `<script src>` cannot be permitted without also permitting a network fetch — which is the
 *     one thing this sandbox exists to prevent.
 *  2. A sandboxed frame **does** inherit its embedder's CSP, because its origin is opaque — the
 *     rule exists precisely so sandboxing cannot be used to escape a policy. That was measured,
 *     not assumed: an identical frame without the sandbox attribute ran its script, and with it
 *     the script was silently blocked by the desktop's own `script-src 'self'`.
 *
 *     So the desktop's policy must also permit this bootstrap. It does so by hash — the digest
 *     below is written out for tools/vite-plugin-csp.ts to include — which allows exactly this
 *     one script and nothing else, rather than opening the desktop to inline script generally.
 *
 * Generated on predev and prebuild; not committed.
 *
 *   node tools/build-app-runner.mjs
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = 'public/app-runner.html';

/**
 * The sandbox's own Content-Security-Policy.
 *
 * `connect-src 'none'` is the important line: an app cannot fetch, XHR, open a WebSocket or send a
 * beacon. Combined with the opaque origin (no localStorage, no IndexedDB, no OPFS, no cookies) and
 * the absence of `allow-same-origin` (no reaching into the parent document), an app's only route
 * to the outside world is a postMessage the desktop chooses to honour.
 *
 * `script-src` allows inline for the bootstrap below and `blob:` for the app's own code, which the
 * bootstrap turns into an object URL. It does not allow any remote origin, so an app cannot smuggle
 * data out inside a script URL.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

const result = await build({
  entryPoints: ['src/sdk/runner.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  logLevel: 'warning',
});

const script = result.outputFiles?.[0]?.text ?? '';
if (!script) throw new Error('The runner bundle came out empty');

/**
 * A small stylesheet so an app starts on a surface that matches the desktop's theme instead of a
 * white rectangle. Apps can override all of it; this is a starting point, not a framework.
 */
/**
 * The sandbox stylesheet, kept as its own string so it can be hashed.
 *
 * It has to be: a srcdoc document inherits its embedder's CSP, the desktop's `style-src` is
 * `'self'` with no `'unsafe-inline'`, and an inline <style> under that policy is dropped silently.
 * Which is exactly what happened — every app ran with browser default styling, and the theme the
 * boot message carried had nowhere to land. Allowing it by hash rather than by `'unsafe-inline'`
 * keeps the policy as tight as it was: this one stylesheet, pinned to this build.
 */
const css = `      :root {
        color-scheme: light dark;
        --bg: #ffffff;
        --fg: #12161c;
        --muted: #6b7684;
        --line: #dfe4ea;
        --accent: #0d7a6f;
      }
      html[data-theme='dark'] {
        --bg: #171c23;
        --fg: #e8edf3;
        --muted: #7b8593;
        --line: #262e38;
        --accent: #5eead4;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        padding: 16px;
        overflow: auto;
      }
      button {
        font: inherit;
        color: inherit;
        padding: 6px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: transparent;
        cursor: pointer;
      }
      button:hover { border-color: var(--accent); color: var(--accent); }
      input, textarea, select {
        font: inherit;
        color: inherit;
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 6px 10px;
      }
      a { color: var(--accent); }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

      /*
       * The classic skin, sent in the boot message beside the theme.
       *
       * A sandboxed app is a separate document with an opaque origin: it cannot import the
       * desktop's stylesheet and should not be forced to. So the skin arrives as an attribute and
       * a handful of variables, and an app that overrides them still wins — a starting point, not
       * a rule. What it buys is that the three bundled sample apps look like they belong to the
       * desktop around them without knowing the skin exists, because they were already written
       * against the variables.
       */
      html[data-skin='classic'] {
        color-scheme: light;
        --bg: #c0c0c0;
        --fg: #000000;
        --muted: #404040;
        --line: #808080;
        --accent: #000080;
      }
      html[data-skin='classic'] body {
        font-family: 'MS Sans Serif', 'Microsoft Sans Serif', Tahoma, Geneva, Verdana, sans-serif;
        font-size: 13px;
        -webkit-font-smoothing: none;
      }
      html[data-skin='classic'] button {
        border: 1px solid #000000;
        border-radius: 0;
        background: #c0c0c0;
        color: #000000;
        box-shadow:
          inset 1px 1px 0 0 #ffffff, inset -1px -1px 0 0 #404040,
          inset 2px 2px 0 0 #dfdfdf, inset -2px -2px 0 0 #808080;
      }
      html[data-skin='classic'] button:hover { border-color: #000000; color: #000000; }
      html[data-skin='classic'] button:active {
        box-shadow:
          inset 1px 1px 0 0 #404040, inset -1px -1px 0 0 #ffffff,
          inset 2px 2px 0 0 #808080, inset -2px -2px 0 0 #dfdfdf;
        padding-top: 7px;
        padding-left: 13px;
      }
      html[data-skin='classic'] input,
      html[data-skin='classic'] textarea,
      html[data-skin='classic'] select {
        border: 1px solid #000000;
        border-radius: 0;
        background: #ffffff;
        color: #000000;
        box-shadow: inset 1px 1px 0 0 #808080, inset -1px -1px 0 0 #ffffff;
      }
      html[data-skin='classic'] :focus-visible {
        outline: 2px dotted #000000;
        outline-offset: 1px;
      }
`;

const html = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <title>Sandboxed app</title>
    <style>
${css}    </style>
  </head>
  <body>
    <script>${script}</script>
  </body>
</html>
`;

await mkdir('public', { recursive: true });
await writeFile(OUT, html);

// The desktop's CSP is inherited by the sandbox, so it must allow this exact script. A hash
// pins it to this build: change a byte of the runner and the digest changes with it.
const digest = createHash('sha256').update(script, 'utf8').digest('base64');
await writeFile('.app-runner-hash', `sha256-${digest}
`);

// The stylesheet needs the same treatment and for the same reason. Sliced back out of the
// generated document rather than hashed from the `css` constant: what the browser hashes is
// everything between the tags, which includes the newline the template puts after <style> and the
// indent before </style>. Hashing the constant was five bytes short of that, and a CSP hash that
// is close is a CSP hash that blocks.
if (html.split('<style>').length !== 2) {
  // Two stylesheets would need two hashes, and the browser would silently drop whichever went
  // unhashed — the same silent failure this whole mechanism exists to end.
  throw new Error('The runner document must contain exactly one <style> block');
}
const styleOpen = html.indexOf('<style>') + '<style>'.length;
const styleBody = html.slice(styleOpen, html.indexOf('</style>'));
if (!styleBody.includes('--accent')) {
  throw new Error('The extracted stylesheet does not look like the stylesheet');
}
const styleDigest = createHash('sha256').update(styleBody, 'utf8').digest('base64');
await writeFile('.app-runner-style-hash', `sha256-${styleDigest}
`);
console.log(`app-runner.html built (${(html.length / 1024).toFixed(1)} KB, script ${(script.length / 1024).toFixed(1)} KB)`);
console.log('  sandbox policy: no network, no storage, no parent access');
console.log(`  script hash: sha256-${digest.slice(0, 16)}…`);
console.log(`  style hash:  sha256-${styleDigest.slice(0, 16)}…`);
