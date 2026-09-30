# Changelog

## [Unreleased] — a default desktop

Removed

- **Watch** and **Portfolio**. The desktop now ships what a fresh desktop ships, and neither was
  that: Watch was the only exception to the one-host rule, and Portfolio was a page about the
  author ([ADR 23](./docs/adr/0023-a-default-desktop.md)). With them go the YouTube origin in
  `frame-src`, the consent setting, the title-bar chip that announced the frame, the committed
  stills and `npm run sync:stills`. The browser now enforces the one-host claim in full.
- A saved session or setup file that names either app restores without those windows, rather than
  opening empty frames.

## [Unreleased] — a desktop that looks its age

Added

- **The classic skin became a period reproduction rather than a palette.** A Start menu with its
  gradient banner, a Start button, menus that highlight edge to edge, scrollbars with arrow buttons
  at both ends, tabs that join the panel below them, drop-downs with the button welded to the
  field, caption buttons at the era's 16x14, the era's font asked for by name, and the focus
  rectangle back inside the button where it belongs. The title-bar icon opens the system menu and
  closes the window on a double click, which is behaviour rather than appearance.
- It stays an **homage rather than a copy**: no logo, no wordmark, no copied artwork, no font file,
  and the Start menu's banner reads _Tabula_
  ([ADR 21](./docs/adr/0021-a-second-skin-and-why-it-is-the-default.md)).
- The skin now reaches **sandboxed apps** too, carried in the boot message beside the theme, so the
  bundled sample apps follow the desktop without knowing the skin exists.
- **Watch opens onto a homepage instead of an empty paste box.** Seventeen short films from the
  Blender Foundation's own channels, laid out as a video index of the era — square sunken posters,
  navy underlined titles, a running time in the corner. The page is part of the build rather than a
  feed in the usual sense: nothing on it is fetched, ranked, personalised or refreshed, so browsing
  the whole thing costs zero requests, and the first contact with anyone still happens on the click
  that starts a film, behind the same consent card as a pasted link. It turns ADR 20's first
  constraint from a sentence in an empty window into something a visitor can check for themselves
  against the Task Manager's network log — and then watch move.
- **Every film shows a real frame from itself, and none of them is hotlinked.** The stills are
  committed to the repository as 480x270 WebP — 313 kB for all seventeen — and served from this
  origin like any other asset. `npm run sync:stills` fetches and converts them once on a
  developer's machine; the build never reaches the network, and neither does anybody's browser.
  A thumbnail hotlinked from Google's image host would fire the moment the window opened, which
  [ADR 20](./docs/adr/0020-one-frame-you-asked-for.md) rules out by name — but that rule was always
  about requests rather than about images, and this is the shape that keeps it: the grid has real
  pictures in it and still asks Google for nothing. Redistributing a frame is possible at all
  because the films are CC-BY, and the attribution that asks for sits under the grid. A film
  without a still falls back to a poster drawn from its video id, so a future addition that forgets
  one costs a plain tile rather than a broken image.
- **Still no view counts and no ratings.** The era's page had both and this desktop cannot know
  either, so inventing them to make a grid look busy would be a claim about somebody else's work.
  What is shown — title, channel, running time, year — was checked against YouTube's own oEmbed
  endpoint when the list was compiled rather than written to look plausible.
- It stays **Watch, not YouTube**: no wordmark, no logo, no borrowed artwork, and the form of a
  period video index rather than a reproduction of anyone's page. The same line the classic skin
  holds, and worth more here than anywhere else, because this is the one app that names another
  company.
- **The loading screen became a power-on self test.** Black screen, system monospace, the CGA
  sixteen, one line per step with leader dots running out to a status column. The form is the
  argument: a POST screen reports what the firmware actually found, which is what this boot
  sequence already had to say. It reports the same four steps as before and invents none, and it
  does not pad the wait so it can be admired — on a warm cache it is gone in a blink. Firmware runs
  before the operating system has a theme, so it ignores the skin setting on purpose. Homage, not
  copy, on the same terms as the skin: no logo, no wordmark, no font file.
- **Cut, Copy and Paste for files and folders** — on Files' toolbar, in its Edit menu, on its
  right-click menus, on Ctrl+X, Ctrl+C and Ctrl+V, and as Paste on the desktop. The toolbar group
  sits between Import and Rename, the order the era's Explorer used, with scissors and clipboard
  glyphs drawn to the same 24-unit stroke grid as the rest of the icon set. It is the desktop's own clipboard rather
  than the system's, because a web page can hand another program text or a picture but never a file.
  A copy costs one small record, not a second set of bytes: blobs are content-addressed and
  reference-counted, so a copy shares its original's hash, and deleting either leaves the bytes for
  the other — on the real file system, permanently deleting an original freed nothing until its last
  copy went too. Copies are indexed like any new file, including every file inside a copied folder,
  which the indexer would otherwise never have been told about. A cut marks rather than moves, as it
  always did: the icon ghosts until it is pasted somewhere, Esc abandons it, and nothing has happened
  to the files in the meantime. Paste is greyed while there is nothing to paste and live the moment
  there is — a real feature in its off state rather than a row that is permanently grey. The desktop
  holds app shortcuts rather than files, so a paste there lands in Home and Files opens on it.
