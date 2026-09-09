import { describe, expect, it } from "vitest";
import type { Asset, LyricCue } from "../src/types";
import {
  activeCue,
  calculatePlaybackRate,
  distributeLyrics,
  exportLrc,
  exportSrt,
  formatTime,
  parseDuration,
  parseLrc,
  parseSrt,
  quantizeTime,
  similarAssets,
  TapTempo,
  Transport,
} from "../src/sync";

const cue = (
  start: number,
  end: number,
  text = "lyric",
  id = `${start}-${end}-${text}`,
): LyricCue => ({ id, start, end, text });
const timings = (cues: LyricCue[]) =>
  cues.map(({ start, end, text }) => ({ start, end, text }));
const asset = (id: string, values: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  kind: "procedural",
  tags: [],
  hue: 0,
  energy: 0.5,
  license: "CC0",
  ...values,
});

describe("duration parsing and editable time formatting", () => {
  it.each([
    ["0", 0],
    [" 125.25 ", 125.25],
    [".5", 0.5],
    ["2:05.125", 125.125],
    ["1:02:03.5", 3723.5],
    ["120:00", 7200],
    ["0:00", 0],
  ])("parses %s as seconds", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it.each([
    "",
    " ",
    "-2",
    "NaN",
    "Infinity",
    "1e3",
    "1:60",
    "1:60:00",
    "1::20",
    "1:2:3:4",
    "2:00junk",
    "0x20",
  ])("rejects %j", (text) => {
    expect(parseDuration(text)).toBe(0);
  });

  it("retains milliseconds, carries rounding through minutes/hours, and round-trips", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(65.125)).toBe("1:05.125");
    expect(formatTime(59.9999)).toBe("1:00");
    expect(formatTime(3599.9999)).toBe("1:00:00");
    expect(formatTime(360001)).toBe("100:00:01");
    for (const seconds of [0, 0.001, 123.456, 3600.01, 86400]) {
      expect(parseDuration(formatTime(seconds))).toBeCloseTo(seconds, 3);
    }
  });

  it.each([-1, NaN, Infinity, -Infinity])(
    "formats invalid time %s safely",
    (seconds) => {
      expect(formatTime(seconds)).toBe("0:00");
    },
  );
});

