import type { Asset, LyricCue } from './types';

const finite = (value: number): boolean => Number.isFinite(value);
const positive = (value: number): boolean => finite(value) && value > 0;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

function readDuration(text: string): number | null {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    const seconds = Number(value);
    return finite(seconds) ? seconds : null;
  }
  if (!/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(value)) return null;
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some(part => !finite(part) || part >= 60)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return finite(seconds) ? seconds : null;
}

/** Seconds, M:SS, or H:MM:SS, with optional fractional seconds. Invalid input is 0. */
export function parseDuration(text: string): number {
  return readDuration(text) ?? 0;
}

function milliseconds(seconds: number): number {
  return finite(seconds) && seconds > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(seconds * 1000))
    : 0;
}

/** M:SS (H:MM:SS for hours), retaining nonzero milliseconds for timestamp editing. */
export function formatTime(seconds: number): string {
  const ms = milliseconds(seconds);
  const whole = Math.floor(ms / 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60);
  const clock = hours > 0
    ? `${hours}:${pad(minutes % 60)}:${pad(whole % 60)}`
    : `${minutes}:${pad(whole % 60)}`;
  return ms % 1000 ? `${clock}.${pad(ms % 1000, 3)}` : clock;
}

/**
 * A rough estimate, never audio alignment. Each nonempty line receives a cue;
 * longer lines receive more time. Boundaries prefer the supplied bar grid.
 * A standalone [instrumental:8] reserves eight bars and emits an empty cue.
 * If the requested instrumental bars exceed the song, all nominal weights are
 * scaled to fit instead. Every cue is marked estimated via its section.
 * Invalid duration, BPM, or meter produces no cues. Input text is never mutated.
 */
export function distributeLyrics(
  text: string, duration: number, bpm: number, beatsPerBar = 4,
): LyricCue[] {
  if (typeof text !== 'string' || !positive(duration) || !positive(bpm)
      || !positive(beatsPerBar)) return [];
  const bar = 60 / bpm * beatsPerBar;
  if (!positive(bar)) return [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries = lines.map(line => {
    const marker = /^\[instrumental:(\d+(?:\.\d+)?)\]$/i.exec(line);
    const bars = marker ? Number(marker[1]) : 0;
    const instrumental = positive(bars);
    return {
      text: instrumental ? '' : line,
      instrumental,
      weight: instrumental ? bars : Math.max(1, Math.ceil(Array.from(line.replace(/\s/g, '')).length / 32)),
    };
  });
  if (!entries.length) return [];
  const instrumentalWeight = entries.reduce((sum, entry) => sum + (entry.instrumental ? entry.weight : 0), 0);
  const lyricWeight = entries.reduce((sum, entry) => sum + (entry.instrumental ? 0 : entry.weight), 0);
  const totalWeight = instrumentalWeight + lyricWeight;
  if (!positive(totalWeight)) return [];
  const reserved = instrumentalWeight * bar;
  const reserveBars = lyricWeight > 0 && reserved < duration;
  const spans = entries.map(entry => reserveBars
    ? entry.instrumental ? entry.weight * bar : (duration - reserved) * (entry.weight / lyricWeight)
    : duration * (entry.weight / totalWeight));

  // Do not force a grid if it would consume the positive interval of a later cue.
  // Instrumental spans remain exact when they fit; lyric boundaries absorb snaps.
  const suffix = new Array<number>(entries.length + 1).fill(0);
  const variableCount = new Array<number>(entries.length + 1).fill(0);
  for (let i = entries.length - 1; i >= 0; i--) {
    const fixed = reserveBars && entries[i].instrumental;
    suffix[i] = suffix[i + 1] + (fixed ? spans[i] : 0);
    variableCount[i] = variableCount[i + 1] + (fixed ? 0 : 1);
  }
  const cues: LyricCue[] = [];
  let start = 0;
  let idealEnd = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    idealEnd += spans[i];
    const fixed = reserveBars && entry.instrumental;
    const upper = duration - suffix[i + 1];
    let end = fixed ? start + spans[i] : idealEnd;
    if (!fixed) {
      if (variableCount[i + 1] === 0) {
        // The final lyric absorbs the remainder before any trailing fixed bars.
        end = upper;
      } else {
        const snapped = Math.round(end / bar) * bar;
        if (finite(snapped) && snapped > start && snapped < upper) end = snapped;
        // A crowded grid must not create an empty/reversed later interval.
        if (end <= start || end >= upper) end = start + (upper - start) / variableCount[i];
      }
    }
    if (i === entries.length - 1) end = duration;
    end = Math.min(duration, end);
    if (!finite(end) || end <= start) return [];
    cues.push({
      id: `estimate-${i + 1}`, start, end, text: entry.text,
      section: entry.instrumental ? 'instrumental (estimated)' : 'estimated',
    });
    start = end;
  }
  return cues;
}

