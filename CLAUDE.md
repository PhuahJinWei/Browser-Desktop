# Working agreements for AI assistants in this repository

## Authorship — read this first

**All commits, pull requests, release notes and project credits are authored by the project owner
alone.**

- Do **not** add `Co-Authored-By: Claude <...>` (or any other AI co-author trailer) to commits.
- Do **not** add "Generated with Claude Code", "Made with AI" or similar footers to commits, pull
  request bodies, release notes, documentation or code comments.
- Do **not** list an AI tool as an author, contributor or credit anywhere in the repository.

AI tools may be used freely as assistants while building this project. They are not credited as
authors. If a tool adds such a trailer automatically, remove it before the commit lands.

## What this project is

Tabula: a local-first AI desktop that runs entirely in a browser tab, deployed as static files to
GitHub Pages at zero cost. See `plan v2.md` for the roadmap and `docs/adr/` for decisions already
made — read the relevant ADR before changing anything it covers.

## Constraints that are not negotiable

1. **No backend.** No servers, accounts, sync, telemetry or analytics.
2. **Two hosts only.** The serving origin, and `huggingface.co` for consent-gated model weights.
   Never add a third-party script, font or CDN.
3. **Nothing requires a language model.** Text generation is an optional plug-in (ADR 5).
4. **Static hosting limits apply**: no response headers, 1 GB site, 100 GB/month soft bandwidth,
   100 MB per file in git.
5. **Measure before choosing.** Backend and model decisions cite benchmark numbers (ADR 8). If a
   number is not in `docs/benchmarks/`, it is an assumption and must be labelled as one.

## Conventions

- TypeScript strict. Pinned to 6.0.x because `typescript-eslint` requires `<6.1.0`.
- Run `npm run verify` (typecheck, lint, test, build) before considering work done.
- Conventional Commits; squash merges; a tag per milestone.
- Comments explain _why_, not what. Prefer no comment to a restatement of the code.
- Accessibility is not a later pass: keyboard-first, visible focus, correct roles from the start.
