# 10. Model choices are tested against the runtime, not read off a table

Status: accepted (M2) · **retired** by [ADR 15](./0015-no-on-demand-models.md): the models it chose between were
removed. Kept because the method — test the candidates rather than trust the model card — decided
two things the plan had assumed, and because it is the record of what was measured.

## Context

M2 needed two new models: one to put images and sentences in the same vector space, and one to
turn speech into text. Both were chosen on paper during planning, by size and licence. Both
choices survived contact with the actual runtime badly, and in different ways.

## What happened

**Image search: MobileCLIP-S0 was rejected after testing.** It was the plan's default — 54 MB
against CLIP ViT-B/32's 150 MB, a third of the download. It loads, embeds, and returns results
that are _almost_ right: across six test queries the correct picture appeared in the top three
every time and first **zero** times. "A red keyboard" ranked a bar chart above the keyboard.

The likely cause is visible in its repository: `config.json` contains little more than
`model_type: clip` — no `projection_dim`, no `text_config`, and a `preprocessor_config.json`
missing the normalisation parameters. The image processor therefore falls back to defaults that do
not match how the model was trained, and slightly wrong preprocessing produces slightly wrong
embeddings, which is exactly what near-miss ranking looks like.

CLIP ViT-B/32, with a complete config, returned the correct picture first for **six of six**
queries. It is also MIT licensed rather than Apple ASCL.

**Transcription: the quantised Whisper decoder does not load at all.** Both the `q8` and `int8`
exports of `decoder_model_merged` fail to build a session on the current ONNX Runtime:

```
qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
```

fp32 works (113 MB) and fp16 works (57 MB). fp16 is used.

## Decision

- **CLIP ViT-B/32** is the image model, at 150 MB, because it is correct and MIT licensed.
  MobileCLIP-S0 stays in the registry as a documented alternative rather than being deleted — the
  comparison is the useful part.
- **Whisper tiny with a q8 encoder and an fp16 decoder**, 69 MB, because that is the smallest
  combination that loads.
- **Whisper moves from bundled to on-demand.** The plan had it bundled at M2; at 69 MB it would
  have taken the Tier-0 bundle to 91.7 MB against an 80 MB budget. More to the point, consent-
  gated download is simply better: someone who never opens the Audio app should not pay for it.
  Tier 0 is back to 22.6 MB, which is about 4,500 first-time visitors a month within the GitHub
  Pages bandwidth allowance rather than 1,100.

## Consequences

- Photo search costs a 150 MB download. That is a real cost, and it is why the download is asked
  for rather than assumed, shown with its size, and removable in Settings.
- Choosing a model by parameter count and licence is not enough. A model is a file format, a
  config, a preprocessing pipeline and a runtime, and any of those can be the thing that breaks.
  The check that mattered here took ten minutes: index eight pictures, run six queries, count how
  often the right one came first.
- Both failures were found by the Task Manager, which surfaced the ONNX error text that named the
  cause. Work you cannot see is work you cannot debug — that was the argument for building it in
  M1, and this is the return.
- Worth revisiting when either upstream repository publishes a better export: a quantised Whisper
  decoder would halve the download again, and a properly configured small CLIP would cut 100 MB.