interface TimedText { start: number; text: string; order: number }

/**
 * Supports repeated timestamp tags, unsorted lines, and a global millisecond
 * offset (the last valid offset wins, wherever it occurs). Negative adjusted
 * times clamp to zero. Identical start/text duplicates collapse; simultaneous
 * distinct lyrics remain in source order. Blank timestamp lines are boundaries,
 * not displayed cues. Without a following boundary, the final end is estimated
 * at start + 5 seconds and can be edited by the operator.
 */
export function parseLrc(text: string): LyricCue[] {
  if (typeof text !== 'string') return [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const match = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i.exec(line);
    if (match && finite(Number(match[1]))) offset = Number(match[1]) / 1000;
  }
  const entries: TimedText[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let rest = line.trim();
    const starts: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = /^\[((?:\d+:){1,2}\d{2}(?:\.\d+)?)\]\s*/.exec(rest))) {
      const raw = readDuration(match[1]);
      if (raw !== null && finite(raw + offset)) starts.push(Math.max(0, raw + offset));
      rest = rest.slice(match[0].length);
    }
    for (const start of starts) {
      const key = JSON.stringify([start, rest]);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ start, text: rest, order: entries.length });
    }
  }
  entries.sort((a, b) => a.start - b.start || a.order - b.order);
  const cues: LyricCue[] = [];
  let next = entries.length;
  for (let i = 0; i < entries.length; i++) {
    if (i === 0 || entries[i].start !== entries[i - 1].start) {
      next = i + 1;
      while (next < entries.length && entries[next].start === entries[i].start) next++;
    }
    const entry = entries[i];
    if (!entry.text) continue;
    const end = next < entries.length ? entries[next].start : entry.start + 5;
    if (!finite(end) || end <= entry.start) continue;
    cues.push({ id: `lrc-${cues.length + 1}`, start: entry.start, end, text: entry.text });
  }
  return cues;
}

function validCue(cue: LyricCue): boolean {
  return !!cue && finite(cue.start) && cue.start >= 0 && finite(cue.end)
    && cue.end > cue.start && typeof cue.text === 'string';
}

function sortedCues(cues: LyricCue[]): LyricCue[] {
  return Array.isArray(cues)
    ? cues.filter(validCue).sort((a, b) => a.start - b.start)
    : [];
}

/** SRT intervals are authoritative and half-open; malformed/empty blocks are skipped. */
export function parseSrt(text: string): LyricCue[] {
  if (typeof text !== 'string') return [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n+/);
  const cues: LyricCue[] = [];
  const seen = new Set<string>();
  const stamp = '(\\d{2,}:\\d{2}:\\d{2}[,.]\\d{1,3})';
  const timing = new RegExp(`^${stamp}\\s+-->\\s+${stamp}(?:\\s+.*)?$`);
  for (const block of blocks) {
    const lines = block.split('\n');
    const line = /^\d+$/.test(lines[0]?.trim()) ? 1 : 0;
    const match = timing.exec(lines[line]?.trim() ?? '');
    if (!match) continue;
    const start = readDuration(match[1].replace(',', '.'));
    const end = readDuration(match[2].replace(',', '.'));
    const lyric = lines.slice(line + 1).join('\n').trim();
    if (start === null || end === null || end <= start || !lyric) continue;
    const key = JSON.stringify([start, end, lyric]);
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push({ id: `srt-${cues.length + 1}`, start, end, text: lyric });
  }
  return sortedCues(cues);
}

function lrcStamp(seconds: number): string {
  const ms = milliseconds(seconds);
  return `[${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}]`;
}

