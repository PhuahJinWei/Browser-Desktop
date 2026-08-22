# 5. The language model is optional; non-LLM models are the foundation

Status: accepted (M0)

## Context

"AI" and "an LLM" get conflated. Almost everything this project wants — search photos by content,
find a document by meaning, transcribe audio, find visually similar images — runs on embedding,
vision and speech models that are 20–300 MB, deterministic, and fast on a laptop. The problems
that make an LLM awkward in a browser (gigabyte downloads, memory pressure, slow generation on
weak hardware, non-deterministic demos, hallucinated answers about the user's own files, prompt
injection once it can read files and call tools) belong to the LLM specifically.

## Decision

Build the system so that nothing requires a language model. Text generation is one optional,
pluggable service in the model registry, detected at runtime (Chrome Prompt API present, a model
downloaded, or one sideloaded). Present, it upgrades search into conversation. Absent, every
feature still works.

## Consequences

- The Assistant is a semantic search and command surface first, a chat interface second.
- A search result cannot hallucinate, which makes the demo reliable — the reason P5 says the first
  30 seconds never wait on a model.
- Low-end machines get a complete product rather than a degraded one.
- M5 stays genuinely optional: it is gated on M1–M3 being finished, and CI must pass with the
  plug-in absent.
