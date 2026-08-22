/**
 * Fetches the sandbox document once and hands it to frames as `srcdoc`.
 *
 * Why not simply point the iframe at the URL: in testing, a sandboxed frame (`allow-scripts`
 * without `allow-same-origin`) loading a real same-origin URL did not execute its inline script,
 * while the identical markup supplied through `srcdoc` did. That held with the document's own CSP,
 * without it, and with the service worker's isolation headers removed — so it is a property of the
 * embedding environment rather than of the policy.
 *
 * Rather than depend on behaviour that differs between engines, the document is delivered as
 * srcdoc, which is at least as locked down: the frame still has an opaque origin, still has no
 * storage and no reach into this page, still carries its own `connect-src 'none'`, and — because
 * srcdoc documents inherit their embedder's policy — is additionally bound by the desktop's own
 * CSP, which permits the bootstrap only by hash.
 */

let cached: Promise<string> | null = null;

export function runnerDocument(): Promise<string> {
  cached ??= fetch(`${import.meta.env.BASE_URL}app-runner.html`)
    .then((response) => {
      if (!response.ok) throw new Error(`app-runner.html: ${response.status}`);
      return response.text();
    })
    .catch((error: unknown) => {
      // Reset so a later attempt can retry rather than being stuck with a rejected promise.
      cached = null;
      throw error;
    });
  return cached;
}