/**
 * Millisecond LRC, including blank end boundaries so gaps and the final end
 * survive reimport. LRC has no independent overlapping end times; use SRT for
 * that case. Multiline captions are flattened to one line. Invalid cues skip.
 */
export function exportLrc(cues: LyricCue[]): string {
  const sorted = sortedCues(cues);
  const events: { time: number; text: string; delta: number; order: number }[] = [];
  sorted.forEach((cue, order) => {
    const start = milliseconds(cue.start);
    const end = milliseconds(cue.end);
    if (end <= start) return;
    const text = cue.text.replace(/\r?\n/g, ' ').trim();
    if (!text) return;
    events.push({ time: start, text, delta: 1, order });
    events.push({ time: end, text: '', delta: -1, order });
  });
  events.sort((a, b) => a.time - b.time || b.delta - a.delta || a.order - b.order);
  const lines: string[] = [];
  let count = 0;
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    const texts = new Set<string>();
    while (i < events.length && events[i].time === time) {
      const event = events[i++];
      count += event.delta;
      if (event.text) texts.add(event.text);
    }
    const stamp = lrcStamp(time / 1000);
    if (texts.size) for (const text of texts) lines.push(`${stamp}${text}`);
    else if (count === 0) lines.push(stamp);
  }
  return lines.join('\n');
}

