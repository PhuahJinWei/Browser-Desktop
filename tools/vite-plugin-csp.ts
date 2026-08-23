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
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    // Watch, and only Watch: the embed endpoint exists to be framed. `connect-src` deliberately
    // stays without it — the desktop itself still cannot talk to YouTube, it can only show a frame
    // that does, which is the difference the app's whole claim rests on.
    "frame-src 'self' blob: https://www.youtube-nocookie.com",
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