- **Undo stays out**, deliberately. It would need a journal of inverse operations across every file
  action, and the Recycle Bin already covers most of what it would be for.

Fixed

- **The Recycle Bin's right-click menu offered New folder and Import.** Files and the bin are one
  component, and the menu for empty space was the same in both — so in the bin those two created and
  imported into a folder the bin was not showing, out of sight of whoever asked. The bin now offers
  what it can act on: Empty Recycle Bin, behind the same confirmation as the File menu's.
- **A menu whose middle group emptied out lost the divider around it altogether.** Conditional rows
  leave their separators behind, and the rule that tidied them dropped _every_ separator touching
  another — both of a pair, not the duplicate — so the groups either side ran together. It now
  collapses a run to one and trims the ends, which is what put a divider back between Empty Recycle
  Bin and Select all. Every other menu came out the same.
- **Asking Files to open with something selected never selected it.** The desktop's New › Folder,
  Notepad's link to its folder, "Show in folder" and a system command all open Files with a
  `selectId`, and every one arrived with nothing highlighted: the effect that clears the selection
  when the folder changes also runs on mount, and cleared the requested one before it was ever drawn.
  It now resets only when the folder actually changes — compared against what was last shown rather
  than skipped once with a flag, because development builds run mount effects twice and a skip-once
  flag is spent by the first run.
- **Every tooltip in Files' Icons view named the page's own address.** Tiles were never given the
  folder a binned item came from, and a bare `origin` in that component does not fail to compile —
  it resolves to `window.origin` — so each one read "From http://…". Tiles now get the same origin
  rows do.
- **Sandboxed apps have never been styled — since M3.** A srcdoc document inherits its embedder's
  CSP, the desktop's `style-src` is `'self'` with no `'unsafe-inline'`, and the runner's stylesheet
  was refused every time. What every sandboxed app was actually wearing was the browser's default
  controls, which looks enough like a plain design to pass. The theme in the boot message had
  therefore never landed either: its variables live in the blocked stylesheet, so switching the
  desktop to dark left every sandboxed app light. Now allowed by hash, the way the bootstrap script
  already was — one stylesheet, pinned to the build, and the policy no weaker than before.
- **The Scratchpad sample app was a worse Notes wearing a demo's job.** It shipped a textarea and
  a Save button next to a desktop that already has Notes, and buried its actual purpose — proving
  that a sandboxed app holding `fs:read` and `fs:write` still cannot read a byte outside its own
  folder — in the last button on the page. It is now **Fence**: the refusal leads the window, the
  notes sit underneath it as evidence that the permission does work in the direction it was
  granted, and the name no longer promises a notepad. The id stays `tabula.scratchpad`, because an
  id is an identity and a name is a label, and changing it would have stranded the permissions
  already granted to it.
- **A bundled app could never be corrected after its first install.** `installSampleApps` installed
  only what was missing, so every edit to the three reference apps reached new desktops and no
  existing one. It now compares the stored source against the source in the file and reinstalls
  when they differ, which is what carried the rename above onto desktops that already had the old
  app. `installApp` writes by id, so a replaced app keeps its permissions and its folder.
- **The reference app taught `os.ui.setTitle` wrong.** The host appends ` — <app name>` to every
  title so a window cannot impersonate a system one, so calling `setTitle` with the app's own name
  could only ever render as "Scratchpad — Scratchpad". Fence now titles itself after the note it
  has open, which is what the suffix is designed to sit behind. Find still does the older thing.
- **Menus can nest.** A row with `items` instead of `run` opens a submenu rather than doing
  something, and because a submenu is the same object as the menu that raised it, the panel renders
  itself recursively — same rows, same keyboard, same skin, one component. Each level owns only
  which of its own children is open, so closing one never reaches past itself. Hovering a row
  settles what is open at that level, which is what stops a submenu hanging over the rows below it
  once the pointer has moved on; the arrow keys walk in and out of levels, Escape closes the
  submenu before it closes the menu, and the child flips to the other side or lifts itself when it
  would otherwise leave the screen.
- **A menu row can carry an icon**, in the same gutter the check mark already used — the gutter is
  there whether or not anything is in it, so a menu mixing the two still has every label starting in
  the same place. The desktop menu tried it and does not keep it: at that size the glyphs read as
  decoration competing with the words rather than as help finding them.
