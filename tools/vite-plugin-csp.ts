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
 *    to. Only the model CDN is listed, and only for consent-gated weight downloads.
 *  - There is deliberately no 'unsafe-inline' anywhere.
 */
const POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  // No `frame-ancestors`: browsers ignore it in a <meta> policy and log an error for it. Clickjacking
  // protection needs a real header, which GitHub Pages cannot send — noted as a known limitation.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' blob:",
  [
    'connect-src',
    "'self'",
    'blob:',
    'data:',
    'https://huggingface.co',
    'https://*.huggingface.co',
    'https://*.hf.co',
  ].join(' '),
].join('; ');

export function cspPlugin(): Plugin {
  return {
    name: 'tabula:csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const isBuild = !ctx.server;
        const tag = isBuild
          ? `<meta http-equiv="Content-Security-Policy" content="${POLICY}" />`
          : '<!-- CSP is injected for production builds only; the dev server needs inline HMR scripts. -->';
        return html.replace('<!--%CSP%-->', tag);
      },
    },
  };
}

export const CSP_POLICY = POLICY;