describe("rough lyric distribution", () => {
  it("fills the duration with deterministic, contiguous estimated cues", () => {
    const input = "\uFEFF first\r\n\r\nsecond\nthird ";
    const cues = distributeLyrics(input, 10, 120);
    expect(cues.map((item) => item.text)).toEqual(["first", "second", "third"]);
    expect(cues.map((item) => item.start)).toEqual([0, 4, 6]);
    expect(cues.map((item) => item.end)).toEqual([4, 6, 10]);
    expect(cues.every((item) => item.section?.includes("estimated"))).toBe(
      true,
    );
    expect(new Set(cues.map((item) => item.id)).size).toBe(3);
    expect(distributeLyrics(input, 10, 120)).toEqual(cues);
  });

  it("uses BPM/meter for the bar grid and gives longer lines more time", () => {
    expect(
      distributeLyrics("one\ntwo\nthree", 10, 60).map((item) => item.start),
    ).toEqual([0, 4, 8]);
    expect(
      distributeLyrics("one\ntwo\nthree", 10, 120, 3).map((item) => item.start),
    ).toEqual([0, 3, 6]);
    const cues = distributeLyrics(`short\n${"長".repeat(80)}`, 20, 120);
    expect(cues[1].end - cues[1].start).toBeGreaterThan(
      cues[0].end - cues[0].start,
    );
  });

  it("reserves instrumental bars as blank, selectable cues", () => {
    const cues = distributeLyrics("verse\n[instrumental:8]\nchorus", 40, 120);
    expect(timings(cues)).toEqual([
      { start: 0, end: 12, text: "verse" },
      { start: 12, end: 28, text: "" },
      { start: 28, end: 40, text: "chorus" },
    ]);
    expect(cues[1].section).toContain("instrumental");
    expect(activeCue(cues, 20).cue?.text).toBe("");
  });

  it("scales overlong instrumental requests and avoids zero-length cues on short songs", () => {
    for (const duration of [0.001, 1, 5, 17, 37]) {
      const cues = distributeLyrics("a\n[instrumental:8]\nb\nc", duration, 120);
      expect(cues).toHaveLength(4);
      expect(cues[0].start).toBe(0);
      expect(cues.at(-1)?.end).toBe(duration);
      cues.forEach((item, i) => {
        expect(item.end).toBeGreaterThan(item.start);
        expect(item.end).toBeLessThanOrEqual(duration);
        if (i) expect(item.start).toBe(cues[i - 1].end);
      });
    }
    expect(distributeLyrics("[instrumental:8]", 10, 120)).toMatchObject([
      { start: 0, end: 10, text: "" },
    ]);
  });

  it("handles leading/trailing and adjacent instrumental markers", () => {
    for (const text of [
      "[instrumental:2]\na\nb",
      "a\n[instrumental:2]",
      "a\n[instrumental:2]\n[instrumental:2]\nb",
    ]) {
      const cues = distributeLyrics(text, 25, 120);
      expect(cues.at(-1)?.end).toBe(25);
      for (const item of cues.filter((item) => !item.text))
        expect(item.end - item.start).toBeCloseTo(4);
    }
  });

  it("returns no fabricated estimates for missing or invalid timing", () => {
    expect(distributeLyrics("\n \n", 30, 120)).toEqual([]);
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(distributeLyrics("a", invalid, 120)).toEqual([]);
      expect(distributeLyrics("a", 30, invalid)).toEqual([]);
      expect(distributeLyrics("a", 30, 120, invalid)).toEqual([]);
    }
  });
});

describe("LRC import and export", () => {
  it("sorts unsorted multi-tag input, collapses exact duplicates, and keeps simultaneous lyrics", () => {
    const input =
      "[00:12.50]later\n[00:04.00][00:08.00]repeat\n[00:04.00]repeat\n[00:04.00]translation";
    const cues = parseLrc(input);
    expect(timings(cues)).toEqual([
      { start: 4, end: 8, text: "repeat" },
      { start: 4, end: 8, text: "translation" },
      { start: 8, end: 12.5, text: "repeat" },
      { start: 12.5, end: 17.5, text: "later" },
    ]);
    expect(new Set(cues.map((item) => item.id)).size).toBe(cues.length);
    expect(parseLrc(input)).toEqual(cues);
  });

  it("applies the last valid global offset even after the lyrics", () => {
    expect(
      timings(
        parseLrc(
          "[offset:100]\n[00:01.250]first\n[00:02.250]second\n[offset:+500]\n[offset:bad]",
        ),
      ),
    ).toEqual([
      { start: 1.75, end: 2.75, text: "first" },
      { start: 2.75, end: 7.75, text: "second" },
    ]);
  });

  it("clamps negative offsets before deduplication and uses the next distinct boundary", () => {
    expect(
      timings(
        parseLrc(
          "[00:00.100]same\n[00:00.200]same\n[00:03]next\n[offset:-500]",
        ),
      ),
    ).toEqual([
      { start: 0, end: 2.5, text: "same" },
      { start: 2.5, end: 7.5, text: "next" },
    ]);
  });

  it("accepts BOM/CRLF, ignores metadata/bad times, and honors empty end markers", () => {
    const cues = parseLrc(
      "\uFEFF[ti:title]\r\n[ar:artist]\r\n[00:60]bad\r\n[wat]bad\r\n[00:01.125]hello [world]\r\n[00:03.125]\r\n[00:05]bye\r\n[00:06]",
    );
    expect(timings(cues)).toEqual([
      { start: 1.125, end: 3.125, text: "hello [world]" },
      { start: 5, end: 6, text: "bye" },
    ]);
    expect(activeCue(cues, 4).cue).toBeNull();
    expect(activeCue(cues, 6).cue).toBeNull();
    expect(parseLrc("plain lyrics\n[00:01]\n[00:NaN]bad")).toEqual([]);
  });

  it("exports sorted millisecond timestamps and round-trips finite ends and gaps", () => {
    const cues = [cue(65.125, 66.25, "second"), cue(1.001, 3, "first")];
    const before = structuredClone(cues);
    const text = exportLrc(cues);
    expect(text).toBe(
      "[00:01.001]first\n[00:03.000]\n[01:05.125]second\n[01:06.250]",
    );
    expect(timings(parseLrc(text))).toEqual(timings([cues[1], cues[0]]));
    expect(cues).toEqual(before);
  });

  it("avoids clearing contiguous/overlapping lyrics early, and flattens multiline text", () => {
    expect(exportLrc([cue(0, 2, "one\ntwo"), cue(2, 4, "three")])).toBe(
      "[00:00.000]one two\n[00:02.000]three\n[00:04.000]",
    );
    const text = exportLrc([cue(0, 5, "long"), cue(2, 3, "short")]);
    expect(text).toBe("[00:00.000]long\n[00:02.000]short\n[00:05.000]");
  });

  it("skips invalid/blank/unrepresentably short cues and carries rounded milliseconds", () => {
    expect(
      exportLrc([
        cue(-1, 2),
        cue(2, 2),
        cue(3, Infinity),
        cue(NaN, 4),
        cue(1, 2, ""),
        cue(0, 0.0001),
      ]),
    ).toBe("");
    expect(exportLrc([cue(59.9999, 61, "carry")])).toBe(
      "[01:00.000]carry\n[01:01.000]",
    );
    expect(exportLrc([])).toBe("");
    expect(parseLrc("")).toEqual([]);
  });
});