- **The desktop menu is grouped the way a desktop menu has been for thirty years**: what to do with
  the icons, then what to make, then where to change how the place looks. It still does not carry
  Paste or Undo — there is no desktop clipboard and no undo stack to put behind them, and a row that
  is permanently greyed out is a picture of a feature rather than a feature.
- **Refresh does the honest version of the gesture.** This desktop renders from live state, so there
  is never a stale frame sitting there waiting to be redrawn the way there was on a machine that
  painted its icons once and then remembered them — which makes Refresh easy to fake and worth not
  faking. It re-reads the installed apps from storage, which is what the icons are actually drawn
  from, and remounts the icon layer so the re-read is visible and the selection goes with it. Where
  nothing has changed, which is the usual case, it is a real re-read that finds the same answer
  followed by a repaint. That is all Refresh has ever been anywhere else either.
- **Every submenu in the classic skin opened as an empty grey stub.** A panel positioned at
  `left: 100%` has exactly nothing left of its containing block to fill, so shrink-to-fit resolved
  to the _minimum_ content width — a box a few characters wide with every label ellipsised away to
  nothing. The modern skin hid it behind the 196px floor on `.menu`; classic sets no floor, which
  is the whole reason it showed up there and only there. Sized to `max-content` now, so the width
  comes from the rows rather than from the gap.
- **The system tray was a row of separate controls rather than one tray.** Every status item carried
  its own pill and the clock its own box, in both skins — and worse in classic, where those sat
  inside the tray's own sunken well and made three nested boxes where the machine being imitated had
  exactly one. The tray is now a single panel with its contents lying flat on it, and because that
  grouping is shape rather than decoration it lives in the shared layer: the skins differ only in
  how the panel's edge is drawn and what its clock is lettered in — a soft bordered panel with
  monospaced tabular figures in modern, a sunken bevel and the era's bitmap sans in classic.
- `box-shadow: none` on those contents is load-bearing rather than tidiness. Classic gives every
  `button` the era's raised bevel from a `:where()` rule, which carries no specificity and so loses
  to any class rule — but only for the properties that class rule actually declares. Leaving the
  shadow undeclared left the bell wearing a raised bevel while everything else about it had gone
  flat, so the shared rule now states it and the shape is true by construction in both skins.
- A tray icon had no hover state in 1995 and does not get one back, but it now has no chrome of its
  own to say it is a button either, so classic keeps the era's dotted focus rectangle and its
  one-pixel nudge on press. Modern answers the same problem in its own idiom, with a tint mixed from
  the text colour so it reads the same on a light or a dark bar.
- **A maximised Settings window left every control in the top-left corner.** The content column was
  capped at 640px and never centred, so a 1434px window stranded 770px of empty grey down one side
  — 24 pixels of margin on the left, 770 on the right. It centres now, and at the width the fields
  were already designed for: widening the column would only have widened the gap between each
  label and the control opposite it.
- **`max-width` was doing two unrelated jobs with nothing to tell them apart.** A text measure caps
  line length inside a flow that is already in the right place and must _not_ centre; a layout
  column is content narrower than the window around it and must. The two are identical in a diff,
  and About and Settings had each answered the question by hand — About correctly, Settings not.
  The layout kind now exists once, as `column` in `src/shell/layout.module.css`, with the width
  passed in through `--column-measure` and the centring not left to whoever writes the next app.
  Both existing columns compose it. An audit of all thirteen apps at full width found no third
  instance, and the one remaining capped container — the Links header, at 60ch — is the other kind
  and correctly stays put.
- **Resetting did not finish resetting.** Both buttons under Reset tore state down without
  rebuilding it, so the desktop carried on holding what it had: windows open on erased files, the
  icon layout still arranged, the sample corpus not put back — `sampleDataLoaded: false` only means
  something to a boot that has not happened yet. Both now restart the desktop, which is what makes
  the reset take, and the machine coming back up is the confirmation the toast used to give. The
  restart has to be immediate rather than after a message: the session is saved on a 400ms
  debounce, and anything slower lets that timer write the session back over the one just cleared.
- **"Reset settings" quietly wrote a second copy of every sample file.** It cleared
  `sampleDataLoaded`, and boot seeds from that flag without ever looking at the disk — so the next
  start laid "Welcome to Tabula (2).md" and thirteen more down beside the originals. The flag
  records what is on disk rather than anything the user prefers, so it is no longer reset with the
  preferences. Erasing all data still clears it, and is still right to: there the files really are
  gone.
- **"Erase all data" left the session pointing at the files it had erased.** It never cleared it,
  so a restart faithfully reopened windows onto documents that no longer existed.
