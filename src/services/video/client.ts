import { PRIORITY, schedule } from '../../kernel/jobs';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, categoryOf, type VfsNode } from '../../kernel/vfs/types';
import { canExportClips, exportClip, frameAt } from './frames';

/**
 * Video, as far as the desktop is concerned.
 *
 * Everything here is browser API and nothing else: seek a `<video>` element, draw to a canvas,
 * record a stream. No model, no download, no consent dialog — which is why exporting a still or a
 * section survived the removal of the on-demand models, while searching inside a video did not.
 */

/** Every video in the file system, newest first. */
export async function listVideos(): Promise<VfsNode[]> {
  const nodes = await vfs.allNodes();
  return nodes
    .filter((node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'video')
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** A full-resolution still from one moment, saved beside the video. */
export async function saveFrame(node: VfsNode, time: number): Promise<VfsNode | null> {
  const { data } = await vfs.read(node.id);
  const blob = await frameAt(data, node.mime, time);
  if (!blob) return null;

  const base = node.name.replace(/\.[^.]+$/, '');
  return vfs.writeFile({
    parentId: node.parentId ?? ROOT_ID,
    name: `${base} at ${Math.round(time)}s.png`,
    data: await blob.arrayBuffer(),
    mime: 'image/png',
    overwrite: true,
  });
}

export { canExportClips };

/**
 * Saves a section as its own video file, beside the original.
 *
 * Real-time: the section is played back and re-recorded, so a ten-second clip takes ten seconds.
 * That is stated in the UI rather than hidden behind a spinner.
 */
export async function saveClip(
  node: VfsNode,
  start: number,
  end: number,
  onProgress?: (fraction: number) => void,
): Promise<VfsNode | null> {
  const { data } = await vfs.read(node.id);
  const result = await schedule(
    { label: `Export clip from ${node.name}`, kind: 'export', priority: PRIORITY.userBatch },
    async (context) =>
      exportClip(data, node.mime, start, end, {
        signal: context.signal,
        onProgress: (fraction) => {
          onProgress?.(fraction);
          context.setProgress(fraction, `${Math.round(fraction * 100)}%`);
        },
      }),
  ).promise;

  if (!result) return null;

  const base = node.name.replace(/\.[^.]+$/, '');
  return vfs.writeFile({
    parentId: node.parentId ?? ROOT_ID,
    name: `${base} ${Math.round(start)}-${Math.round(end)}s.webm`,
    data: await result.blob.arrayBuffer(),
    mime: result.blob.type || 'video/webm',
    overwrite: true,
  });
}