describe("SRT import and export", () => {
  it("parses unsorted CRLF/BOM blocks, multiline text, dot milliseconds, and cue settings", () => {
    const input =
      "\uFEFF2\r\n00:00:04,250 --> 00:00:06,500 X1:10\r\nsecond\r\nline\r\n\r\n1\r\n00:00:01.125 --> 00:00:03.000\r\nfirst";
    expect(timings(parseSrt(input))).toEqual([
      { start: 1.125, end: 3, text: "first" },
      { start: 4.25, end: 6.5, text: "second\nline" },
    ]);
  });

  it("preserves overlaps and distinct duplicate timestamps but removes exact repeated blocks", () => {
    const input =
      "1\n00:00:01,000 --> 00:00:04,000\na\n\n2\n00:00:01,000 --> 00:00:03,000\nb\n\n3\n00:00:01,000 --> 00:00:04,000\na";
    expect(timings(parseSrt(input))).toEqual([
      { start: 1, end: 4, text: "a" },
      { start: 1, end: 3, text: "b" },
    ]);
  });

  it("skips malformed, reversed, zero-duration and empty blocks without losing valid blocks", () => {
    const input = [
      "1\n00:61:00,000 --> 00:62:00,000\nbad",
      "2\n00:00:04,000 --> 00:00:02,000\nreversed",
      "3\n00:00:02,000 --> 00:00:02,000\nzero",
      "4\n00:00:01,000 --> 00:00:02,000",
      "5\nNaN --> Infinity\nbad",
      "00:00:03,000 --> 00:00:04,000\ngood",
    ].join("\n\n");
    expect(timings(parseSrt(input))).toEqual([
      { start: 3, end: 4, text: "good" },
    ]);
    expect(parseSrt("")).toEqual([]);
  });

  it("round-trips exact overlapping intervals/multiline text and does not wrap hours", () => {
    const cues = [
      cue(360000, 360001.125, "late"),
      cue(1, 4, "line\ntwo"),
      cue(2, 3, "overlap"),
    ];
    const before = structuredClone(cues);
    const output = exportSrt(cues);
    expect(output).toContain("100:00:00,000 --> 100:00:01,125");
    expect(output).toMatch(/^1\n00:00:01,000 --> 00:00:04,000/);
    expect(timings(parseSrt(output))).toEqual(
      timings([cues[1], cues[2], cues[0]]),
    );
    expect(cues).toEqual(before);
    expect(exportSrt([cue(0, 1, ""), cue(1, 0), cue(0, Infinity)])).toBe("");
  });
});