- **A finger dragged across the desktop drew a selection rectangle.** Touch has no gesture that
  means "sweep a region" without also meaning "scroll", and the surface does not claim the drag
  with `touch-action`, so the band was being painted over a page panning underneath it by a gesture
  nobody intended as a selection. Touch no longer starts one. A tap still clears the selection, and
  a stylus still sweeps — it is precise, and its drag is not also a scroll. The test is on the
  pointer event rather than on the coarse-pointer media query, which reports the _primary_ pointer:
  a touchscreen laptop reports fine, and would have kept the bug.
- **The boot splash used to paint before its own styles.** They lived in a CSS module, and Vite
  serves those through JavaScript in development, so the opening frame was a bare list — bullets
  showing, rows overlapping — until the bundle caught up. The splash is static markup in
  `index.html` now with a render-blocking stylesheet beside it, which cannot arrive late by
  construction. React no longer renders the boot screen at all; it only reports into it.
- Two containers in About and Portfolio had been given the white list-view treatment without being
  list views, which boxed each row separately and clipped labels that ran past.
- A label reading `SharedArrayBuffer` in an eleven-character column was being cut mid-word in both
  skins. It wraps now.

## [Unreleased] — Watch, the one frame you asked for

Added

- **Watch** — a YouTube player in a window, and deliberately not a browser. Paste a link and it
  plays; the sidebar keeps Saved and Recent; the row under the player offers Save, Copy link and
  Open on YouTube. Playlists play through with the player's own next and previous.
- This is **the one place in the desktop that contacts another company's server**, so the design is
  arranged around making that visible. Nothing is fetched until a link is pasted; a consent card
  stands in front of the first video with Cancel focused; an amber chip in the title bar names the
  host for exactly as long as a frame is loaded and is driven by the frame's existence, so no path
  can leave it behind. No thumbnails — each would be a request fired on open, before anyone chose
  anything. No `iframe_api` script, so `script-src` is unchanged and nothing of Google's runs in
  this origin; title and channel come over the embed's own `postMessage`.
- **`connect-src` did not move.** Only `frame-src` gained an origin: the desktop still cannot talk
  to YouTube, it can only show a frame that does. That difference is what the claim rests on, and
  it is now "nothing, except the one thing you just asked for, and here it is in the network panel
  while you watch" ([ADR 20](./docs/adr/0020-one-frame-you-asked-for.md)).
- Saved and Recent live in **`Videos/Watched.md`**, an ordinary Markdown file rather than a store of
  its own — visible in Files, searchable by meaning with everything else, deletable like anything
  else, carried by the setup export for free. Parsing is lenient: an unreadable line is skipped
  rather than costing the file, and a note written above the lists survives the next save.
- The consent is withdrawn in **Settings**, not inside Watch, because a permission you can only
  revoke from the thing holding it is not really revocable.

Known limits

- **Chromium only.** The frame needs `credentialless`, which Firefox and Safari have not shipped.
  Elsewhere the app names the missing capability and offers the outward link; Saved and Recent
  still work.
- **Always logged out**, by construction of the frame — a privacy property as much as a limitation.
- **The monitor sees the frame, not inside it.** Our one request appears in Resource Timing; the
  dozens the player makes within the frame cannot, and the record says so rather than implying
  otherwise.
- **The gate was measured and passed.** In a real Chrome with `crossOriginIsolated: true`, the
  credentialless frame reached `PLAYING` and the control frame — the same frame minus the attribute
  — was refused by COEP. The control is the result as much as the player is: it shows the attribute
  is what admits the frame rather than the frame having been allowed all along. Harness kept at
  `docs/spikes/m7-credentialless-embed.html`; details in §13 of the plan.

## [Unreleased] — a second skin

Added

- **A Classic skin**, in Settings → Appearance. A 1990s desktop: square corners, two-tone bevels,
  one grey, a navy title bar and a teal ground. Era-inspired rather than an impersonation — no
  vendor's logos, wordmarks or icons, and the font stack asks for faces the machine already has
  rather than downloading one, so the one-host rule is untouched.
- It is a fourth token axis (`data-skin`) beside theme, accent and wallpaper. **Classic is the
  default look**; Modern is one switch away and is unchanged by any of it. Classic supplies its own
  complete palette, so the theme and accent controls are disabled while it is on and say why, and
  the wallpapers become flat background colours — which is what the era's own Display Properties
  offered, and keeps the control doing something.
- **List views are a white well in a grey frame**, the way the era's file manager drew them: the
  toolbar and status bar are the chrome, the files sit on sunken paper between them. Selection is a
  solid navy fill with white text rather than a tint, which is both the period answer and, at 16:1,
  the highest-contrast state in either skin; the keyboard cursor stays a separate dotted rectangle,
  because a row can be focused without being selected. Files, Photos, Notes, Audio, Video, Search,
  Task Manager and the command palette.
