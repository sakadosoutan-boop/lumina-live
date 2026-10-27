import { describe, it, expect } from "vitest";
import {
  initialLyricClock,
  lyricTimeAt,
  lyricCueAt,
  lyricEnded,
} from "../src/lyric-clock";
import { Transport } from "../src/sync";
import { parseBpmInput } from "../src/BpmInput";

const song = {
  offset: 0,
  cues: [
    { id: "a", text: "first", start: 0, end: 10 },
    { id: "b", text: "second", start: 10, end: 20 },
  ],
};
describe("independent lyric start", () => {
  it("keeps video transport running beyond the song length while all lyrics are hidden", () => {
    const transport = new Transport();
    transport.play(0);
    const clock = { waiting: true, start: 0 };
    const videoTime = transport.getTime(600000);
    expect(videoTime).toBe(600);
    expect(lyricTimeAt(videoTime, clock)).toBe(0);
    expect(
      lyricCueAt({ ...song, offset: 15 }, videoTime, clock).cue,
    ).toBeUndefined();
    expect(lyricEnded(videoTime, 20, clock)).toBe(false);
  });
  it("starts from zero on the operator cue, with no jump in video or beat transport", () => {
    const transport = new Transport();
    transport.play(0);
    const clock = { waiting: false, start: transport.getTime(600000) };
    expect(transport.getTime(600000)).toBe(600);
    expect(lyricCueAt(song, 600, clock).cue?.text).toBe("first");
    expect(lyricCueAt(song, 610, clock).cue?.text).toBe("second");
    expect(lyricEnded(619, 20, clock)).toBe(false);
    expect(lyricEnded(620, 20, clock)).toBe(true);
  });
  it("preserves the operator start through pause, tempo changes, and output serialization", () => {
    const transport = new Transport();
    transport.play(0);
    const clock = JSON.parse(JSON.stringify({ waiting: false, start: 100 }));
    transport.pause(105000);
    expect(lyricTimeAt(transport.getTime(200000), clock)).toBe(5);
    transport.setRate(1.5, 200000);
    transport.play(200000);
    expect(lyricTimeAt(transport.getTime(204000), clock)).toBe(11);
    expect(lyricCueAt(song, transport.getTime(204000), clock).cue?.text).toBe(
      "second",
    );
  });
  it("keeps normal audio timing unchanged and applies cue offsets after an operator start", () => {
    expect(lyricTimeAt(12, initialLyricClock)).toBe(12);
    expect(
      lyricCueAt({ ...song, offset: 2 }, 108, { waiting: false, start: 100 })
        .cue?.text,
    ).toBe("second");
    expect(lyricTimeAt(0, initialLyricClock)).toBe(0);
  });
});
describe("BPM committed input", () => {
  it("accepts decimal tempos and refuses empty, partial, invalid and out-of-range edits", () => {
    expect(parseBpmInput("128.5")).toBe(128.5);
    expect(parseBpmInput(" 120 ")).toBe(120);
    for (const input of ["", " ", "1", "-", "NaN", "Infinity", "401", "19"]) {
      expect(parseBpmInput(input)).toBeNull();
    }
  });
});
