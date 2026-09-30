# 17. The desktop is customisable, and the customisation is a file

Status: accepted (M6). The list of what a setup carries is amended by
[ADR 22](./0022-one-palette-no-dark-mode.md): `theme` left it, `skin` and `classicCursors` took its
place.

## Context

A desktop that cannot be arranged is a screenshot. Icons had fixed positions in a CSS grid, the
wallpaper was one of four gradients, and none of it could leave the machine it was made on — which
is a strange gap in a project whose entire argument is that your data is yours and lives where you
can see it.

Three questions had to be answered together, because the answers constrain each other: where do
icon positions live, where does a wallpaper image come from, and what does "use my setup on my
other laptop" mean without a server.

## Decision

**Icon positions are grid cells, not pixels.** A pixel layout is wrong as soon as the window is
resized or the text size changes — icons drift under the taskbar, and the only repair is clamping,
which silently destroys the arrangement the user made. Cells survive resizing, keep icons aligned
with each other for free, and reduce "sort" and "reset" to assigning a sequence. Dragging one of
several selected icons moves the group; dropping onto an occupied cell takes the nearest free one.

**A wallpaper is a file you already have.** Choosing a picture imports it into the file system and
stores its node id — not a copy in localStorage, not a path outside the desktop, not a URL. That
keeps the rule the rest of the system follows: everything on screen points at something you own and
can open. It also means the wallpaper cannot appear before the file system is mounted, so the
gradient stays up until it can, and a deleted picture demotes itself back to a gradient and says so
rather than failing silently.

**A setup travels as a JSON file the user carries.** Theme, accent, text size, motion, wallpaper
choice and fit, icon positions, hidden icons, and the indexing and session preferences — plus,
optionally, the open windows and the wallpaper image itself as bytes. Exporting hands it to the
browser as a download; importing reads it back through a validator that checks every field against
the values it is allowed to have.

Two things are deliberately absent from that file:

- **Your files.** A setup is kilobytes and the file system is gigabytes. Exporting data is a
  different job with different ergonomics, and conflating them would make the small, useful thing
  slow enough that nobody uses it.
- **Installed apps.** Those are code. There is already exactly one path for installing an app —
  from a folder, an archive or a link, each time through the capability broker's prompts. A second
  path that installs whatever a settings file names would undo the first one, and it would arrive
  disguised as a preferences import.

## Consequences

- The import path is a parser for untrusted input, and is treated like every other parser here:
  unknown keys dropped, enums checked against their unions, numbers clamped, path separators
  stripped from the wallpaper's filename, the window list bounded. It has its own tests.
- A setup file is short enough to read. That is a feature and the reason it is JSON rather than an
  archive: the honest way to prove a local-first app is not hoarding anything about you is to hand
  you the whole of what it knows in a form you can open in a text editor.
- The wallpaper image is capped at 8 MB inside a setup file. Above that the export says so and
  leaves the picture behind rather than producing a file too large to move.
- Sync is still not on the table, and this is not a step towards it. A file the user copies is the
  whole feature.