- **Pixel-art desktop icons.** The line icons are the modern set and nothing tokens can do makes
  a 1.75px round-capped white stroke look like 1995 — the artwork was the tell. Classic now draws
  32×32 bitmaps in a sixteen-colour palette, stored as text (one character per pixel,
  `pixelIcons.ts`) and rasterised to crisp SVG at render time: no image files, no new hosts, and
  the art is reviewable in a diff. Original drawings of generic objects in the period idiom.
  Selection dithers the icon's own pixels navy, as the era did, rather than only the label.
- **A 16×16 set for the chrome**, drawn separately rather than scaled: title bars, the taskbar
  (task buttons, launcher, search and the status chips) and the launcher menu. Halving a bitmap
  throws away the pixel it was placed on, so the era shipped two drawings per icon and so does
  this; `AppIcon` picks the grid and snaps the box to a whole multiple of it, because a 16-pixel
  drawing shown at 15px is resampled and the crispness is the whole point. The launcher also drops
  its rounded icon tile, which is a modern affordance that reads as a stray box in one grey.
- **Legible window controls.** Minimise, maximise, restore and close are pixel glyphs under
  Classic — one box-shadow per pixel, crisp by construction. The line icons rendered at under a
  pixel wide inside the 18×16 buttons and were close to invisible.

Fixed

- **Hover no longer eats the selection.** A rule like `.row:hover` is one pseudo-class more
  specific than `.rowSelected`, so moving the pointer over a selected row repainted it as merely
  hovered — the selection vanished under the cursor that was pointing at it, and came back when you
  moved away. It affected both skins and predates them: Files, Photos, Notes, Audio, Video, the
  Task Manager tabs, the Settings segments, the Files view toggle and the taskbar, where hovering a
  latched button flattened its dither. Hover states are now written `:hover:not(.theSelectedClass)`
  so the two cannot compete.
- The current line in Audio's transcript now inverts as its own comment claimed, instead of taking
  a grey one shade off the hover colour.

Two deliberate departures from the period, both because inaccessible detail is not authenticity
worth shipping: focus stays a visible dotted outline rather than the near-invisible original, and
the inactive title bar is two shades darker than the era's `#808080` — at the original grey its
text measured 2.9:1, the one place the palette failed WCAG. It is 5.1:1 now.

## [Unreleased] — M6, making it yours

Written after the fact: M6 shipped across two commits without a section here, and a changelog with
a hole in it is worse than one that admits the hole late.

Added

- **The desktop became arrangeable.** Icons select on one click and open on two
  ([ADR 16](./docs/adr/0016-one-click-selects-two-clicks-open.md)), multi-select, drag to arrange,
  positions stored as grid cells so an arrangement survives a reload and a resize.
- **Every surface answers a right-click**, reachable by `Shift+F10` as well as the mouse, with
  editable and selected text keeping the browser's own menu — cut, paste, spell-check and look-up
  are things a page cannot reproduce, and replacing them would remove function in exchange for
  consistency nobody asked for. A file's menu is written once and used by seven apps, so a file
  behaves the same wherever it is shown.
- **Any picture in your files can be the wallpaper**, with a fit setting.
- **The whole arrangement is a file you can carry** — exported and imported as JSON, validated on
  the way in so a hand-edited file cannot put an invalid value into the settings store
  ([ADR 17](./docs/adr/0017-customisation-is-a-file.md)).
- **A stated limited mode below 720px** rather than a broken one discovered
  ([ADR 18](./docs/adr/0018-mobile-is-a-visit-not-a-target.md)).
- **Portfolio** — the author's other work, handed to a real browser tab. Nothing is fetched, not
  even a favicon, so the network log stays empty while you use it. This is the answer to "put a
  browser in the desktop", and the reasoning for the answer being no is
  [ADR 19](./docs/adr/0019-no-browser-inside-the-browser.md).

## [Unreleased] — one host

Changed

- **The embedding model ships with the build.** It was fetched from `huggingface.co` on first use
  — silently, but still a second host and still a 23 MB wait before the first search worked, and
  nothing at all on a first visit without a network. `npm run sync:weights` now fetches it once at
  release time, checks every file against the SHA-256 digests in `models.json`, and writes it into
  `public/models/`; the runtime is set to `allowRemoteModels: false` so a missing file is a loud
  404 against our own origin rather than a quiet fetch from someone else's. **This page now
  contacts exactly one host: the origin serving it.**
- Verification moved from runtime to build time, so the download manager, the progress jobs and the
  consent dialog are gone — there is nothing left to download or agree to. Settings now states what
  ships instead of offering to fetch it.
