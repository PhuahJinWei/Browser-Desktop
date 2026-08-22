import { describe, expect, it } from 'vitest';
import { formatTime, groupMoments, momentId, parseMomentId } from './moments';
import type { ImageHit } from './images';

function hit(sourceId: string, time: number, score: number, name = 'clip.webm'): ImageHit {
  return {
    id: momentId(sourceId, time),
    name,
    mime: 'video/webm',
    width: 0,
    height: 0,
    score,
    time,
    sourceId,
  };
}

describe('groupMoments', () => {
  it('collapses a run of consecutive frames into one moment', () => {
    const moments = groupMoments([hit('a', 4, 0.3), hit('a', 6, 0.34), hit('a', 8, 0.31)]);

    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ sourceId: 'a', frames: 3, bestTime: 6 });
    // Padded by a second either side of the sampled instants.
    expect(moments[0]!.start).toBe(3);
    expect(moments[0]!.end).toBe(9);
    // The moment's score is its best frame's, not an average that a weak neighbour would dilute.
    expect(moments[0]!.score).toBeCloseTo(0.34);
  });

  it('splits runs separated by more than the gap', () => {
    const moments = groupMoments([hit('a', 2, 0.3), hit('a', 4, 0.3), hit('a', 30, 0.5)]);

    expect(moments).toHaveLength(2);
    // Best first.
    expect(moments[0]!.bestTime).toBe(30);
    expect(moments[1]!.frames).toBe(2);
  });

  it('tolerates one weak frame inside a shot', () => {
    // 10 is missing — the model liked it less — but 8 and 12 are four seconds apart, inside the gap.
    const moments = groupMoments([hit('a', 8, 0.4), hit('a', 12, 0.42)]);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.frames).toBe(2);
  });

  it('keeps different videos apart even when their times interleave', () => {
    const moments = groupMoments([hit('a', 2, 0.5), hit('b', 3, 0.4), hit('a', 4, 0.45)]);

    expect(moments).toHaveLength(2);
    const forA = moments.find((moment) => moment.sourceId === 'a');
    expect(forA?.frames).toBe(2);
    expect(moments.find((moment) => moment.sourceId === 'b')?.frames).toBe(1);
  });

  it('caps a moment so one long take is not returned as the whole video', () => {
    const hits = Array.from({ length: 30 }, (_, index) => hit('a', index * 2, 0.3));
    const moments = groupMoments(hits);

    expect(moments.length).toBeGreaterThan(1);
    for (const moment of moments) expect(moment.end - moment.start).toBeLessThanOrEqual(34);
  });

  it('ignores still photographs, which have no time', () => {
    const photo: ImageHit = {
      id: 'photo',
      name: 'a.png',
      mime: 'image/png',
      width: 1,
      height: 1,
      score: 0.9,
    };
    expect(groupMoments([photo, hit('a', 2, 0.3)])).toHaveLength(1);
  });

  it('is stable: equal scores order by time', () => {
    const moments = groupMoments([hit('a', 2, 0.4), hit('b', 40, 0.4)]);
    expect(moments.map((moment) => moment.sourceId)).toEqual(['a', 'b']);
  });
});

describe('moment ids', () => {
  it('round-trips', () => {
    expect(parseMomentId(momentId('file-1', 12.5))).toEqual({ sourceId: 'file-1', time: 12.5 });
  });

  it('survives ids that themselves contain an @', () => {
    expect(parseMomentId(momentId('a@b', 3))).toEqual({ sourceId: 'a@b', time: 3 });
  });

  it('rejects a plain file id', () => {
    expect(parseMomentId('file-1')).toBeNull();
  });
});

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(64)).toBe('1:04');
    expect(formatTime(3723)).toBe('1:02:03');
  });
});
