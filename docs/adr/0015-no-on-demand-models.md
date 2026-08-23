# 15. Nothing is downloaded on demand: the perception models are removed

Status: accepted (post-M4). Follows [ADR 14](./0014-no-text-generation.md), which removed text
generation. Supersedes the model half of [ADR 3](./0003-model-weights-in-tiers.md), and retires
[ADR 10](./0010-model-choices-are-tested-not-assumed.md), [ADR 12](./0012-video-moments.md) and
[ADR 13](./0013-ocr.md) along with the features they describe.

## Context

Three models were fetched from `huggingface.co` the first time a feature needed them, each behind a
consent dialog: CLIP (150 MB) for photo and video search, Whisper tiny (69 MB) for transcription,
TrOCR (66 MB) for reading scanned pages.

The objection to that arrangement was not technical. It is that a portfolio piece which greets a
visitor with **"Download a model? 150 MB"** before it will do the thing it advertises is asking for
a commitment the visitor has no reason to make. Someone looking at this for ninety seconds will
click "Not now", and everything behind the dialog may as well not exist.

Two ways out were weighed. **Self-hosting** the weights on the same origin would have removed the
third host and let the download happen silently on first use — arguably making the project's claim
stronger, since it would then contact exactly one host. It costs ~310 MB of GitHub Pages bandwidth
per visitor who tries everything, which is roughly 330 such visitors a month inside the 100 GB soft
limit. **Removal** costs the features.

Removal was chosen.

## Decision

No model is fetched on demand, and the features that needed one are gone:

| Removed                                            | Model   |
| -------------------------------------------------- | ------- |
| Photo search by description, and find-similar      | CLIP    |
| Video moment search                                | CLIP    |
| The near-duplicate finder                          | CLIP    |
| Transcription, chapters, `.srt` export             | Whisper |
| Reading text out of pictures, and its search index | TrOCR   |

The apps stay. Photos is a picture browser with a name filter and stored thumbnails; Audio plays,
records and draws a waveform; Video plays, and still exports a frame or a section because both are
canvas and `MediaRecorder` rather than a model. The consent dialog no longer appears anywhere,
because nothing is left to consent to.

Document search survives untouched: it runs on MiniLM, which is in the registry's bundled tier and
was never behind a dialog.

## Consequences

- **The registry holds one model.** `ModelTask` and `InferenceTask` are single-member unions. That
  is not a placeholder for more; ADR 14 closed generation and this closes perception.
- **Thumbnails outlived the model that used to make them.** They were generated as a by-product of
  embedding a picture, because the image was decoded anyway. They are now made by a worker that
  does nothing else, since a grid decoding 4000-pixel originals is what makes a file manager
  stutter whether or not anything clever is happening elsewhere.
- **The two-host claim became a one-host claim.** Removing the on-demand models left one download:
  MiniLM, fetched silently from `huggingface.co` on first use. That was closed immediately
  afterwards by vendoring it — `tools/sync-model.mjs` fetches and digest-checks the weights at
  build time into `public/models/`, and `src/services/ai/runtime.ts` sets
  `allowRemoteModels: false` so a missing file is a loud 404 against our own origin rather than a
  silent fetch from someone else's. The page now contacts nothing but the origin serving it.
- **Four milestones of measured work are gone from the product.** ADRs 10, 12 and 13, and the
  matching sections of `docs/benchmarks/`, are kept rather than deleted: they record what was
  built, what it cost and what the measurements said, including two occasions where the benchmarks
  reversed a decision the plan had assumed. That record is the reason the work was worth doing;
  losing the feature does not make the finding untrue.
- **This is reversible and expensive to reverse.** The code is in the history, and restoring any
  one feature means restoring its service, its app surface and its model registry entry. Nothing
  here was designed to make that harder — but nothing pretends it is a flag to flip either.