- **Semantic search works offline** — verified in Chrome 151 with the server stopped: the desktop
  boots, an uncached request returns the service worker's own 503, and a query sharing no words
  with any document still returns results labelled "meaning". Two things had to change for that.
  A `navigator.onLine` guard skipped the model and returned keyword-only results, which was right
  when the weights lived on another host and wrong once they were local. And the **ONNX runtime was
  never cached at all**: the precache filter is `js|css|html`, so `runtime/*.wasm` 404'd offline
  and no model could run whatever else was available. The service worker now caches the runtime and
  the weights on first use, in caches keyed by the onnxruntime version and by a digest of the model
  digests — so upgrading either invalidates its own cache, and shipping a CSS change costs nobody a
  36 MB re-download.

## [Unreleased] — nothing to download

Removed

- **Every on-demand model, and the features that needed one.** Photo search by description and
  find-similar, video moment search, the near-duplicate finder, transcription with chapters and
  `.srt` export, and reading text out of pictures. With them go CLIP (150 MB), Whisper tiny
  (69 MB) and TrOCR (66 MB), and the consent dialog they appeared behind — there is nothing left to
  consent to. Reasoning, and what it cost, in [ADR 15](./docs/adr/0015-no-on-demand-models.md).

Kept

- **The apps.** Photos is a picture browser with a name filter, a detail pane and thumbnails still
  generated on this device. Audio plays, records and draws a waveform. Video plays, and still saves
  the frame you are looking at or cuts the section you are watching into its own file — both are
  canvas and `MediaRecorder`, and never needed a model.
- **Semantic document search**, unchanged. It runs on the bundled 23 MB embedding model, was never
  behind a dialog, and is still hybrid semantic + keyword with snippets and highlights.
- **The measurements.** ADRs 10, 12 and 13 and their benchmark sections are retired rather than
  deleted. They record what was built and what it measured — including the two occasions where a
  benchmark reversed a decision the plan had assumed — and losing the feature does not make the
  finding untrue.

## [Unreleased] — M4, more senses

Added

- **Video moment search.** Describe something you remember seeing and get the section of the video
  it is in — a start, an end, and a jump straight to it. Frames are sampled every two seconds and
  embedded with the same CLIP model Photos uses, so a moment and a photograph live in one index.
- **Video** app: browse videos, index one on request, play just the matching section, and see how
  sure the model was and how many frames agree.
- **Save a frame** as a PNG, or **export the section** as its own video file, both beside the
  original.
- **A sample video the desktop records for itself** — eight of the sample pictures, filmed at
  512×512 over 32 seconds, drawn and encoded on the device with nothing downloaded. You watch it
  being drawn, then search it.
- **Near-duplicate finder** in Photos. Groups pictures that are the same picture — a re-save, a
  crop, a frame exported from a video — and offers to keep the first and trash the rest together.
  Two deliberate copies now ship in the sample set so there is something to find.
- **Reading text out of pictures.** A scanned page had no text to extract and so could not be
  searched; now a recognition model reads it on the device and the words go into the ordinary
  document index, where they turn up in Search with a snippet like any other file. Available from
  both Photos and the Viewer, and a sample scanned delivery note ships so there is a page to read.

Verified

- Ten queries against the sample video: seven land exactly on the right scene, one lands inside
  it, and two queries with no answer in the video correctly return nothing. Timings, scores and
  the one weak case are in `docs/benchmarks/`.
- 4.7 s to make 32 seconds of video searchable, of which the model is 4.1 s and decoding is 0.6 s.
- Duplicate detection separates cleanly: copies score 0.95–0.98 and no two different pictures in
  the sample set exceed 0.79, so the 0.92 threshold sits in an empty band. The all-pairs scan
  skips 99.6% of full comparisons using an exact bound — 6.1× faster over 5,000 vectors, with
  identical results.
- The sample scanned page reads with **no character errors at all** (0 of 270, case-insensitive),
  all ten lines found and all ten read exactly, in 3.1 seconds.

Changed

- **The optional LLM tier is removed from the roadmap**, not deferred. M5 planned conversational
  search, summaries, a tool-calling agent and generated apps; it was never started, and four
  milestones of features turned out to be retrieval problems rather than generation ones — the
  headline "find the video where I showed my red keyboard" included. Nothing shipped is lost: the
  only source change was deleting an unused member of a type union. Reasoning in ADR 14; ADR 5,
  which made the language model optional, is extended rather than reversed.
- **Text recognition runs on the CPU, not the GPU**, because that is what the measurement said:
  3.1 s against 18.4 s for the same page, and more accurate with it. TrOCR's decoder emits about a
  dozen tokens per line, and a dozen tiny sequential dispatches cost more to launch than to
  compute. `preferredBackend` now puts `text-recognition` alongside `text-embedding` on the
  WASM side — two of five inference tasks in this project, both found by measuring.

