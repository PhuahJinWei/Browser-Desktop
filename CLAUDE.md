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
2. **One host, plus one frame.** The serving origin is the only host the desktop contacts. (The
   rule used to name `huggingface.co` for model weights; ADR 15 put the model in the build, so
   there is no second host and the CSP now enforces it.) The single exception is the **Watch** app,
   which may frame `youtube-nocookie.com` — user-initiated, announced by a live chip while it is
   loaded, and revocable in Settings ([ADR 20](./docs/adr/0020-one-frame-you-asked-for.md)).
   `connect-src` stays free of external hosts: the desktop cannot talk to YouTube, it can only show
   a frame that does. Never add a third-party script, font or CDN, and treat a second frame
   exception as needing its own ADR rather than following from this one.
3. **There is no text generation, and none is planned.** ADR 5 made the language model optional;
   ADR 14 removed the option. Do not add generative models, a chat surface, or an `os.ai` method
   that returns prose — every answer this desktop gives points into a file the user already has.
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
- `max-width` has two unrelated jobs and they look the same in a diff. A **text measure** caps line
  length and is always in `ch`; it must not be centred. A **layout column** is content narrower
  than the window around it; it must be centred, or a maximised window strands the difference down
  one side. Never hand-roll the second — compose `column` from `src/shell/layout.module.css` and
  set `--column-measure`. Every app runs maximised on a compact viewport, so this is not an edge
  case.