describe("active lyric intervals", () => {
  it("handles editable unsorted cues, gaps, and exact half-open boundaries", () => {
    const cues = [cue(5, 7, "later"), cue(1, 3, "first"), cue(3, 4, "next")];
    expect(activeCue(cues, 0)).toEqual({ cue: null, index: -1, progress: 0 });
    expect(activeCue(cues, 2)).toEqual({
      cue: cues[1],
      index: 1,
      progress: 0.5,
    });
    expect(activeCue(cues, 3)).toEqual({ cue: cues[2], index: 2, progress: 0 });
    expect(activeCue(cues, 4).cue).toBeNull();
    expect(activeCue(cues, 7).cue).toBeNull();
    cues[0].start = 2.5;
    expect(activeCue(cues, 2.75).index).toBe(0);
  });

  it("resolves overlaps by latest start then last source index and restores underlying intervals", () => {
    const cues = [
      cue(0, 10, "base"),
      cue(2, 6, "new"),
      cue(2, 4, "translation"),
    ];
    expect(activeCue(cues, 3).index).toBe(2);
    expect(activeCue(cues, 4).index).toBe(1);
    expect(activeCue(cues, 6).index).toBe(0);
  });

  it("ignores invalid times/intervals and supports blank instrumental cues", () => {
    const cues = [
      cue(1, 1),
      cue(-1, 9),
      cue(0, Infinity),
      cue(NaN, 9),
      cue(1, 3, ""),
    ];
    expect(activeCue(cues, 2)).toEqual({
      cue: cues[4],
      index: 4,
      progress: 0.5,
    });
    for (const time of [-1, NaN, Infinity, -Infinity])
      expect(activeCue(cues, time)).toEqual({
        cue: null,
        index: -1,
        progress: 0,
      });
    expect(activeCue([], 0).index).toBe(-1);
  });
});

describe("beat quantization and playback rate", () => {
  it("returns the strictly next boundary at zero, between beats, and on a boundary", () => {
    expect(quantizeTime(0, 120)).toBe(0.5);
    expect(quantizeTime(0.51, 120)).toBe(1);
    expect(quantizeTime(1, 120)).toBe(1.5);
    expect(quantizeTime(2, 120, 4)).toBe(4);
    expect(quantizeTime(0.3, 600)).toBeCloseTo(0.4);
    expect(quantizeTime(1 / 3, 180)).toBeCloseTo(2 / 3);
    expect(quantizeTime(0.1, 120, 0.5)).toBe(0.25);
  });

  it("safely leaves unquantizable times unchanged", () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(quantizeTime(1.2, invalid)).toBe(1.2);
      expect(quantizeTime(1.2, 120, invalid)).toBe(1.2);
    }
    expect(quantizeTime(NaN, 120)).toBe(0);
    expect(quantizeTime(-1, 120)).toBe(0);
    expect(quantizeTime(Number.MAX_VALUE, 120)).toBe(Number.MAX_VALUE);
  });

  it("fits native clip duration into target beats in the correct direction", () => {
    expect(calculatePlaybackRate(4, 120, 8)).toBe(1);
    expect(calculatePlaybackRate(8, 120, 8)).toBe(2);
    expect(calculatePlaybackRate(2, 120, 8)).toBe(0.5);
    expect(calculatePlaybackRate(1000, 120, 1)).toBe(4);
    expect(calculatePlaybackRate(0.01, 120, 32)).toBe(0.25);
  });

  it("returns unity for invalid inputs and bounded rates for extreme finite inputs", () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(calculatePlaybackRate(invalid, 120, 8)).toBe(1);
      expect(calculatePlaybackRate(4, invalid, 8)).toBe(1);
      expect(calculatePlaybackRate(4, 120, invalid)).toBe(1);
    }
    expect(
      calculatePlaybackRate(
        Number.MAX_VALUE,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
      ),
    ).toBeCloseTo(4);
    expect(
      calculatePlaybackRate(
        Number.MIN_VALUE,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
      ),
    ).toBeCloseTo(0.25);
  });
});