Fixed

- **`VectorIndex.search` ignored its `minScore` floor** whenever the index held fewer vectors
  than the requested limit — it was only consulted once the result list was full. Latent since M1,
  hidden by the thresholds document and photo search apply afterwards. Now an absolute floor, with
  tests.
- The index could be saved before it had been restored, writing an empty snapshot over a good one
  if a background job finished first. Writes now wait for a restore to have been attempted.
- **Frames exported from a video were the last frame, not the one asked for.** Probing a
  `MediaRecorder` file for its duration leaves the element at the end, and its `seeked` event was
  still in flight when the real seek began — so the real seek caught the stale event and reported
  success without moving.
- Thumbnails kept showing the old picture after a file was overwritten: object URLs were pooled by
  file id and never invalidated.
- **Storage is now asked to be durable at boot.** An origin's storage is "best-effort" by
  default: the browser may clear it when a disk gets tight. This desktop holds the only copy of
  everything imported into it, so it calls `navigator.storage.persist()` once per session — not
  awaited, because Firefox answers by prompting and a desktop should not stall on a storage dialog.
  The browser decides, and on a site it has not seen before it usually says no; About reports
  whichever answer it gave rather than the one probed before the request went out.
- A file whose stored bytes were missing rejected with the platform's own
  `NotFoundError` — no filename, no explanation, straight to the console as an unhandled
  rejection. It now throws a `MissingContentError` naming the file and saying what the repair is,
  and **Settings → Check files** lists every such file on demand. Metadata and content live in two
  stores that are not transactional with each other, so the state is possible; what was missing was
  any way to see it. Photos and Video no longer let that error escape as an unhandled rejection
  either — the Video stage says what happened instead of showing a black rectangle.

## [Unreleased] — M3, the app platform

Added

- **Third-party apps**, running in a sandbox with an opaque origin and no network. An app is one
  JavaScript file with its manifest in a leading comment: no build step, no package format, and
  nothing to inspect but the file itself.
- **Capability broker.** An app declares what it wants; declaring grants nothing. The user is asked
  the first time the app actually calls a method, and every grant is revocable in Settings → Apps.
- **Scoped file access.** An app reaches `Apps/<its name>/` and the one file it was opened with.
  Nothing else, whatever it was granted.
- **SDK** (`docs/sdk.md`): files, embeddings, search, notifications, clipboard, per-app storage —
  and no network capability, by design.
- **Install from a file, or from a link.** A shared app travels in the URL fragment, which browsers
  never send to a server, so sharing needs no backend.
- Three bundled apps written only against the SDK: Calculator (no permissions at all), Find
  (search), Scratchpad (scoped files, with a button that deliberately gets refused).

Verified

- A sandboxed app cannot reach localStorage, sessionStorage, cookies, IndexedDB, the Cache API,
  OPFS, the parent document, or the network; its `location.origin` is `null`. Results in
  `docs/benchmarks/`.

Fixed

- Permission requests arriving while another prompt was open were silently denied rather than
  queued, so an app needing two permissions had its second refused without the user being asked.
- Two concurrent calls could each create an app's folder, leaving `App` and `App (2)`. The lookup
  now caches the in-flight promise rather than the resolved id.
- The host could send an app its code before the frame was listening. The sandbox now announces
  itself, and the host retries.

## [Unreleased] — M2, photos and audio

Added

- **Photos**: find pictures by describing them, using CLIP image and text embeddings in one vector
  space. Grid, detail panel, "find similar", and example queries. No tags, captions or filenames
  involved.
- **Audio**: waveform player, microphone recording, on-device transcription with timestamps,
  click-to-seek transcript, lexical-cohesion chapter detection, and .srt export.
- **Transcripts are ordinary files.** Each one is written into the file system as Markdown, so it
  is indexed, searchable, viewable and deletable through machinery that already existed.
- **Model download manager**: nothing downloads without a dialog naming the model, its size, its
  host and its licence; every file is verified against a SHA-256 pinned in `models.json`; the
  download appears in the Task Manager and can be removed in Settings.
- Search now returns photos alongside documents, with a relevance cutoff relative to the best hit
  rather than a fixed threshold.
- Sample pictures are drawn in the browser at first boot — illustrations, not photographs, and no
  bytes in the repository or requests to a third host.
- Task Manager gained a Photos panel; Settings gained a model shelf.

Measured

- CLIP ViT-B/32 returned the intended picture first for 6 of 6 test queries; MobileCLIP-S0, the
  plan's smaller default, managed 0 of 6 and was rejected. See ADR 10.
