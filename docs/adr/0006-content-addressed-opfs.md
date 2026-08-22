# 6. Content-addressed blobs in OPFS, metadata in IndexedDB

Status: accepted (M0), implemented in M1

## Context

The desktop needs a file system: a tree with names, folders, trash and undo, over content that
may be gigabytes. OPFS is the only fast, large, private store in a browser, but it is a flat-ish
file API, not a database. IndexedDB is a database but slow for large binary payloads.

## Decision

Split them. Content lives in OPFS at `/blobs/<sha256>`, addressed by hash. Metadata — the tree,
names, parents, mime types, index state — lives in IndexedDB.

Derived data (thumbnails, extracted text, transcripts) lives at `/derived/<hash>/…`, keyed by the
same hash.

## Consequences

- Rename, move and copy become metadata-only operations. Duplicate files cost nothing twice.
- Derived data survives a rename for free, because it is keyed by content rather than path.
- Deleting means dropping blobs whose reference count reaches zero, which is real work the trash
  implementation has to get right.
- Hashing every import costs CPU; it happens in the file-IO worker, streamed.
- Measured on the reference machine: OPFS sync access handles reach ~591 MB/s write and ~781 MB/s
  read, so storage is not the bottleneck. Note they are worker-only.
