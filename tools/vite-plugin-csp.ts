import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Injects the Content-Security-Policy as a <meta> tag at build time.
 *
 * GitHub Pages cannot set response headers, so the policy has to travel inside the document.
 * It is injected for production builds only: the dev server adds inline scripts for React Fast
 * Refresh and inline <style> tags for HMR, which a strict policy would (correctly) block.
 *
 * Notes on specific directives:
 *  - 'wasm-unsafe-eval' is required to instantiate WebAssembly (the ML runtime). It permits
 *    WASM compilation only, not JavaScript eval().
 *  - worker-src allows blob: because the ONNX runtime spawns workers from blob URLs.
 *  - connect-src is the important one: it is the allowlist of every host this app may ever talk
 *    to, and it now lists no host at all beyond 'self'. The model CDN used to be here for
 *    consent-gated weight downloads; the weights are in the build (ADR 15), so the browser now
 *    enforces the one-host claim rather than the app merely honouring it. Anything that tried to
 *    phone home — a dependency, a mistake, an injected script — would be blocked rather than
 *    logged after the fact.
 *  - There is deliberately no 'unsafe-inline' anywhere.
 */
const policy = () =>
  [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    // No `frame-ancestors`: browsers ignore it in a <meta> policy and log an error for it. Clickjacking
    // protection needs a real header, which GitHub Pages cannot send — noted as a known limitation.
    // Sandboxed app frames inherit this policy (their origin is opaque, and CSP is inherited
    // precisely so sandboxing cannot escape a policy), so it has to permit the sandbox bootstrap
    // and the blob: scripts that carry app code. The bootstrap is allowed by hash — one exact
    // script — rather than by opening the desktop to inline script in general.
    `script-src 'self' 'wasm-unsafe-eval' blob: '${runnerHash()}'`,
    "worker-src 'self' blob:",
    // The sandbox document is srcdoc, so it inherits this policy — including for its own inline
    // stylesheet, which was therefore being dropped and taking every sandboxed app's styling with
    // it. Allowed by hash rather than by 'unsafe-inline': one stylesheet, pinned to this build.
    `style-src 'self' '${runnerStyleHash()}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self' blob:",
    ['connect-src', "'self'", 'blob:', 'data:'].join(' '),
  ].join('; ');

/**
 * The digest of the sandbox bootstrap, written by tools/build-app-runner.mjs.
 *
 * Missing means the runner has not been built; the policy is still emitted so the desktop works,
 * but sandboxed apps will not start — and saying so here is better than a silent CSP failure
 * inside a frame nobody can inspect.
 */
function runnerHash(): string {
  try {
    return readFileSync('.app-runner-hash', 'utf8').trim();
  } catch {
    console.warn('[tabula:csp] .app-runner-hash is missing — run tools/build-app-runner.mjs');
    return '';
  }
}

function runnerStyleHash(): string {
  try {
    return readFileSync('.app-runner-style-hash', 'utf8').trim();
  } catch {
    console.warn('[tabula:csp] .app-runner-style-hash is missing — run tools/build-app-runner.mjs');
    return '';
  }
}

export function cspPlugin(): Plugin {
  return {
    name: 'tabula:csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const isBuild = !ctx.server;
        const tag = isBuild
          ? `<meta http-equiv="Content-Security-Policy" content="${policy()}" />`
          : '<!-- CSP is injected for production builds only; the dev server needs inline HMR scripts. -->';
        return html.replace('<!--%CSP%-->', tag);
      },
    },
  };
}

export const CSP_POLICY = policy;
