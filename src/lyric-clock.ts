import { activeCue } from "./sync";
import type { Song } from "./types";

/** Ephemeral operator cue: never stored in the rehearsed song timing. */
export interface LyricClock {
  waiting: boolean;
  start: number;
}
export const initialLyricClock: LyricClock = { waiting: false, start: 0 };
export function lyricTimeAt(time: number, clock = initialLyricClock): number {
  return clock.waiting ? 0 : Math.max(0, time - clock.start);
}
export function lyricCueAt(
  song: Pick<Song, "cues" | "offset">,
  time: number,
  clock = initialLyricClock,
) {
  return clock.waiting
    ? { cue: undefined, index: -1, progress: 0 }
    : activeCue(song.cues, lyricTimeAt(time, clock) + song.offset);
}
export function lyricEnded(
  time: number,
  duration: number,
  clock = initialLyricClock,
) {
  return !clock.waiting && lyricTimeAt(time, clock) >= duration;
}