- Whisper's quantised decoder exports fail to load on the current ONNX Runtime; fp16 is the
  smallest that works.

Changed

- Whisper moved from bundled to on-demand, returning the Tier-0 bundle to 22.6 MB.

Fixed

- CLIP text embeddings were padded to the longest phrase in the batch rather than CLIP's fixed
  77-token context, so every photo search failed on a broadcast error.
- The index and the file system could disagree about what was indexed — a lost snapshot left
  files marked "indexed" that no longer were, and search silently returned nothing. Startup now
  reconciles against what the index actually holds.
- Photo search switched itself off after a reload even with the model on disk; consent covers the
  download, not every session.

## [Unreleased] — M1, the desktop

Added

- **Window manager**: drag, resize from eight edges, snap to halves and quarters with a live
  preview, minimise, maximise, z-order, keyboard window management on Ctrl+Alt, and session
  restore across reloads.
- **Virtual file system**: content-addressed blobs in OPFS with reference counting, a metadata
  tree in IndexedDB, trash with restore and undo, and deduplication. Runs in a worker so hashing
  never blocks the UI.
- **Files**: import by drag-and-drop, file picker or (Chromium) folder picker; rename, move,
  trash, restore, permanent delete; list and grid views; virtualised rows; context menu; keyboard
  navigation.
- **Search**: hybrid semantic and keyword retrieval — MiniLM embeddings fused with BM25 by
  reciprocal rank — with snippets, term highlighting, and a label on each result saying how it was
  found. Index persists across reloads.
- **Notes**: Markdown notes stored as ordinary files, auto-titled from the first heading, indexed
  as you type.
- **Viewer**: text, Markdown (hand-written renderer, no HTML injection), images, media playback,
  and PDFs; opens a search hit at the exact passage and marks it.
- **Task Manager**: every job with progress and cancellation, model and index statistics, storage
  use, and a full network log so the privacy claim can be checked rather than believed.
- **Settings**: theme, accent, wallpaper, text size, motion, backend override, indexing options,
  and clearly-labelled destructive operations.
- Job scheduler with priorities, cancellation and concurrency limits; command registry driving the
  palette, the launcher and the keyboard shortcuts from one source; notification centre;
  multi-tab-aware file system events.
- Sample dataset generated in the browser at first boot, including two real PDFs produced by a
  hand-written PDF writer — no downloads, no third-party content, removable in one click.

Measured

- Pointer-move handling during a drag with 14 windows open: 0.01 ms median, one 5.4 ms React
  commit per gesture.
- Hybrid search over the sample corpus: 2–5 ms.
- Desktop shell at boot: ~90 KB gzipped; apps and pdf.js load on demand.

Fixed

- Clearing inline styles after a drag wiped width and height that React believed it had already
  set, collapsing windows to their CSS minimum. The gesture now restores the captured styles.
- Offline, the first search waited 6.3 s for a model fetch that could not succeed before falling
  back to keyword results; it now checks `navigator.onLine` and answers immediately.
- Chunk offsets were rebuilt by concatenation and no longer addressed the source text, which would
  have broken search highlighting.
- `useTrash` and `usePath` declared a cancellation flag they never set.

Known gaps

- Photos and audio search (M2). Second benchmark machine and second browser engine still pending.

## [Unreleased] — M0, foundations

Added

- Vite + React 19 + TypeScript (strict) scaffold, deploying to GitHub Pages via GitHub Actions.
- Capability probe: WebGPU adapter and limits, WASM SIMD/threads, OPFS, File System Access,
  Chrome built-in AI, WebNN, media APIs, plus a hardware tier classification (A/B/C).
- Worker-context probe for capabilities the main thread cannot honestly answer.
- Single service worker providing both cross-origin isolation (COOP/COEP injection) and offline
  shell precaching, with an explicit "restart to update" flow.
- Content-Security-Policy injected at build time; ML runtime self-hosted rather than CDN-loaded.
- Benchmark harness (System Report): embedding throughput per backend and OPFS throughput, with
  JSON export.
- `models.json` generated from the Hugging Face API with exact sizes and SHA-256 digests.
- GitHub Pages simulator (`npm run serve:pages`) that sends no headers, for honest local testing.
- Eight architecture decision records; first machine's benchmarks committed.

Measured

- Threaded WASM is 2.26x faster than WebGPU for all-MiniLM-L6-v2 int8 on the reference machine
  (6.39 vs 14.43 ms per chunk), which changed backend selection to be per-task.
- OPFS sync access handles: ~591 MB/s write, ~781 MB/s read.
- Tier-0 model bundle: 64.2 MB of an 80 MB budget.

Known gaps

- Benchmarks from a second machine and a second browser engine are outstanding.
- No desktop yet: window manager, VFS and apps are M1.