describe("asset similarity", () => {
  it("uses normalized tag overlap, energy and wrapping hue", () => {
    const source = asset("source", {
      tags: [" Neon ", "FAST"],
      hue: 359,
      energy: 0.9,
    });
    const same = asset("same", {
      tags: ["neon", "fast", "fast"],
      hue: 1,
      energy: 0.9,
    });
    const opposite = asset("opposite", {
      tags: ["NEON", "fast"],
      hue: 179,
      energy: 0.9,
    });
    const unrelated = asset("unrelated", { hue: 359, energy: 0.9 });
    expect(
      similarAssets(source, [unrelated, opposite, source, same]).map(
        (item) => item.id,
      ),
    ).toEqual(["same", "opposite", "unrelated"]);
    expect(
      similarAssets(asset("s"), [asset("b", { energy: 0 }), asset("a")])[0].id,
    ).toBe("a");
  });

  it("normalizes negative/multi-turn hue and breaks ties deterministically by ID", () => {
    const source = asset("source", { hue: -1 });
    const candidates = [
      asset("z", { hue: 359 }),
      asset("a", { hue: 719 }),
      asset("opposite", { hue: 179 }),
    ];
    expect(similarAssets(source, candidates).map((item) => item.id)).toEqual([
      "a",
      "z",
      "opposite",
    ]);
    expect(similarAssets(source, [...candidates].reverse())).toEqual(
      similarAssets(source, candidates),
    );
  });

  it("excludes self/duplicate IDs, limits results, handles bad numbers, and never mutates", () => {
    const source = asset("source");
    const first = asset("a");
    const candidates = [
      source,
      first,
      first,
      asset("bad", { hue: NaN, energy: Infinity }),
      ...Array.from({ length: 10 }, (_, i) => asset(`b${i}`)),
    ];
    const before = structuredClone(candidates);
    const result = similarAssets(source, candidates);
    expect(result).toHaveLength(8);
    expect(new Set(result.map((item) => item.id)).size).toBe(8);
    expect(result).not.toContain(source);
    expect(similarAssets(source, candidates, 1.9)).toEqual([first]);
    for (const limit of [0, -1, NaN, Infinity])
      expect(similarAssets(source, candidates, limit)).toEqual([]);
    expect(candidates).toEqual(before);
  });
});

describe("tap tempo", () => {
  it("estimates tempo from intervals including a first tap at zero", () => {
    const tap = new TapTempo();
    expect(tap.tap(0)).toBeNull();
    expect(tap.tap(500)).toBe(120);
    expect(tap.tap(1000)).toBe(120);
    tap.reset();
    expect(tap.tap(2000)).toBeNull();
    expect(tap.tap(3000)).toBe(60);
  });

  it("resists jitter/missed taps with a median and adapts as the rolling window turns over", () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(500);
    tap.tap(990);
    tap.tap(1500);
    expect(tap.tap(2500)).toBeCloseTo(118.8);
    let bpm: number | null = null;
    for (let time = 3250; time <= 8500; time += 750) bpm = tap.tap(time);
    expect(bpm).toBe(80);
  });

  it("ignores duplicate/rapid/backward/nonfinite taps and restarts after inactivity", () => {
    const tap = new TapTempo();
    tap.tap(1000);
    for (const time of [1000, 1100, 900, -1, NaN, Infinity])
      expect(tap.tap(time)).toBeNull();
    expect(tap.tap(1500)).toBe(120);
    expect(tap.tap(4000)).toBeNull();
    expect(tap.tap(4600)).toBe(100);
    tap.reset();
    expect(tap.tap(5000)).toBeNull();
    expect(tap.tap(5200)).toBe(300);
    tap.reset();
    tap.tap(0);
    expect(tap.tap(2000)).toBe(30);
  });
});

