import { notify } from '../kernel/notifications';
import { updateSettings } from '../kernel/settings';
import { vfs } from '../kernel/vfs/client';
import { ROOT_ID, type ImportEntry } from '../kernel/vfs/types';
import { createPdf } from './samplePdf';
import { renderSampleImages } from './samplePhotos';
import { renderSampleScan } from './sampleScan';

/**
 * The sample dataset.
 *
 * A desktop with nothing in it demonstrates nothing, and nobody drops their own documents into a
 * stranger's web page to find out whether it works. So the first boot arrives with a small,
 * self-made corpus that makes semantic search immediately demonstrable — and Settings can remove
 * every trace of it in one click.
 *
 * Everything here is written for this project: no third-party content, no licensing to track.
 * It is generated in the browser rather than shipped, so it costs nothing in the bundle or in
 * GitHub Pages bandwidth.
 *
 * The pictures are drawn in the browser too (see samplePhotos.ts) — illustrations rather than
 * photographs, which is stated plainly in the README. Audio is deliberately absent: a speech
 * sample cannot be synthesised without a voice model, so the Audio app offers recording and
 * import instead of pretending to ship one.
 */

const encoder = new TextEncoder();
const asBuffer = (text: string): ArrayBuffer => {
  const bytes = encoder.encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

function invoiceMonitor(): Uint8Array {
  return createPdf(
    [
      {
        lines: [
          { text: 'NORTHWIND DISPLAYS', size: 16, bold: true },
          { text: 'Unit 4, Harbour Works, Bristol BS1 6TY', size: 9 },
          { text: '' },
          { text: 'INVOICE 428291', size: 13, bold: true },
          { text: 'Issued 14 March 2026 · Due 13 April 2026', size: 10 },
          { text: '' },
          { text: 'Billed to: Tabula Studio', size: 10 },
          { text: '' },
          { text: 'Description                                     Qty      Amount', bold: true },
          { text: 'Aurora 27 monitor, 4K IPS, 27 inch                1      GBP 429.00' },
          { text: 'Adjustable monitor arm, single                    1      GBP  74.50' },
          { text: 'USB-C dock, 90W power delivery                    1      GBP 118.00' },
          { text: '' },
          { text: 'Subtotal                                                GBP 621.50' },
          { text: 'VAT at 20%                                              GBP 124.30' },
          {
            text: 'Total due                                               GBP 745.80',
            bold: true,
          },
          { text: '' },
          { text: 'The monitor carries a three year on-site warranty. Dead pixel policy and' },
          { text: 'return terms are set out in the accompanying warranty document.' },
          { text: '' },
          { text: 'Payment by bank transfer within 30 days. Late payment attracts interest at' },
          { text: '4% above base rate.' },
        ],
      },
    ],
    'Invoice 428291 — Northwind Displays',
  );
}

function invoiceStorage(): Uint8Array {
  return createPdf(
    [
      {
        lines: [
          { text: 'MERIDIAN COMPONENTS', size: 16, bold: true },
          { text: '17 Fenchurch Row, Manchester M2 3JQ', size: 9 },
          { text: '' },
          { text: 'INVOICE 173551', size: 13, bold: true },
          { text: 'Issued 2 February 2026 · Paid 9 February 2026', size: 10 },
          { text: '' },
          { text: 'Description                                     Qty      Amount', bold: true },
          { text: 'Samsung 990 Pro NVMe solid state drive, 2 TB      2      GBP 318.00' },
          { text: 'Samsung DDR5 memory module, 32 GB                 2      GBP 194.00' },
          { text: 'Thermal interface compound, 4 g syringe           1      GBP   9.50' },
          { text: '' },
          { text: 'Subtotal                                                GBP 521.50' },
          { text: 'VAT at 20%                                              GBP 104.30' },
          {
            text: 'Total                                                   GBP 625.80',
            bold: true,
          },
          { text: '' },
          { text: 'Samsung components are covered by the manufacturer five year limited' },
          { text: 'warranty. Retain this invoice as proof of purchase; warranty claims made' },
          { text: 'without it are handled at the retailer discretion.' },
        ],
      },
    ],
    'Invoice 173551 — Meridian Components',
  );
}

const WARRANTY = `Warranty terms — display equipment

Coverage
Displays supplied by Northwind carry a three year warranty covering manufacturing
defects, backlight failure, and dead or stuck pixels above the threshold below.
Cover starts on the invoice date, not the delivery date.

Dead pixel threshold
A panel qualifies for replacement where it shows more than three permanently lit
sub-pixels, or any single permanently dark pixel within the central quarter of the
screen. Panels below that threshold are considered within manufacturing tolerance.

What is not covered
Physical damage, liquid ingress, burn-in from static images displayed for extended
periods, and any fault arising from a power supply other than the one supplied.
Screen coatings are consumable and are excluded after the first year.

Making a claim
Claims require the original invoice number. On-site replacement is offered within
mainland UK; elsewhere the display must be returned carriage paid. Replacement units
may be refurbished stock of the same or a higher specification.

Response times
Faults reported before 2pm on a working day are collected the following working day.
The replacement is normally with you within three working days of collection.
`;

const MEETING_NOTES = `# Migration planning, 14 August

Present: Priya, Tomas, Wren, and me.

## Where we are

The storage layer is the last piece still running on the old stack. Everything else
moved across in June and has been stable since. Tomas walked through the remaining
dependencies; there are four, and only one of them is load bearing.

## Timeline

We agreed the migration window is the last week of September. That gives three weeks
of buffer before the quarterly review, which is the real deadline. Wren pushed back on
starting earlier — the team is still absorbing the June changes and stacking another
migration on top would be a mistake.

Milestones:

- 1 September: read-only mirror running in parallel
- 15 September: cut writes over for internal traffic only
- 22 September: full cutover, old stack kept warm for a week
- 29 September: decommission

## Budget

The hardware order came in under estimate — the monitor and dock purchases were the
bulk of it, and the storage upgrade was cheaper than quoted because the Samsung drives
dropped in price. Roughly four hundred pounds left in the equipment line.

## Actions

- Priya: draft the rollback procedure, circulate by Friday
- Tomas: confirm the four dependencies are pinned
- Wren: book the migration window with support
- Me: write up the statement of work and get it signed
`;

const STATEMENT_OF_WORK = `# Statement of work — storage migration

## Scope

Move the document storage layer from the current hosted service onto the local-first
architecture already used by the rest of the system. Data is migrated in place; no
document identifiers change, and no client-side code is expected to need updating.

## Approach

The migration runs in three phases. A read-only mirror is established first, so that
reads can be served from either side and compared. Writes are then cut over for
internal traffic only, which limits the blast radius of anything unexpected. Full
cutover follows once the mirror has run clean for a week.

## Deliverables

1. Migration tooling, including a verified rollback path
2. A parallel-run report comparing read results across both stacks
3. Updated operational documentation
4. Decommissioning of the old service and cancellation of its billing

## Acceptance

The migration is accepted when every document is readable from the new stack, the
comparison report shows no divergence over a full week, and the rollback procedure has
been tested rather than merely written.

## Commercial

Fixed price, invoiced in two parts: half on the parallel run starting, half on
acceptance. Equipment purchased for the work is charged at cost and listed separately
on the relevant invoices.
`;

const READING_LIST = `# Reading list

Things worth coming back to.

## Systems

- The paper on reciprocal rank fusion — short, and the idea is simpler than the
  implementations suggest. Combining rankings by position rather than by score sidesteps
  the whole problem of incomparable scales.
- Anything on content-addressed storage. Once you address a file by the hash of its
  contents, renaming and copying stop being interesting problems.

## Browser platform

- The origin private file system: fast, but the synchronous handles only exist inside
  workers, which is easy to discover the hard way.
- Cross-origin isolation. Worth understanding properly rather than copying the headers
  from a blog post, because on a static host you cannot set headers at all.

## Machine learning

- Quantisation. An int8 model that fits in twenty megabytes and answers in six
  milliseconds beats a better model nobody waits for.
- Embedding models are not language models, and conflating the two makes people think
  local AI needs a gigabyte of weights. It usually does not.
`;

const README_NOTE = `# Welcome to Tabula

This is a desktop that runs entirely inside a browser tab. No server, no account, no
upload. The documents you see were generated on this device when you first opened the
page, and Settings can remove every trace of them.

## Try this

Open the Search app. It offers a few example queries as chips — click one. You will get
the passage that answers it, not just a file name, because matching happens on meaning
rather than on the exact words you typed.

Every result is labelled with how it was found: by meaning, by keyword, or by both. A
search that cannot explain itself is one you end up not trusting.

## What is actually happening

Text is split into passages. Each passage is turned into a vector by a model running on
your own hardware, and your query is turned into a vector the same way. Matching is a
dot product over those vectors, fused with an ordinary keyword ranking.

The model is around twenty megabytes, downloaded once and cached. Open the Task Manager
to see every network request this page has made — and to confirm that your documents
are not among them.
`;

/** Builds the dataset. Kept as data so the file list is obvious at a glance. */
function buildEntries(): ImportEntry[] {
  const pdf = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return [
    { path: 'Documents/Invoice 428291.pdf', data: pdf(invoiceMonitor()), mime: 'application/pdf' },
    { path: 'Documents/Invoice 173551.pdf', data: pdf(invoiceStorage()), mime: 'application/pdf' },
    { path: 'Documents/Warranty terms.txt', data: asBuffer(WARRANTY), mime: 'text/plain' },
    {
      path: 'Documents/Statement of work.md',
      data: asBuffer(STATEMENT_OF_WORK),
      mime: 'text/markdown',
    },
    { path: 'Notes/Migration planning.md', data: asBuffer(MEETING_NOTES), mime: 'text/markdown' },
    { path: 'Notes/Reading list.md', data: asBuffer(READING_LIST), mime: 'text/markdown' },
    { path: 'Notes/Welcome to Tabula.md', data: asBuffer(README_NOTE), mime: 'text/markdown' },
  ];
}

export async function loadSampleData(): Promise<number> {
  const entries = buildEntries();

  // Pictures are rendered at load time rather than stored: a handful of canvas draws costs
  // milliseconds and keeps the bundle free of image bytes.
  for (const image of await renderSampleImages()) {
    entries.push({ path: `Pictures/${image.name}`, data: image.data, mime: image.mime });
  }

  // A page of printed text with no text layer, so there is something for OCR to read. It lands in
  // Documents rather than Pictures because that is what it is.
  const scan = await renderSampleScan();
  if (scan) entries.push({ path: `Documents/${scan.name}`, data: scan.data, mime: scan.mime });

  const result = await vfs.importEntries(ROOT_ID, entries, { sample: true });
  updateSettings({ sampleDataLoaded: true });

  notify({
    title: `Added ${result.created.length} sample files`,
    body: 'Documents and pictures, made on this device. Remove them any time in Settings.',
    level: 'success',
    timeout: 9000,
  });
  return result.created.length;
}
