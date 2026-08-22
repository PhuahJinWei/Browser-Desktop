# 1. Static hosting on GitHub Pages, with no backend

Status: accepted (M0)

## Context

Tabula is a portfolio project that must cost nothing to run and must keep running years from now
without anyone paying a bill or rotating a credential. It also makes a privacy claim — that files
dropped into it never leave the tab — and that claim is only as strong as the number of servers
involved.

## Decision

Ship as static files on GitHub Pages. No backend, no database, no analytics, no third-party
scripts or fonts. Exactly two hosts may ever be contacted: the origin serving the app, and
`huggingface.co` for model weights, only after explicit consent (see ADR 0003).

## Consequences

- No response headers. Cross-origin isolation and the Content-Security-Policy have to arrive by
  other means — a service worker (ADR 0002) and a `<meta>` tag respectively.
- `frame-ancestors` cannot be enforced, because browsers ignore it in a meta policy. Accepted and
  documented rather than worked around.
- Limits to design within: 1 GB site, 100 GB/month soft bandwidth, 100 MB per file in git.
- Every project site shares the `<user>.github.io` origin, so storage keys must be namespaced,
  or the site published from a dedicated organisation account.
- GitHub Release assets were evaluated for hosting weights and rejected: their CDN sends no
  `Access-Control-Allow-Origin`, so a browser cannot fetch them (verified 2026-08-22).
- The privacy claim becomes verifiable rather than rhetorical: a network panel with nothing in it
  is the proof.