describe("timer-free transport", () => {
  it("starts paused, seeks while paused, resumes without counting paused time, and ignores duplicate play", () => {
    const transport = new Transport();
    expect(transport.playing).toBe(false);
    expect(transport.getTime(1000)).toBe(0);
    transport.seek(10, 1000);
    expect(transport.getTime(9000)).toBe(10);
    transport.play(10000);
    transport.play(11000);
    expect(transport.getTime(12000)).toBe(12);
    transport.pause(12500);
    transport.pause(15000);
    expect(transport.getTime(20000)).toBe(12.5);
    expect(transport.playing).toBe(false);
    transport.play(20000);
    expect(transport.getTime(21500)).toBe(14);
  });

  it("keeps position continuous through running and paused rate changes", () => {
    const transport = new Transport();
    transport.play(0);
    transport.setRate(2, 1500);
    expect(transport.getTime(1500)).toBe(1.5);
    expect(transport.getTime(2500)).toBe(3.5);
    transport.setRate(0.5, 2500);
    transport.pause(3500);
    expect(transport.getTime(9000)).toBe(4);
    transport.setRate(1.25, 9000);
    expect(transport.getTime(10000)).toBe(4);
    transport.play(10000);
    expect(transport.getTime(12000)).toBe(6.5);
    expect(transport.rate).toBe(1.25);
  });

  it("supports backing-audio seeks and signed live nudges without changing playback state", () => {
    const transport = new Transport();
    transport.play(1000);
    transport.seek(30.25, 2000);
    expect(transport.getTime(2500)).toBe(30.75);
    transport.nudge(-0.25, 2500);
    expect(transport.getTime(3000)).toBe(31);
    transport.nudge(2, 3000);
    expect(transport.getTime(3000)).toBe(33);
    expect(transport.playing).toBe(true);
    transport.pause(3000);
    transport.nudge(-100, 4000);
    expect(transport.getTime(5000)).toBe(0);
    expect(transport.playing).toBe(false);
    transport.seek(-5, 6000);
    expect(transport.getTime(6000)).toBe(0);
  });

  it("depends only on absolute clock anchors, not frame count or frame spacing", () => {
    const dense = new Transport();
    const sparse = new Transport();
    dense.play(100);
    sparse.play(100);
    dense.setRate(1.001, 100);
    sparse.setRate(1.001, 100);
    for (let frame = 1; frame <= 10000; frame++)
      dense.getTime(100 + frame * 16.6667);
    expect(dense.getTime(3600100)).toBe(sparse.getTime(3600100));
    expect(dense.getTime(3600100)).toBeCloseTo(3603.6, 8);
  });

  it("ignores invalid mutations and prevents backward-clock elapsed time", () => {
    const transport = new Transport();
    transport.play(NaN);
    expect(transport.playing).toBe(false);
    transport.seek(5, 1000);
    transport.play(1000);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      transport.seek(invalid, 1500);
      transport.seek(20, invalid);
      transport.nudge(invalid, 1500);
      transport.nudge(1, invalid);
      transport.pause(invalid);
      transport.setRate(invalid, 1500);
      transport.setRate(2, invalid);
      expect(transport.getTime(invalid)).toBe(5);
    }
    transport.setRate(0, 1500);
    transport.setRate(-1, 1500);
    expect(transport.rate).toBe(1);
    expect(transport.getTime(500)).toBe(5);
    expect(transport.getTime(2000)).toBe(6);
    expect(transport.playing).toBe(true);
  });
});
