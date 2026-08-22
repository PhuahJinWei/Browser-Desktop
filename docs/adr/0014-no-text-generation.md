# 14. There is no text generation, and there will not be

Status: accepted (M4). Extends [ADR 5](./0005-llm-is-optional.md), which made the language model
optional; this removes the option.

## Context

ADR 5 built the system so that nothing requires a language model, and put text generation in M5 as
an optional plug-in: a conversational search surface, summaries, a tool-calling agent, generated
apps. M1–M4 then shipped without it, and the question at the end of M4 was whether to build it.

The answer is no, and the reason is not caution. It is that four milestones of evidence say the
plug-in would subtract from this project rather than add to it.

**Nothing wanted it.** Every feature that looked like it might need generation turned out to be
retrieval. The plan's own headline aspiration — _"find the video where I showed my red keyboard and
extract that 10-second section"_ — reads like a question for an assistant and is answered by CLIP
embeddings, a score floor and a grouping rule, with a timestamp and a clip at the end of it. Photo
search, transcription, chaptering, duplicate detection and OCR went the same way. The one place a
model does produce text, OCR, is transcription of pixels that already say what they say.

**It would be the least reliable part of the demo.** Every model here is 22–160 MB, deterministic,
and finishes in milliseconds to seconds. A small language model is 0.5–2.5 GB, is the one workload
where WASM cannot rescue a machine without WebGPU, and answers differently every time. P5 in the plan asked
that the first thirty seconds never wait on a download or an LLM; a tier built on a model that big
turns that principle into a rule the product spends its time working around.

**A search result cannot hallucinate.** That was already in ADR 5 as a consequence. Having built the
thing, it reads less like a limitation and more like the point: everything this desktop tells you
about your files is a pointer into a file, at an offset or a timestamp, that you can open and check.
Adding a layer that paraphrases those files would make the one genuinely trustworthy property of the
system conditional on a model's mood.

**And it is the commodity part.** A chat box over local documents is the most-built thing of 2026.
The parts of this project worth showing — cross-origin isolation from a service worker on a host
that cannot send headers, a capability-brokered app sandbox with an opaque origin, backend choices
that the benchmarks reversed twice — are all in the other direction.

## Decision

Tabula does not generate text. The M5 tier is removed from the roadmap rather than deferred, the
`InferenceTask` union loses `generation`, and the SDK's `os.ai.*` surface stays what it is: embed
and search.

## Consequences

- **No feature is removed, because none was built.** This is a scope decision, not a deletion: the
  only code change is one member of a type union that nothing referenced.
- **The two-host rule gets easier to keep**, not harder. Model weights already come from
  `huggingface.co`; a gigabyte-scale model would have made that the dominant fact about the project
  rather than a footnote.
- **The Chrome Prompt API is still probed and still reported** in About, because the report is
  honest about what the _machine_ can do. The card says plainly that Tabula does not use it. A
  capability probe that hid capabilities would be a worse probe.
- **[ADR 4](./0004-hybrid-app-model.md) loses one of its stated benefits.** It chose the hybrid app
  model partly to keep the door open for LLM-generated apps without re-architecting. That door is
  now closed on purpose. The decision stands on its remaining reasons — a real permission boundary
  and a single readable file per app — which were always the load-bearing ones.
- **The elevator description changes.** Not "an AI desktop with an optional LLM" but a desktop whose
  system services happen to include perception models: it sees, hears and reads, and it does not
  talk. That is a smaller claim and a truer one.
- Reversing this would mean a new ADR and roughly the work M5 always described. Nothing here makes
  that harder; it simply stops the roadmap promising it.
