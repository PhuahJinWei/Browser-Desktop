# 12. Video moments live in the image index, sampled through a `<video>` element

Status: accepted (M4)

## Context

M4 set out to answer "where in this video is the thing I remember?" — a question filenames,
timestamps and scrubbing all answer badly. Three decisions had to be made: how to get frames out
of a video, where the resulting vectors live, and how a run of matching frames becomes an answer.

## Decision 1: `<video>` seeking, not WebCodecs

The plan named WebCodecs. WebCodecs decodes _encoded chunks_ — it does not demux, so feeding it an
MP4 or WebM means writing or shipping a container parser first. A `<video>` element already
contains both a demuxer and a decoder; seeking it and drawing to a canvas gets the same pixels
with none of that, and works in every browser rather than the subset with WebCodecs.

The expected cost was speed: seeking is slower than decoding a stream linearly. Measured, it is
not the cost at all. Sampling a frame takes **40 ms**; embedding it takes **257 ms**. The decoder
is six times cheaper than the model it feeds, so the argument for a demuxer is arithmetic that
does not survive contact with the profiler.

The real constraint is that `<video>` is a DOM element, so sampling runs on the main thread. Each
frame crosses to the worker as a few kilobytes of WebP, transferred rather than copied, and the
expensive part stays off the main thread.

## Decision 2: moments live in the image index

A video frame is an image, and CLIP does not distinguish them. Giving moments their own index
would have duplicated the search, the persistence, the model lifecycle and the reconciliation to
express a distinction the model does not make. A moment is an `ImageRecord` that additionally
carries the time it was taken from and the id of the video it belongs to.

The consequence to manage is that Photos must not fill with video frames: one indexed video can
outnumber every photograph. Photo search over-fetches and drops anything with a time, and video
search does the reverse.

## Decision 3: a moment is a run of frames, not a frame

Frames two seconds apart in one shot are nearly identical, so a query matches six of them and the
results are six rows of the same thing — while a different video showing the same object never
makes the cut. Consecutive matching frames are grouped into a moment with a start, an end and its
best frame. That is both the useful answer and the reason a section can be exported: it has
boundaries.

## What measurement changed

**Frames are letterboxed into a square before embedding.** CLIP's processor resizes the shortest
edge to 224 and centre-crops, so a widescreen frame loses about 44% of its width before the model
sees it. A keyboard spanning the frame was cropped into an unrecognisable red band and lost, for
the query "a red keyboard", to a cat's face centred in an unrelated scene. Letterboxing makes the
crop a no-op.

**There is an absolute score floor, at 0.25.** Without one, every frame of every video came back
for every query, ranked by noise, and the whole video was reported as a single moment. The number
is not chosen for feel: against the sample pictures, true answers score 0.27–0.32 and a query with
no answer tops out at 0.23–0.24, so 0.25 sits in the gap. See `docs/benchmarks/`.

**The floor exposed a latent bug in `VectorIndex.search`.** `minScore` was consulted only once the
result list was full, so a caller asking for more hits than the index holds got everything back
unfiltered. Latent since M1, hidden because document and photo search apply thresholds of their
own afterwards. It is now an absolute floor, with tests.

**The sample video is made of the sample pictures.** A first version drew eight scenes of its own
and the model ranked them at random — 0.21 for a hand-drawn keyboard against 0.24 for a cat, on
the query "a red keyboard". The same query against the sample photographs scores 0.32 and 0.23.
The fixture was the weakest part of the measurement, so the video is now those pictures, filmed.

## Consequences

- Indexing a video is explicit, not automatic. A photograph costs one model pass; a five-minute
  video costs 150. Spending that on every video someone imports, unasked, is not something an
  operating system should do.
- Resolution is the sampling interval: at two seconds, a moment is located to within about a
  second. Scene-cut detection would need every frame decoded, which is the cost this design exists
  to avoid.
- Clip export re-encodes in real time by playing the section and recording the element's stream.
  A lossless cut would need a muxer per container. Re-encoding has one genuine advantage: the
  section starts exactly where it was asked to, not at the nearest keyframe.
- The sample video is recorded in real time — `MediaRecorder` stamps frames by the wall clock —
  so making it takes its running time. The canvas is shown while it records, which makes the wait
  the demonstration rather than an obstacle to it.