function srtStamp(seconds: number): string {
  const ms = milliseconds(seconds);
  const whole = Math.floor(ms / 1000);
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)},${pad(ms % 1000, 3)}`;
}

/** Export exact SRT intervals to millisecond precision, preserving multiline text. */
export function exportSrt(cues: LyricCue[]): string {
  return sortedCues(cues)
    .filter(cue => cue.text.trim() && milliseconds(cue.end) > milliseconds(cue.start))
    .map((cue, i) => `${i + 1}\n${srtStamp(cue.start)} --> ${srtStamp(cue.end)}\n${cue.text.replace(/\r\n?/g, '\n').trim()}`)
    .join('\n\n');
}

/**
 * Select from editable/unsorted cues using [start, end). In overlaps the latest
 * start wins, then the later input index. Returned index refers to the original
 * array. Empty instrumental cues are selectable; gaps return null/-1/0.
 */
export function activeCue(cues: LyricCue[], time: number): {
  cue: LyricCue | null; index: number; progress: number;
} {
  let index = -1;
  if (Array.isArray(cues) && finite(time) && time >= 0) {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (validCue(cue) && cue.start <= time && time < cue.end
          && (index < 0 || cue.start >= cues[index].start)) index = i;
    }
  }
  if (index < 0) return { cue: null, index: -1, progress: 0 };
  const cue = cues[index];
  return { cue, index, progress: clamp((time - cue.start) / (cue.end - cue.start), 0, 1) };
}

/** Strictly next beat-group boundary, including when already exactly on a beat. */
export function quantizeTime(time: number, bpm: number, beats = 1): number {
  if (!finite(time) || time < 0) return 0;
  if (!positive(bpm) || !positive(beats)) return time;
  const interval = 60 / bpm * beats;
  if (!positive(interval)) return time;
  const position = time / interval;
  if (!finite(position) || position >= Number.MAX_SAFE_INTEGER) return time;
  const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(position));
  const next = (Math.floor(position + tolerance) + 1) * interval;
  return finite(next) && next > time ? next : time;
}

/** Native clip seconds / target beat duration, bounded to safe media rates 0.25–4. */
export function calculatePlaybackRate(duration: number, bpm: number, beats: number): number {
  if (!positive(duration) || !positive(bpm) || !positive(beats)) return 1;
  const rate = duration / (60 / bpm * beats);
  if (positive(rate)) return clamp(rate, 0.25, 4);
  // Log space avoids overflow/underflow for extreme but finite positive inputs.
  const logRate = Math.log(duration) + Math.log(bpm) - Math.log(60) - Math.log(beats);
  return Math.exp(clamp(logRate, Math.log(0.25), Math.log(4)));
}

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const tagsOf = (asset: Asset): Set<string> => new Set(
  (Array.isArray(asset.tags) ? asset.tags : [])
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().toLowerCase()).filter(Boolean),
);

/** Weighted tag Jaccard (60%), energy (25%), circular hue (15%); ties use IDs. */
export function similarAssets(asset: Asset, assets: Asset[], limit = 8): Asset[] {
  if (!asset || !Array.isArray(assets) || !positive(limit)) return [];
  const sourceTags = tagsOf(asset);
  const unique = new Map<string, Asset>();
  for (const candidate of assets) {
    if (candidate && candidate.id !== asset.id && !unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }
  return Array.from(unique.values()).map(candidate => {
    const tags = tagsOf(candidate);
    const common = Array.from(tags).filter(tag => sourceTags.has(tag)).length;
    const union = sourceTags.size + tags.size - common;
    const tagScore = union ? common / union : 0;
    const energy = finite(asset.energy) && finite(candidate.energy)
      ? 1 - Math.abs(clamp(asset.energy, 0, 1) - clamp(candidate.energy, 0, 1)) : 0;
    let hue = 0;
    if (finite(asset.hue) && finite(candidate.hue)) {
      const a = (asset.hue % 360 + 360) % 360;
      const b = (candidate.hue % 360 + 360) % 360;
      const distance = Math.abs(a - b);
      hue = 1 - Math.min(distance, 360 - distance) / 180;
    }
    return { candidate, score: tagScore * 0.6 + energy * 0.25 + hue * 0.15 };
  }).sort((a, b) => b.score - a.score || compareText(a.candidate.id, b.candidate.id))
    .slice(0, Math.floor(limit)).map(item => item.candidate);
}

/** Tap estimator for 30–300 BPM, using the median of the last eight intervals. */
export class TapTempo {
  private lastTap: number | null = null;
  private intervals: number[] = [];

  tap(nowMs: number): number | null {
    if (!finite(nowMs) || nowMs < 0) return null;
    if (this.lastTap === null) {
      this.lastTap = nowMs;
      return null;
    }
    const interval = nowMs - this.lastTap;
    // Ignore double taps and backward clocks without poisoning the accepted tap.
    if (interval < 200) return null;
    if (interval > 2000) {
      this.reset();
      this.lastTap = nowMs;
      return null;
    }
    this.lastTap = nowMs;
    this.intervals.push(interval);
    if (this.intervals.length > 8) this.intervals.shift();
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.round(60000 / median * 10) / 10;
  }

  reset(): void {
    this.lastTap = null;
    this.intervals = [];
  }
}

/**
 * Timer-free transport. Call with one monotonic clock in milliseconds (such as
 * performance.now()); playback positions and nudge deltas are seconds. Absolute
 * anchors prevent accumulated frame drift. seek can also follow backing audio's
 * currentTime, while nudge adjusts a live performance. There is no implicit end
 * or loop. Invalid mutations are ignored; seek/nudge clamp at zero. Positive
 * finite rates are accepted, and a rate change preserves the current position.
 */
export class Transport {
  private anchorTime = 0;
  private anchorMs = 0;
  private running = false;
  private playbackRate = 1;

  get playing(): boolean { return this.running; }
  get rate(): number { return this.playbackRate; }

  getTime(nowMs: number): number {
    if (!this.running || !finite(nowMs)) return this.anchorTime;
    const elapsed = Math.max(0, nowMs - this.anchorMs) / 1000;
    return Math.min(Number.MAX_VALUE, this.anchorTime + elapsed * this.playbackRate);
  }

  seek(seconds: number, nowMs: number): void {
    if (!finite(seconds) || !finite(nowMs)) return;
    this.anchorTime = Math.max(0, seconds);
    this.anchorMs = nowMs;
  }

  play(nowMs: number): void {
    if (this.running || !finite(nowMs)) return;
    this.anchorMs = nowMs;
    this.running = true;
  }

  pause(nowMs: number): void {
    if (!this.running || !finite(nowMs)) return;
    this.seek(this.getTime(nowMs), nowMs);
    this.running = false;
  }

  nudge(seconds: number, nowMs: number): void {
    if (!finite(seconds) || !finite(nowMs)) return;
    this.seek(clamp(this.getTime(nowMs) + seconds, 0, Number.MAX_VALUE), nowMs);
  }

  setRate(rate: number, nowMs: number): void {
    if (!positive(rate) || !finite(nowMs)) return;
    this.seek(this.getTime(nowMs), nowMs);
    this.playbackRate = rate;
  }
}
