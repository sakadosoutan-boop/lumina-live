import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  SkipForward,
  SkipBack,
  Monitor,
  FolderOpen,
  Save,
  Plus,
  Search,
  Star,
  SlidersHorizontal,
  Music2,
  Layers,
  Keyboard,
  ChevronRight,
  ArrowLeftRight,
  Disc3,
  Radio,
  Mic,
  Download,
  Focus,
  Shuffle,
  Snowflake,
  EyeOff,
  Check,
  Settings2,
  X,
  Volume2,
  Activity,
} from "lucide-react";
import type {
  Asset,
  Deck,
  Song,
  Show,
  RenderState,
  RenderStats,
  LyricCue,
} from "./types";
import { builtInAssets } from "./catalog";
import { applyStagePreset, stagePresets } from "./presets";
import { PanelDivider, usePanelLayout } from "./PanelLayout";
import { defaultLayout } from "./layout";
import { planFolderLibrary } from "./folder-library";
import { downloadMediaBlob, mergeAssetCatalog } from "./media-library";
import { VJRenderer } from "./renderer";
import {
  Transport,
  TapTempo,
  distributeLyrics,
  parseDuration,
  formatTime,
  parseLrc,
  parseSrt,
  exportLrc,
  exportSrt,
  activeCue,
  quantizeTime,
  similarAssets,
} from "./sync";
import { AudioEngine, MidiInput } from "./audio";
import { timelineRate, beatAt, nextBeatTime, outputUrl } from "./live-clock";
import { generateProceduralThumbnails } from "./thumbnail";
import { OutputMediaBridge } from "./output-media";
import { createProgramChannel, type ProgramChannel } from "./channel";
import {
  downloadFile,
  storeMedia,
  restoreMedia,
  serializeShow,
  validateShow,
  revokeMediaUrls,
  validateAssetCatalog,
} from "./storage";

const uid = () => crypto.randomUUID();
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const deck = (assetId: string): Deck => ({
  assetId,
  opacity: 1,
  speed: 1,
  scale: 1,
  rotation: 0,
  mirror: false,
  beatSync: true,
  beats: 8,
  hue: 0,
  saturation: 1,
  brightness: 1,
  blend: "normal",
});
const example =
  "[instrumental:4]\n夜の向こうへ 手を伸ばす\nまだ知らない光を探して\nこの瞬間を 音に変えて\n僕らの空へ 響かせよう\n[instrumental:4]\n消えない声が 道になる\n何度でも ここから始めよう";
function makeSong(title = "Untitled song"): Song {
  return {
    id: uid(),
    title,
    bpm: 120,
    timelineBpm: 120,
    duration: 180,
    lyrics: example,
    cues: distributeLyrics(example, 180, 120),
    offset: 0,
    beatsPerBar: 4,
  };
}
function initialShow(): Show {
  return {
    version: 1,
    title: "Midnight Session",
    songs: [makeSong("01 / Beyond the Night")],
    assets: builtInAssets,
    decks: [
      deck(builtInAssets[0].id),
      deck(builtInAssets[10].id),
      { ...deck(builtInAssets[32].id), opacity: 0, blend: "screen" },
    ],
    crossfade: 0,
    master: 1,
    lyricStyle: {
      enabled: true,
      size: 64,
      position: 0.77,
      color: "#ffffff",
      align: "center",
      mode: "line",
      shadow: true,
    },
    fx: { glitch: 0, bloom: 0.15, vignette: 0.25, chromatic: 0, pixelate: 0 },
  };
}
const clock = (n: number) => formatTime(Math.floor(Math.max(0, n)));
type Snapshot = {
  type: "state";
  state: RenderState;
  sent: number;
  song: Song;
  rate: number;
  fps: number;
};
const baseState = (s: Show, song: Song): RenderState => ({
  time: 0,
  beat: 0,
  bpm: song.bpm,
  playing: false,
  decks: s.decks,
  crossfade: s.crossfade,
  master: s.master,
  blackout: false,
  freeze: false,
  fx: s.fx,
  lyric: "",
  lyricProgress: 0,
  lyricStyle: s.lyricStyle,
  audio: { low: 0, mid: 0, high: 0, level: 0 },
  width: 1280,
  height: 720,
});
function Output() {
  const canvas = useRef<HTMLCanvasElement>(null),
    everConnected = useRef(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const renderer = new VJRenderer(canvas.current!, builtInAssets);
    const bc = createProgramChannel(),
      mediaBridge = new OutputMediaBridge();
    let last: Snapshot | null = null,
      raf = 0,
      live = false,
      drawAt = 0;
    const receive = (data: any) => {
      if (data?.type === "assets" && Array.isArray(data.assets)) {
        renderer.setAssets(mediaBridge.restore(data.assets, data.blobs));
        const ack = { type: "assets-ready", version: data.version };
        bc.postMessage(ack);
        if (location.protocol === "file:") window.opener?.postMessage(ack, "*");
      }
      if (data?.type === "state") {
        last = data;
        everConnected.current = true;
      }
    };
    bc.onmessage = (e) => {
      if (location.protocol !== "file:") receive(e.data);
    };
    const message = (e: MessageEvent) => {
      if (location.protocol === "file:" && e.source === window.opener)
        receive(e.data);
    };
    window.addEventListener("message", message);
    const hello = () => {
      bc.postMessage({ type: "hello" });
      if (location.protocol === "file:")
        window.opener?.postMessage({ type: "hello" }, "*");
    };
    hello();
    const draw = (now: number) => {
      if (last && now - drawAt >= 1000 / (last.fps || 30) - 1) {
        drawAt = now;
        const age = Date.now() - last.sent,
          stale = age > 6000;
        const dt = last.state.playing && !stale ? Math.max(0, age) / 1000 : 0;
        const time = Math.min(
          last.song.duration,
          last.state.time + dt * (last.rate || 1),
        );
        const cue = activeCue(last.song.cues, time + last.song.offset);
        renderer.setTargetFps(last.fps || 30);
        renderer.render({
          ...last.state,
          time,
          beat: last.state.beat + (dt * last.state.bpm) / 60,
          blackout: stale || last.state.blackout,
          lyric: cue.cue?.text ?? "",
          lyricProgress: cue.progress,
        });
        if (live === stale) {
          live = !stale;
          setConnected(live);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const fullscreen = () =>
      void canvas.current?.requestFullscreen().catch(() => {});
    canvas.current!.addEventListener("dblclick", fullscreen);
    const retry = setInterval(() => {
      if (!last) hello();
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(retry);
      window.removeEventListener("message", message);
      bc.close();
      renderer.dispose();
      mediaBridge.dispose();
    };
  }, []);
  return (
    <main className="output-screen">
      <canvas ref={canvas} aria-label="プログラム出力" />
      {!connected && !everConnected.current && (
        <div className="output-wait">
          出力待機中 · 操作画面で出力を開始してください
        </div>
      )}
    </main>
  );
}
function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="range">
      <span>
        {label}
        <b>
          {unit === "%" ? Math.round(value * 100) : Number(value.toFixed(2))}
          {unit}
        </b>
      </span>
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Thumbnail({
  asset,
  thumbnail,
  selected,
  onClick,
  onFavorite,
}: {
  asset: Asset;
  thumbnail?: string;
  selected: boolean;
  onClick: () => void;
  onFavorite: () => void;
}) {
  return (
    <div className={"asset " + (selected ? "selected" : "")}>
      <button
        className="asset-select"
        onClick={onClick}
        aria-label={`素材 ${asset.name}`}
      >
        <div
          className={"asset-art " + (asset.visual ?? "video")}
          style={{ "--hue": asset.hue } as React.CSSProperties}
        >
          {thumbnail || asset.thumbnail ? (
            <img src={thumbnail || asset.thumbnail} loading="lazy" alt="" />
          ) : (
            <>
              <div className="art-lines" />
              <span className="art-type">
                {asset.kind === "procedural"
                  ? asset.visual?.toUpperCase()
                  : "VIDEO"}
              </span>
            </>
          )}
          <span className="asset-format">
            {asset.kind === "procedural"
              ? "GEN"
              : asset.duration
                ? clock(asset.duration)
                : "FILE"}
          </span>
        </div>
        <div className="asset-name">{asset.name}</div>
        <div className="asset-sub">
          {asset.kind === "procedural" ? "生成映像" : asset.license}{" "}
          <span>{asset.beats ? `${asset.beats} BEATS` : ""}</span>
        </div>
      </button>
      <button
        className={"favorite " + (asset.favorite ? "active" : "")}
        aria-label={`お気に入り ${asset.name}`}
        onClick={onFavorite}
      >
        <Star size={12} fill={asset.favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
export default function App() {
  return new URLSearchParams(location.search).has("output") ? (
    <Output />
  ) : (
    <Console />
  );
}
function Console() {
  const panels = usePanelLayout();
  const [libraryFocus, setLibraryFocus] = useState(false);
  const contentPanel = useRef<HTMLElement>(null);
  const modalPanel = useRef<HTMLElement>(null);
  const [show, setShow] = useState<Show>(initialShow);
  const [songId, setSongId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [blackout, setBlackout] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [mode, setMode] = useState<"live" | "audio">("live");
  const [resolution, setResolution] = useState(1280);
  const [fpsLimit, setFpsLimit] = useState(30);
  const [stats, setStats] = useState<RenderStats>({
    fps: 0,
    dropped: 0,
    mediaErrors: [],
  });
  const [levels, setLevels] = useState({ low: 0, mid: 0, high: 0, level: 0 });
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState("library");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [target, setTarget] = useState(0);
  const [selected, setSelected] = useState(builtInAssets[0].id);
  const [related, setRelated] = useState(false);
  const [page, setPage] = useState(0);
  const [quantum, setQuantum] = useState(4);
  const [autoBars, setAutoBars] = useState(0);
  const [transitionBeats, setTransitionBeats] = useState(4);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  useEffect(() => {
    contentPanel.current?.scrollTo({ top: 0 });
  }, [tab, page, search, category, related]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = modalPanel.current;
    panel?.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setModal("");
      } else if (event.key === "Tab" && panel) {
        const items = [
          ...panel.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [modal]);
  const [recording, setRecording] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [midiOn, setMidiOn] = useState(false);
  const [midiClock, setMidiClock] = useState(false);
  const [displayId, setDisplayId] = useState<number | undefined>();
  const [displays, setDisplays] = useState<
    { id: number; label: string; width: number; height: number }[]
  >([]);
  const [outputOn, setOutputOn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queueLabel, setQueueLabel] = useState("");
  const [cueEdit, setCueEdit] = useState(false);
  const [loopSong, setLoopSong] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryProgress, setLibraryProgress] = useState("");
  const folderInput = useRef<HTMLInputElement>(null);
  const libraryTransfer = useRef<AbortController | null>(null);
  useEffect(() => () => libraryTransfer.current?.abort(), []);
  const song = show.songs.find((s) => s.id === songId) ?? show.songs[0];
  const asset = show.assets.find((a) => a.id === selected) ?? show.assets[0];
  const cue = activeCue(song.cues, time + song.offset);
  const canvas = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    showInput = useRef<HTMLInputElement>(null),
    lyricInput = useRef<HTMLInputElement>(null),
    audioInput = useRef<HTMLInputElement>(null);
  const engine = useRef<VJRenderer | null>(null),
    audio = useRef(new AudioEngine()),
    midi = useRef(new MidiInput()),
    transport = useRef(new Transport()),
    tapper = useRef(new TapTempo()),
    bus = useRef<ProgramChannel | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    recordParts = useRef<Blob[]>([]),
    recordBytes = useRef(0),
    pending = useRef<{ at: number; slot: number; id: string } | null>(null),
    fade = useRef<{
      start: number;
      from: number;
      to: number;
      duration: number;
      waiting?: { slot: number; id: string; since: number };
    } | null>(null),
    beatAnchor = useRef({ time: 0, beat: 0, bpm: 120, rate: 1 }),
    outputWindow = useRef<Window | null>(null),
    outputMedia = useRef(new OutputMediaBridge()),
    autoIndex = useRef(-1),
    latest = useRef({
      show,
      song,
      playing,
      blackout,
      freeze,
      mode,
      resolution,
      fpsLimit,
      autoBars,
      quantum,
      transitionBeats,
      loopSong,
      midiClock,
      outputOn,
      recording,
    });
  latest.current = {
    show,
    song,
    playing,
    blackout,
    freeze,
    mode,
    resolution,
    fpsLimit,
    autoBars,
    quantum,
    transitionBeats,
    loopSong,
    midiClock,
    outputOn,
    recording,
  };
  useEffect(() => {
    const control = new AbortController();
    void generateProceduralThumbnails(builtInAssets, {
      signal: control.signal,
      onBatch: (batch) => setThumbnails((old) => new Map([...old, ...batch])),
    }).catch((e) => {
      if (!control.signal.aborted) console.warn("Thumbnail generation:", e);
    });
    return () => control.abort();
  }, []);
  const actions = useRef<(name: string, value?: number) => void>(() => {});
  const loadGeneration = useRef(0),
    assetVersion = useRef(0),
    previousAssets = useRef<Asset[]>([]),
    retiredAssets = useRef<Asset[]>([]);
  const releaseRetiredAssets = () => {
    revokeMediaUrls(retiredAssets.current, latest.current.show.assets);
    retiredAssets.current = [];
  };
  const acknowledgeAssets = (version: number) => {
    if (version === assetVersion.current) releaseRetiredAssets();
  };
  const announce = (s: string) => {
    setNotice(s);
  };
  const publish = (data: any) => {
    bus.current?.postMessage(data);
    const destination = outputWindow.current;
    if (location.protocol === "file:" && destination && !destination.closed) {
      if (data?.type === "assets")
        void outputMedia.current.package(data.assets).then((message) => {
          if (
            outputWindow.current === destination &&
            !destination.closed &&
            latest.current.show.assets === data.assets
          )
            destination.postMessage({ ...message, version: data.version }, "*");
        });
      else destination.postMessage(data, "*");
    }
  };
  const update = (patch: Partial<Show>) => setShow((s) => ({ ...s, ...patch }));
  const updateSong = (patch: Partial<Song>) =>
    setShow((s) => ({
      ...s,
      songs: s.songs.map((x) => (x.id === song.id ? { ...x, ...patch } : x)),
    }));
  const changeDeck = (i: number, patch: Partial<Deck>) =>
    setShow((s) => ({
      ...s,
      decks: s.decks.map((d, n) => (n === i ? { ...d, ...patch } : d)),
    }));
  const seek = (t: number) => {
    const next = clamp(t, 0, latest.current.song.duration);
    transport.current.seek(next, performance.now());
    beatAnchor.current = {
      time: 0,
      beat: 0,
      bpm: latest.current.song.bpm,
      rate: transport.current.rate,
    };
    if (latest.current.mode === "audio" && audio.current.element)
      audio.current.element.currentTime = next;
    setTime(next);
    pending.current = null;
    setQueueLabel("");
    autoIndex.current = -1;
  };
  const setBpm = (bpm: number) => {
    const c = latest.current,
      b = clamp(bpm, 20, 400),
      now = performance.now(),
      t = transport.current.getTime(now);
    const next = {
        ...c.song,
        bpm: b,
        timelineBpm: c.song.timelineBpm ?? c.song.bpm,
      },
      rate = timelineRate(next, c.mode);
    beatAnchor.current = {
      time: t,
      beat: beatAt(t, beatAnchor.current),
      bpm: b,
      rate,
    };
    transport.current.setRate(rate, now);
    updateSong({ bpm: b, timelineBpm: next.timelineBpm });
  };
  const play = async () => {
    if (latest.current.playing) {
      transport.current.pause(performance.now());
      audio.current.element?.pause();
      setPlaying(false);
      return;
    }
    if (latest.current.mode === "audio" && !audio.current.element) {
      announce("音源を読み込んでください");
      return;
    }
    try {
      if (
        transport.current.getTime(performance.now()) >=
        latest.current.song.duration - 0.01
      )
        seek(0);
      transport.current.setRate(
        timelineRate(latest.current.song, latest.current.mode),
        performance.now(),
      );
      await audio.current.init();
      if (latest.current.mode === "audio") await audio.current.element!.play();
      transport.current.play(performance.now());
      setPlaying(true);
      if ("wakeLock" in navigator)
        void navigator.wakeLock.request("screen").catch(() => {});
    } catch (e) {
      announce(`再生できません: ${String(e)}`);
    }
  };
  const tap = () => {
    const bpm = tapper.current.tap(performance.now());
    if (bpm) setBpm(Math.round(bpm * 10) / 10);
  };
  const cueJump = (delta: number) => {
    const c = latest.current;
    const a = activeCue(
      c.song.cues,
      transport.current.getTime(performance.now()) + c.song.offset,
    );
    const ix = clamp(a.index + delta, 0, c.song.cues.length - 1);
    if (c.song.cues[ix]) {
      if (c.mode === "audio") {
        seek(c.song.cues[ix].start - c.song.offset);
      } else {
        const now = transport.current.getTime(performance.now());
        updateSong({ offset: c.song.cues[ix].start - now });
      }
    }
  };
  const loadAsset = (id: string, slot = target) => {
    setSelected(id);
    const c = latest.current;
    const now = transport.current.getTime(performance.now());
    if (c.playing && c.quantum > 0) {
      pending.current = {
        id,
        slot,
        at: nextBeatTime(now, c.quantum, beatAnchor.current),
      };
      setQueueLabel(
        `${slot === 2 ? "C" : slot === 0 ? "A" : "B"} → 次の${c.quantum}拍`,
      );
    } else {
      const a = c.show.assets.find((a) => a.id === id);
      changeDeck(slot, { assetId: id, beats: a?.beats ?? 8 });
    }
  };
  const autoMix = () => {
    const from = latest.current.show.crossfade,
      to = from < 0.5 ? 1 : 0;
    fade.current = {
      start: performance.now(),
      from,
      to,
      duration:
        ((latest.current.transitionBeats * 60) / latest.current.song.bpm) *
        1000,
      waiting: {
        slot: to,
        id: latest.current.show.decks[to].assetId,
        since: performance.now(),
      },
    };
  };
  const save = async () => {
    try {
      const data = serializeShow(show);
      if (window.lumina) {
        if (!(await window.lumina.saveShow(data))) return;
      } else downloadFile(show.title + ".lumina.json", data);
      announce("セットを書き出しました");
    } catch (e) {
      announce(String(e));
    }
  };
  const openShow = async () => {
    if (window.lumina) {
      const data = await window.lumina.loadShow();
      if (data) await applyShow(data);
    } else showInput.current?.click();
  };
  const applyShow = async (raw: string) => {
    const generation = ++loadGeneration.current;
    try {
      const s = validateShow(raw);
      transport.current.pause(performance.now());
      transport.current.seek(0, performance.now());
      setPlaying(false);
      audio.current.stopInput();
      setAudioReady(false);
      s.assets = await restoreMedia(s.assets);
      if (generation !== loadGeneration.current) {
        revokeMediaUrls(s.assets, latest.current.show.assets);
        return;
      }
      setShow(s);
      setSaved(true);
      setSongId(s.songs[0].id);
      setTime(0);
      setSelected(s.assets[0].id);
      beatAnchor.current = {
        time: 0,
        beat: 0,
        bpm: s.songs[0].bpm,
        rate: timelineRate(s.songs[0], latest.current.mode),
      };
      transport.current.setRate(beatAnchor.current.rate, performance.now());
      pending.current = null;
      fade.current = null;
      autoIndex.current = -1;
      setQueueLabel("");
      setMicOn(false);
      announce(
        "セットを読み込みました。音源は必要に応じて再リンクしてください。",
      );
    } catch (e) {
      announce(String(e));
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Asset[] = [];
    for (const file of Array.from(files)) {
      if (!/^(video|image)\//.test(file.type)) {
        announce(`${file.name}: 未対応形式`);
        continue;
      }
      const existing = show.assets.find(
        (a) => a.name === file.name && a.bytes === file.size,
      );
      const id = existing?.id ?? uid();
      try {
        await storeMedia(id, file);
        added.push({
          id,
          name: file.name,
          kind: file.type.startsWith("video") ? "video" : "image",
          url: URL.createObjectURL(file),
          tags: ["imported"],
          hue: 210,
          energy: 0.5,
          license: "利用条件を確認してください",
          bytes: file.size,
          status: "local",
        });
      } catch {
        announce(
          "保存容量が足りないため取り込めません。空き容量を確認してください。",
        );
        break;
      }
    }
    setShow((s) => ({
      ...s,
      assets: [
        ...s.assets.filter((a) => !added.some((b) => a.id === b.id)),
        ...added,
      ],
    }));
    if (added.length) announce(`${added.length}本をローカルに保存しました`);
  };
  const importMedia = async () => {
    if (window.lumina) {
      try {
        const assets = await window.lumina.importMedia();
        setShow((s) => ({
          ...s,
          assets: [
            ...s.assets.filter((a) => !assets.some((b) => a.id === b.id)),
            ...assets,
          ],
        }));
        announce(`${assets.length}本を取り込みました`);
      } catch (e) {
        announce(String(e));
      }
    } else fileInput.current?.click();
  };
  const connectFolder = async (files: FileList | null) => {
    if (!files?.length || libraryBusy) return;
    setLibraryBusy(true);
    setLibraryProgress("フォルダーの素材を照合しています…");
    try {
      const plan = await planFolderLibrary(Array.from(files));
      const added = plan.entries.map(({ asset, file, thumbnail }) => ({
        ...asset,
        url: URL.createObjectURL(file),
        thumbnail: thumbnail ? URL.createObjectURL(thumbnail) : undefined,
        bytes: file.size,
        tags: [...new Set([...asset.tags, "folder-connected"])],
        status: "フォルダー接続・次回起動時に再接続",
      }));
      // This deliberately avoids making a second multi-gigabyte copy in IndexedDB.
      setShow((s) => ({
        ...s,
        assets: mergeAssetCatalog(s.assets, added, true),
      }));
      setCategory("folder-connected");
      setTab("library");
      setRelated(false);
      setLibraryProgress(
        `${added.length}本を接続しました${plan.missing ? `（未検出${plan.missing}本）` : ""}。次回は同じフォルダーを選び直してください。`,
      );
      announce(
        `${added.length}本をフォルダーから接続しました。動画のコピーやアップロードは行いません。`,
      );
    } catch (error) {
      setLibraryProgress(String(error));
    } finally {
      setLibraryBusy(false);
    }
  };
  const cacheOnlineMedia = async () => {
    if (libraryBusy || playing) return;
    const control = new AbortController();
    libraryTransfer.current = control;
    const pendingAssets = show.assets.filter(
      (a) =>
        a.tags.includes("web-library") && a.url && !a.url.startsWith("blob:"),
    );
    setLibraryBusy(true);
    let completed = 0;
    try {
      for (const a of pendingAssets) {
        control.signal.throwIfAborted();
        setLibraryProgress(
          `端末に保存中 ${completed + 1}/${pendingAssets.length} · ${a.name}`,
        );
        const blob = await downloadMediaBlob(a.url!, control.signal);
        control.signal.throwIfAborted();
        await storeMedia(a.id, blob);
        control.signal.throwIfAborted();
        if (!latest.current.show.assets.some((b) => b.id === a.id)) continue;
        const url = URL.createObjectURL(blob);
        setShow((s) => ({
          ...s,
          assets: s.assets.map((b) =>
            b.id === a.id ? { ...b, url, status: "端末に保存済み" } : b,
          ),
        }));
        completed++;
      }
      setLibraryProgress(
        `${completed}本を端末に保存しました。ブラウザーデータを消すと再保存が必要です。`,
      );
    } catch (error) {
      setLibraryProgress(
        `${completed}本まで保存済み。${control.signal.aborted ? "保存を中止しました。" : `保存を完了できませんでした。空き容量と通信を確認してください。 ${String(error)}`}`,
      );
    } finally {
      libraryTransfer.current = null;
      setLibraryBusy(false);
    }
  };
  const loadAudio = async (file?: File) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const loadingSongId = song.id;
      const el = await audio.current.load(url);
      transport.current.setRate(1, performance.now());
      beatAnchor.current = { time: 0, beat: 0, bpm: song.bpm, rate: 1 };
      el.addEventListener(
        "loadedmetadata",
        () => {
          if (audio.current.element !== el) return;
          setShow((s) => ({
            ...s,
            songs: s.songs.map((x) =>
              x.id === loadingSongId
                ? {
                    ...x,
                    audioUrl: url,
                    audioName: file.name,
                    duration: Number.isFinite(el.duration)
                      ? el.duration
                      : x.duration,
                  }
                : x,
            ),
          }));
        },
        { once: true },
      );
      el.addEventListener(
        "error",
        () => {
          setAudioReady(false);
          announce("音源をデコードできません");
        },
        { once: true },
      );
      updateSong({ audioUrl: url, audioName: file.name });
      setAudioReady(true);
      setMicOn(false);
      seek(0);
      setMode("audio");
      setPlaying(false);
      transport.current.pause(performance.now());
      announce("音源を読み込みました");
    } catch (e) {
      announce(String(e));
    }
  };
  const changeMode = (m: "live" | "audio") => {
    const now = performance.now(),
      t = transport.current.getTime(now),
      rate = timelineRate(song, m);
    transport.current.pause(now);
    audio.current.element?.pause();
    beatAnchor.current = {
      time: t,
      beat: beatAt(t, beatAnchor.current),
      bpm: song.bpm,
      rate,
    };
    transport.current.setRate(rate, now);
    setPlaying(false);
    setMode(m);
    if (m === "audio" && audio.current.element)
      audio.current.element.currentTime = t;
  };
  const connectMic = async () => {
    try {
      if (micOn) {
        audio.current.stopInput();
        setMicOn(false);
      } else {
        await audio.current.microphone();
        setMicOn(true);
        setAudioReady(false);
        changeMode("live");
        announce("マイク／ライン入力を映像反応に接続しました");
      }
    } catch (e) {
      announce(`入力を開始できません: ${String(e)}`);
    }
  };
  const record = () => {
    if (typeof MediaRecorder === "undefined") {
      announce("このブラウザーは録画に対応していません");
      return;
    }
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const mime = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      announce("このブラウザーは録画に対応していません");
      return;
    }
    try {
      const r = new MediaRecorder(canvas.current!.captureStream(fpsLimit), {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
      });
      recordParts.current = [];
      recordBytes.current = 0;
      r.ondataavailable = (e) => {
        if (e.data.size) {
          recordParts.current.push(e.data);
          recordBytes.current += e.data.size;
          if (
            recordBytes.current > 256 * 1024 * 1024 &&
            r.state === "recording"
          ) {
            r.stop();
            announce(
              "録画が256 MiBを超えたため停止しました。続きは録画を再開してください。",
            );
          }
        }
      };
      r.onstop = () => {
        downloadFile(
          `Lumina-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
          new Blob(recordParts.current, { type: mime }),
        );
        recordParts.current = [];
        r.stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      r.onerror = () => {
        setRecording(false);
        announce("録画中にエラーが発生しました");
      };
      r.start(1000);
      recorder.current = r;
      setRecording(true);
      announce("プログラム映像を録画中（音声なし）");
    } catch (e) {
      announce(String(e));
    }
  };
  const openOutput = async () => {
    try {
      if (window.lumina) await window.lumina.openOutput(displayId);
      else {
        const w = window.open(
          outputUrl(location.href),
          "lumina-output",
          "popup,width=1280,height=720",
        );
        if (!w) {
          announce("ポップアップを許可してください");
          return;
        }
        outputWindow.current = w;
      }
      setOutputOn(true);
      announce(
        "出力ウィンドウを開きました。ブラウザー版は投影先へ移動し、映像をダブルクリックで全画面にします。",
      );
    } catch (e) {
      announce(String(e));
    }
  };
  actions.current = (name, value = 1) => {
    if (name === "play" || name === "continue") {
      if (!latest.current.playing) void play();
    }
    if (name === "start") {
      seek(0);
      if (!latest.current.playing) void play();
    }
    if (name === "stop") {
      transport.current.pause(performance.now());
      audio.current.element?.pause();
      setPlaying(false);
    }
    if (name === "next") cueJump(1);
    if (name === "prev") cueJump(-1);
    if (name === "tap") tap();
    if (name === "blackout") setBlackout((v) => !v);
    if (name === "freeze") setFreeze((v) => !v);
    if (name === "crossfade") update({ crossfade: clamp(value) });
    if (name === "master") update({ master: clamp(value) });
    if (name === "clock" && latest.current.midiClock) setBpm(value);
    if (name === "auto") autoMix();
    if (name === "clip") {
      const a = latest.current.show.assets[value];
      if (a) loadAsset(a.id);
    }
  };
  useEffect(() => {
    let alive = true;
    const generation = ++loadGeneration.current;
    const init = async () => {
      let s: Show | null = null;
      try {
        const raw = localStorage.getItem("lumina-autosave");
        if (raw) {
          s = validateShow(raw);
          s.assets = await restoreMedia(s.assets);
        }
      } catch {
        announce(
          "前回の自動保存を復元できませんでした。セットファイルを読み込めます。",
        );
      }
      let imported: Asset[] = [];
      try {
        if (window.lumina) imported = await window.lumina.getAssets();
        else {
          const r = await fetch("./assets/catalog.json");
          if (r.ok) {
            const j = await r.json();
            imported = validateAssetCatalog(
              Array.isArray(j) ? j : (j.assets ?? []),
            );
          }
        }
      } catch {
        /* Local presets remain playable. */
      }
      if (alive && generation === loadGeneration.current) {
        setShow((old) => {
          const current = s ?? old;
          return {
            ...current,
            assets: mergeAssetCatalog(current.assets, imported),
          };
        });
        if (s) {
          const rate = timelineRate(s.songs[0], latest.current.mode);
          beatAnchor.current = { time: 0, beat: 0, bpm: s.songs[0].bpm, rate };
          transport.current.setRate(rate, performance.now());
        }
        setSaved(true);
      } else if (s) {
        revokeMediaUrls(s.assets, latest.current.show.assets);
      }
      if (window.lumina) void window.lumina.getDisplays().then(setDisplays);
    };
    void init();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem("lumina-autosave", serializeShow(show));
      } catch {
        announce("自動保存に失敗しました。セットを書き出してください。");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [show, saved]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const renderer = new VJRenderer(
      canvas.current!,
      latest.current.show.assets,
    );
    engine.current = renderer;
    const bc = createProgramChannel();
    bus.current = bc;
    bc.onmessage = (e) => {
      if (e.data.type === "hello") {
        setOutputOn(true);
        publish({
          type: "assets",
          assets: latest.current.show.assets,
          version: assetVersion.current,
        });
      }
      if (e.data.type === "assets-ready") acknowledgeAssets(e.data.version);
    };
    const hello = (e: MessageEvent) => {
      if (location.protocol === "file:" && e.source === outputWindow.current) {
        if (e.data?.type === "hello")
          publish({
            type: "assets",
            assets: latest.current.show.assets,
            version: assetVersion.current,
          });
        if (e.data?.type === "assets-ready") acknowledgeAssets(e.data.version);
      }
    };
    window.addEventListener("message", hello);
    let raf = 0,
      last = 0,
      lastUI = 0,
      lastBroadcast = 0;
    const tick = (now: number) => {
      const c = latest.current;
      let t =
        c.mode === "audio" && audio.current.element
          ? audio.current.element.currentTime
          : transport.current.getTime(now);
      if (c.mode === "audio") transport.current.seek(t, now);
      if (c.playing && t >= c.song.duration) {
        if (c.loopSong) {
          seek(0);
          t = 0;
          if (c.mode === "audio" && audio.current.element?.paused)
            void audio.current.element.play().catch(() => {
              setPlaying(false);
              announce("音源のループ再生を再開できません");
            });
        } else {
          transport.current.pause(now);
          audio.current.element?.pause();
          setPlaying(false);
          t = c.song.duration;
          transport.current.seek(t, now);
        }
      }
      if (pending.current && t >= pending.current.at) {
        const p = pending.current;
        pending.current = null;
        const a = c.show.assets.find((a) => a.id === p.id);
        changeDeck(p.slot, { assetId: p.id, beats: a?.beats ?? 8 });
        setQueueLabel("");
      }
      if (c.autoBars > 0 && c.playing) {
        const bar = Math.floor(
          beatAt(t, beatAnchor.current) / c.song.beatsPerBar / c.autoBars,
        );
        if (bar !== autoIndex.current) {
          if (autoIndex.current >= 0) {
            const slot = c.show.crossfade < 0.5 ? 1 : 0;
            const current = c.show.assets.find(
              (a) => a.id === c.show.decks[1 - slot].assetId,
            );
            if (current) {
              const candidates = similarAssets(
                current,
                c.show.assets.filter((a) => !a.tags.includes("manual-cue")),
                20,
              );
              const next = candidates[bar % Math.max(1, candidates.length)];
              if (next) {
                changeDeck(slot, { assetId: next.id, beats: next.beats ?? 8 });
                fade.current = {
                  start: now,
                  from: c.show.crossfade,
                  to: slot,
                  duration: ((c.transitionBeats * 60) / c.song.bpm) * 1000,
                  waiting: { slot, id: next.id, since: now },
                };
              }
            }
          }
          autoIndex.current = bar;
        }
      }
      if (now - last >= 1000 / c.fpsLimit - 1) {
        last = now;
        const a = audio.current.levels();
        const active = activeCue(c.song.cues, t + c.song.offset);
        const beat = beatAt(t, beatAnchor.current);
        const state: RenderState = {
          ...baseState(c.show, c.song),
          time: t,
          beat,
          bpm: c.song.bpm,
          playing: c.playing,
          blackout: c.blackout,
          freeze: c.freeze,
          lyric: active.cue?.text ?? "",
          lyricProgress: active.progress,
          audio: a,
          width: c.resolution,
          height: Math.round((c.resolution * 9) / 16),
        };
        renderer.setTargetFps(c.fpsLimit);
        const previewWidth =
          c.outputOn && !c.recording
            ? Math.min(960, c.resolution)
            : c.resolution;
        renderer.render({
          ...state,
          width: previewWidth,
          height: Math.round((previewWidth * 9) / 16),
        });
        if (fade.current) {
          const f = fade.current;
          if (f.waiting) {
            const w = f.waiting;
            if (
              c.show.decks[w.slot].assetId === w.id &&
              renderer.isDeckReady(w.slot)
            ) {
              f.start = now;
              f.waiting = undefined;
            } else if (now - w.since > 8000) {
              fade.current = null;
              announce(
                "次の映像の準備が完了しないため、現在の映像を保持しました。映像の診断を確認してください。",
              );
            }
          }
          if (!f.waiting && fade.current) {
            const p = clamp((now - f.start) / f.duration),
              v = f.from + (f.to - f.from) * (p * p * (3 - 2 * p));
            setShow((s) => ({ ...s, crossfade: v }));
            if (p >= 1) fade.current = null;
          }
        }
        if (now - lastBroadcast > 32) {
          publish({
            type: "state",
            state,
            song: c.song,
            sent: Date.now(),
            rate: transport.current.rate,
            fps: c.fpsLimit,
          } satisfies Snapshot);
          lastBroadcast = now;
        }
        if (now - lastUI > 100) {
          setTime(t);
          setLevels(a);
          setStats(renderer.getStats());
          lastUI = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const keep = setInterval(() => {
      if (document.hidden) {
        const c = latest.current,
          t =
            c.mode === "audio" && audio.current.element
              ? audio.current.element.currentTime
              : transport.current.getTime(performance.now());
        const active = activeCue(c.song.cues, t + c.song.offset);
        publish({
          type: "state",
          state: {
            ...baseState(c.show, c.song),
            time: t,
            beat: beatAt(t, beatAnchor.current),
            playing: c.playing,
            blackout: c.blackout,
            freeze: c.freeze,
            lyric: active.cue?.text ?? "",
            lyricProgress: active.progress,
            width: c.resolution,
            height: Math.round((c.resolution * 9) / 16),
          },
          song: c.song,
          sent: Date.now(),
          rate: transport.current.rate,
          fps: c.fpsLimit,
        });
      }
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(keep);
      window.removeEventListener("message", hello);
      bc.close();
      renderer.dispose();
      outputMedia.current.dispose();
      audio.current.dispose();
      midi.current.dispose();
      loadGeneration.current++;
      revokeMediaUrls([
        ...latest.current.show.assets,
        ...retiredAssets.current,
      ]);
      retiredAssets.current = [];
    };
  }, []);
  useLayoutEffect(() => {
    retiredAssets.current.push(...previousAssets.current);
    previousAssets.current = show.assets;
    engine.current?.setAssets(show.assets);
    publish({
      type: "assets",
      assets: show.assets,
      version: ++assetVersion.current,
    });
    if (!latest.current.outputOn || outputWindow.current?.closed)
      releaseRetiredAssets();
  }, [show.assets]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        modal ||
        e.defaultPrevented ||
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable],[role='separator']",
        )
      )
        return;
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (
        [" ", "arrowright", "arrowleft", "arrowup", "arrowdown"].includes(k) &&
        (e.target as HTMLElement)?.closest("button,a,[data-scroll-region]")
      )
        return;
      if ([" ", "arrowright", "arrowleft", "arrowup", "arrowdown"].includes(k))
        e.preventDefault();
      if (k === " ") void play();
      if (k === "b") setBlackout((v) => !v);
      if (k === "f") setFreeze((v) => !v);
      if (k === "t") tap();
      if (k === "arrowright") cueJump(1);
      if (k === "arrowleft") cueJump(-1);
      if (k === "arrowup") updateSong({ offset: song.offset + 60 / song.bpm });
      if (k === "arrowdown")
        updateSong({ offset: song.offset - 60 / song.bpm });
      if (k === "a") {
        fade.current = null;
        update({ crossfade: 0 });
      }
      if (k === "d") {
        fade.current = null;
        update({ crossfade: 1 });
      }
      if (k === "x") autoMix();
      if (k === "escape") setModal("");
      if (k === "?") setModal("help");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    midi.current.onAction = (a, v) => actions.current(a, v);
    return window.lumina?.onRemote((event) => {
      const name = event.address.replace("/lumina/", "");
      if (name === "blackout" && event.args.length)
        setBlackout(!!event.args[0]);
      else actions.current(name, event.args[0]);
    });
  }, []);
  const filtered = useMemo(() => {
    let list =
      related && asset ? similarAssets(asset, show.assets, 48) : show.assets;
    const q = search.toLowerCase();
    return list.filter(
      (a) =>
        (category === "all" ||
          (category === "favorites" && a.favorite) ||
          (category === "video" && a.kind === "video") ||
          (category === "procedural" && a.kind === "procedural") ||
          a.tags.includes(category)) &&
        (!q ||
          `${a.name} ${a.tags.join(" ")} ${a.license}`
            .toLowerCase()
            .includes(q)),
    );
  }, [show.assets, search, category, related, selected]);
  useEffect(() => setPage(0), [search, category, related]);
  useEffect(
    () =>
      setPage((p) =>
        Math.min(p, Math.max(0, Math.ceil(filtered.length / 24) - 1)),
      ),
    [filtered.length],
  );
  const switchSong = (id: string) => {
    transport.current.pause(performance.now());
    audio.current.stopInput();
    setAudioReady(false);
    setMicOn(false);
    setPlaying(false);
    setSongId(id);
    transport.current.seek(0, performance.now());
    setTime(0);
    beatAnchor.current = {
      time: 0,
      beat: 0,
      bpm: show.songs.find((s) => s.id === id)?.bpm ?? 120,
      rate: timelineRate(
        show.songs.find((s) => s.id === id) ?? { bpm: 120 },
        mode,
      ),
    };
    transport.current.setRate(beatAnchor.current.rate, performance.now());
    fade.current = null;
    autoIndex.current = -1;
    pending.current = null;
    setQueueLabel("");
  };
  const stampCue = (id: string) => {
    const at = time + song.offset;
    const cues = song.cues
      .map((c) =>
        c.id === id ? { ...c, start: Math.max(0, at), section: "manual" } : c,
      )
      .sort((a, b) => a.start - b.start)
      .map((c, i, arr) => ({ ...c, end: arr[i + 1]?.start ?? song.duration }));
    updateSong({ cues });
  };
  return (
    <div
      className={"console tab-" + tab + (libraryFocus ? " library-focus" : "")}
      style={panels.style}
    >
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <b>
            LUMINA<span>LIVE</span>
          </b>
        </a>
        <div className="show-title">
          <span className="tiny">SHOW FILE</span>
          <input
            aria-label="セット名"
            value={show.title}
            onChange={(e) => update({ title: e.target.value })}
          />
          <span className="saved">
            <Check size={10} /> {saved ? "自動保存" : "読み込み中"}
          </span>
        </div>
        <div className="top-actions">
          <button onClick={() => void openShow()} aria-label="セットを開く">
            <FolderOpen size={16} />
          </button>
          <button onClick={() => void save()} aria-label="セット保存">
            <Save size={16} />
          </button>
          <span className="divider" />
          <button
            aria-label="画面レイアウト"
            title="パネルとサムネイルの大きさ"
            onClick={() => setModal("layout")}
          >
            <SlidersHorizontal size={16} />
            <span>レイアウト</span>
          </button>
          <button onClick={() => setModal("settings")}>
            <Settings2 size={16} />
            <span>接続・出力</span>
          </button>
          <button className="output-button" onClick={() => void openOutput()}>
            <Monitor size={16} />
            {outputOn ? "出力を表示" : "外部出力"}
            <ChevronRight size={14} />
          </button>
        </div>
      </header>
      <section className="transport">
        <div className="song-select">
          <Music2 size={17} />
          <select
            aria-label="現在の曲"
            value={song.id}
            onChange={(e) => switchSong(e.target.value)}
          >
            {show.songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <button
            aria-label="曲を追加"
            onClick={() => {
              const s = makeSong(`0${show.songs.length + 1} / New song`);
              update({ songs: [...show.songs, s] });
              switchSong(s.id);
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="transport-buttons">
          <button onClick={() => seek(0)} aria-label="先頭へ">
            <SkipBack size={17} />
          </button>
          <button
            className={"play " + (playing ? "running" : "")}
            onClick={() => void play()}
            aria-label={playing ? "一時停止" : "再生"}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <button
            onClick={() => {
              transport.current.pause(performance.now());
              audio.current.element?.pause();
              setPlaying(false);
              seek(0);
            }}
            aria-label="停止"
          >
            <Square size={15} />
          </button>
        </div>
        <div className="time-display">
          <b>{clock(time)}</b>
          <span>/ {clock(song.duration)}</span>
        </div>
        <div className="bpm-control">
          <label>
            BPM
            <input
              aria-label="BPM"
              type="number"
              min="20"
              max="400"
              step=".1"
              value={song.bpm}
              onChange={(e) => setBpm(Number(e.target.value) || 120)}
            />
          </label>
          <button onClick={tap}>
            TAP <kbd>T</kbd>
          </button>
        </div>
        <div className="beat-indicators">
          {Array.from({ length: song.beatsPerBar }, (_, i) => (
            <i
              className={
                playing &&
                ((Math.floor(beatAt(time, beatAnchor.current)) %
                  song.beatsPerBar) +
                  song.beatsPerBar) %
                  song.beatsPerBar ===
                  i
                  ? "on"
                  : ""
              }
              key={i}
            />
          ))}
        </div>
        <select
          className="sync-mode"
          aria-label="同期方式"
          value={mode}
          onChange={(e) => changeMode(e.target.value as "live" | "audio")}
        >
          <option value="live">LIVE · 手動補正</option>
          <option value="audio">AUDIO · 音源同期</option>
        </select>
        <button
          className={blackout ? "danger active" : "danger"}
          onClick={() => setBlackout((v) => !v)}
        >
          <EyeOff size={14} />
          BLACKOUT <kbd>B</kbd>
        </button>
      </section>
      <div className="workspace" ref={panels.workspace.ref}>
        <aside
          className="sidebar"
          id="workspace-sidebar"
          aria-label="素材の分類"
          tabIndex={0}
          data-scroll-region
        >
          <div className="nav-label">WORKSPACE</div>
          {[
            { id: "library", label: "素材ライブラリ", icon: Layers },
            { id: "lyrics", label: "歌詞・タイムライン", icon: Music2 },
            { id: "setlist", label: "セットリスト", icon: Disc3 },
          ].map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav active" : "nav"}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={17} />
              {n.label}
              {n.id === "library" && <small>{show.assets.length}</small>}
            </button>
          ))}
          <div className="nav-label lower">COLLECTIONS</div>
          {[
            { id: "all", label: "すべての素材" },
            { id: "favorites", label: "お気に入り" },
            { id: "procedural", label: "生成パターン" },
            { id: "video", label: "動画ファイル" },
            { id: "ambient", label: "Ambient / 浮遊" },
            { id: "geometric", label: "Geometry / 幾何学" },
            { id: "nature", label: "Nature / 自然" },
            { id: "glitch", label: "Glitch / 信号" },
            { id: "halloween", label: "Halloween / ハロウィン" },
            { id: "web-library", label: "オンライン素材" },
            { id: "folder-connected", label: "接続したフォルダー" },
          ].map((n) => (
            <button
              key={n.id}
              className={"collection " + (category === n.id ? "active" : "")}
              onClick={() => {
                setCategory(n.id);
                setTab("library");
                setRelated(false);
              }}
            >
              <i />
              {n.label}
            </button>
          ))}
          <div className="sidebar-bottom">
            <div className="offline">
              <i />
              LOCAL ENGINE
            </div>
            <p>オフライン再生対応</p>
            <button onClick={() => setModal("help")}>
              <Keyboard size={15} /> 操作ガイド <kbd>?</kbd>
            </button>
          </div>
        </aside>
        <PanelDivider
          name="サイドバーの幅"
          controls="workspace-sidebar"
          axis="x"
          value={panels.sides.sidebar}
          min={120}
          max={Math.min(
            280,
            panels.workspace.width - 476 - panels.sides.lyrics,
          )}
          onChange={(v) => panels.set("sidebar", v)}
          onReset={() => panels.set("sidebar", defaultLayout.sidebar)}
        />
        <main className="main" ref={panels.main.ref}>
          <section className="performance">
            <div className="monitor-panel" id="preview-panel">
              <div className="panel-head">
                <span>
                  <i className={playing ? "live-dot on" : "live-dot"} />
                  PROGRAM MONITOR
                </span>
                <div>
                  <span className="muted">
                    {resolution} × {Math.round((resolution * 9) / 16)}
                  </span>
                  <button
                    className={recording ? "rec active" : "rec"}
                    onClick={record}
                  >
                    <i /> {recording ? "STOP REC" : "REC"}
                  </button>
                  <button
                    aria-label="映像を全画面でプレビュー"
                    onClick={() => void canvas.current?.requestFullscreen()}
                  >
                    <Focus size={14} />
                  </button>
                </div>
              </div>
              <div className="monitor">
                <canvas ref={canvas} aria-label="プログラムプレビュー" />
                {blackout && <div className="blackout-label">BLACKOUT</div>}
                {freeze && (
                  <div className="freeze-label">
                    <Snowflake size={13} /> FREEZE
                  </div>
                )}
                <div className="monitor-corners">
                  <span>PGM</span>
                  <span>{playing ? "LIVE" : "STANDBY"}</span>
                </div>
              </div>
              <div className="monitor-footer">
                <div className="signal">
                  <Activity size={13} />
                  <span className={stats.fps < 24 && playing ? "warn" : ""}>
                    {Math.round(stats.fps)} FPS
                  </span>
                  <span>{stats.dropped} late</span>
                </div>
                <div className="mini-meter">
                  <span>IN</span>
                  {Array.from({ length: 18 }, (_, i) => (
                    <i
                      key={i}
                      className={i / 18 < levels.level * 2 ? "lit" : ""}
                    />
                  ))}
                </div>
                <button
                  className={freeze ? "active" : ""}
                  onClick={() => setFreeze((v) => !v)}
                >
                  <Snowflake size={12} />
                  FREEZE <kbd>F</kbd>
                </button>
              </div>
            </div>
            <PanelDivider
              name="プレビューの幅"
              controls="preview-panel"
              axis="x"
              value={panels.monitor}
              min={Math.max(190, (panels.main.width - 12) * 0.25)}
              max={Math.min(
                panels.main.width - 222,
                (panels.main.width - 12) * 0.75,
              )}
              onChange={(v) =>
                panels.set("monitor", v / Math.max(1, panels.main.width - 12))
              }
              onReset={() => panels.set("monitor", defaultLayout.monitor)}
            />
            <div
              className="mixer"
              aria-label="ライブミキサー"
              tabIndex={0}
              data-scroll-region
            >
              <div className="panel-head">
                <span>
                  <SlidersHorizontal size={13} /> LIVE MIXER
                </span>
                <button onClick={() => setModal("effects")}>
                  FX <ChevronRight size={13} />
                </button>
              </div>
              <div className="deck-tabs">
                {show.decks.map((d, i) => (
                  <button
                    className={target === i ? "active" : ""}
                    key={i}
                    onClick={() => setTarget(i)}
                  >
                    <b>{"ABC"[i]}</b>
                    <span>{i === 2 ? "OVERLAY" : "DECK " + "AB"[i]}</span>
                    <i
                      style={{
                        background: `hsl(${show.assets.find((a) => a.id === d.assetId)?.hue ?? 180} 80% 65%)`,
                      }}
                    />
                  </button>
                ))}
              </div>
              <div className="deck-loaded">
                <span className="tiny">LOADED IN {"ABC"[target]}</span>
                <b>
                  {show.assets.find((a) => a.id === show.decks[target].assetId)
                    ?.name ?? "Missing media"}
                </b>
              </div>
              <div className="deck-ranges">
                <Range
                  label="レイヤー不透明度"
                  value={show.decks[target].opacity}
                  unit="%"
                  onChange={(v) => changeDeck(target, { opacity: v })}
                />
                <Range
                  label="再生スピード"
                  value={show.decks[target].speed}
                  min={0.25}
                  max={4}
                  step={0.25}
                  unit="×"
                  onChange={(v) => changeDeck(target, { speed: v })}
                />
              </div>
              <div className="deck-options">
                <label>
                  <input
                    type="checkbox"
                    checked={show.decks[target].beatSync}
                    onChange={(e) =>
                      changeDeck(target, { beatSync: e.target.checked })
                    }
                  />
                  BPM SYNC
                </label>
                <select
                  aria-label="ループ拍数"
                  value={show.decks[target].beats}
                  onChange={(e) =>
                    changeDeck(target, { beats: Number(e.target.value) })
                  }
                >
                  {[1, 2, 4, 8, 16, 32, 64].map((v) => (
                    <option value={v} key={v}>
                      {v} beats
                    </option>
                  ))}
                </select>
                <button onClick={() => setModal("deck")}>
                  <Settings2 size={14} />
                </button>
              </div>
              <div className="crossfader">
                <div>
                  <b>A</b>
                  <span>CROSSFADE</span>
                  <b>B</b>
                </div>
                <input
                  aria-label="クロスフェーダー"
                  type="range"
                  min="0"
                  max="1"
                  step=".001"
                  value={show.crossfade}
                  onChange={(e) => {
                    fade.current = null;
                    update({ crossfade: Number(e.target.value) });
                  }}
                />
                <div className="mix-actions">
                  <button
                    onClick={() => {
                      fade.current = null;
                      update({ crossfade: 0 });
                    }}
                  >
                    CUT A
                  </button>
                  <button className="auto-mix" onClick={autoMix}>
                    <ArrowLeftRight size={13} />
                    AUTO {transitionBeats}拍
                  </button>
                  <button
                    onClick={() => {
                      fade.current = null;
                      update({ crossfade: 1 });
                    }}
                  >
                    CUT B
                  </button>
                </div>
              </div>
              <Range
                label="MASTER OUT"
                value={show.master}
                unit="%"
                onChange={(v) => update({ master: v })}
              />
              <div className="mix-status">
                {queueLabel || "次の素材を選択してデッキにロード"}
              </div>
            </div>
          </section>
          <PanelDivider
            name="プレビューと素材一覧の高さ"
            controls="preview-panel library-panel"
            axis="y"
            className="library-divider"
            value={panels.preview}
            min={Math.max(140, panels.main.height * 0.18)}
            max={Math.min(panels.main.height - 210, panels.main.height * 0.7)}
            onChange={(v) =>
              panels.set("preview", v / Math.max(1, panels.main.height))
            }
            onReset={() => panels.set("preview", defaultLayout.preview)}
          />
          <section
            className="content-panel"
            id="library-panel"
            ref={contentPanel}
            aria-label={
              tab === "library"
                ? "素材一覧"
                : tab === "lyrics"
                  ? "歌詞編集"
                  : "セットリスト編集"
            }
            tabIndex={0}
            data-scroll-region
          >
            {tab === "library" ? (
              <>
                <div className="preset-bar">
                  <label htmlFor="stage-preset">映像プリセット</label>
                  <select
                    id="stage-preset"
                    value=""
                    aria-label="映像プリセット（即時適用）"
                    onChange={(e) => {
                      const preset = stagePresets.find(
                        (p) => p.id === e.target.value,
                      );
                      if (!preset) return;
                      fade.current = null;
                      pending.current = null;
                      autoIndex.current = -1;
                      setAutoBars(0);
                      setQueueLabel("");
                      setShow((s) => applyStagePreset(s, preset));
                      setTarget(0);
                      setSelected(preset.decks[0].assetId);
                      announce(`${preset.name}を適用 · ${preset.description}`);
                    }}
                  >
                    <option value="" disabled>
                      選んですぐに切り替え
                    </option>
                    {stagePresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span>内蔵映像だけで再生できます</span>
                  <button
                    className="library-focus-button"
                    aria-pressed={libraryFocus}
                    onClick={() => setLibraryFocus((v) => !v)}
                  >
                    <Focus size={15} />
                    {libraryFocus ? "プレビューを戻す" : "素材を広く表示"}
                  </button>
                </div>
                <div className="library-toolbar">
                  <div>
                    <h2>
                      素材ライブラリ <small>{filtered.length}</small>
                    </h2>
                    <p>クリックでデッキ {"ABC"[target]} にロード</p>
                  </div>
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label="素材検索"
                      placeholder="名前・タグ・カラーで検索"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button
                    className={related ? "active" : ""}
                    onClick={() => setRelated((v) => !v)}
                  >
                    <Shuffle size={14} />
                    類似素材
                  </button>
                  <button onClick={() => void importMedia()}>
                    <Plus size={15} />
                    取り込む
                  </button>
                  <button onClick={() => setModal("library")}>
                    <FolderOpen size={15} />
                    素材管理
                  </button>
                </div>
                <div className="library-access">
                  <button
                    className={category === "halloween" ? "active" : ""}
                    onClick={() => {
                      setCategory(
                        category === "halloween" ? "all" : "halloween",
                      );
                      setRelated(false);
                    }}
                  >
                    ハロウィン
                  </button>
                  <span>
                    {
                      show.assets.filter((a) => a.tags.includes("web-library"))
                        .length
                    }
                    本のオンライン素材 ·{" "}
                    {
                      show.assets.filter((a) =>
                        a.tags.includes("folder-connected"),
                      ).length
                    }
                    本のフォルダー素材
                  </span>
                  {show.assets.some((a) => a.tags.includes("web-library")) && (
                    <a
                      href="./assets/credits.txt"
                      target="_blank"
                      rel="noreferrer"
                    >
                      素材クレジット
                    </a>
                  )}
                  {libraryBusy && (
                    <button onClick={() => setModal("library")}>
                      保存状況を見る
                    </button>
                  )}
                </div>
                <div className="library-settings">
                  <div>
                    <span>切替タイミング</span>
                    <select
                      aria-label="素材切替クオンタイズ"
                      value={quantum}
                      onChange={(e) => setQuantum(Number(e.target.value))}
                    >
                      <option value={0}>即時</option>
                      <option value={1}>次の拍</option>
                      <option value={4}>次の4拍</option>
                      <option value={8}>次の8拍</option>
                    </select>
                  </div>
                  <div>
                    <span>AUTO VJ</span>
                    <select
                      aria-label="自動VJ"
                      value={autoBars}
                      onChange={(e) => {
                        setAutoBars(Number(e.target.value));
                        autoIndex.current = -1;
                      }}
                    >
                      <option value={0}>OFF</option>
                      {[2, 4, 8, 16].map((v) => (
                        <option value={v} key={v}>
                          {v}小節ごと
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="thumbnail-size">
                    サムネイル
                    <input
                      type="range"
                      aria-label="サムネイルの大きさ"
                      min={140}
                      max={320}
                      step={10}
                      value={panels.layout.thumbnail}
                      onChange={(e) =>
                        panels.set("thumbnail", Number(e.target.value))
                      }
                    />
                  </label>
                  <span className="muted">
                    {filtered.length ? page * 24 + 1 : 0}–
                    {Math.min((page + 1) * 24, filtered.length)} /{" "}
                    {filtered.length}
                  </span>
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    前
                  </button>
                  <button
                    disabled={(page + 1) * 24 >= filtered.length}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    次
                  </button>
                </div>
                <div className="asset-grid">
                  {filtered.slice(page * 24, (page + 1) * 24).map((a) => (
                    <Thumbnail
                      key={a.id}
                      asset={a}
                      thumbnail={thumbnails.get(a.id)}
                      selected={a.id === selected}
                      onClick={() => loadAsset(a.id)}
                      onFavorite={() =>
                        setShow((s) => ({
                          ...s,
                          assets: s.assets.map((x) =>
                            x.id === a.id ? { ...x, favorite: !x.favorite } : x,
                          ),
                        }))
                      }
                    />
                  ))}
                </div>
                {!filtered.length && (
                  <div className="empty">
                    条件に合う素材がありません。検索条件を変えるか、動画を取り込んでください。
                  </div>
                )}
                <div className="asset-details">
                  <b>{asset?.name}</b>
                  <span>{asset?.license}</span>
                  <button onClick={() => setModal("asset")}>
                    出典・利用条件 <ChevronRight size={12} />
                  </button>
                </div>
              </>
            ) : tab === "lyrics" ? (
              <>
                <div className="library-toolbar">
                  <div>
                    <h2>歌詞・タイムライン</h2>
                    <p>歌詞＋長さ＋BPMで推定配置 → リハーサルで調整</p>
                  </div>
                  <button onClick={() => lyricInput.current?.click()}>
                    <FolderOpen size={14} />
                    LRC / SRT
                  </button>
                  <button
                    onClick={() =>
                      downloadFile(
                        song.title + ".lrc",
                        exportLrc(song.cues),
                        "text/plain",
                      )
                    }
                  >
                    LRC保存
                  </button>
                  <button
                    onClick={() =>
                      downloadFile(
                        song.title + ".srt",
                        exportSrt(song.cues),
                        "text/plain",
                      )
                    }
                  >
                    SRT保存
                  </button>
                </div>
                <div className="lyric-editor">
                  <div>
                    <label className="field">
                      歌詞（1行＝1キュー）
                      <textarea
                        aria-label="歌詞入力"
                        value={song.lyrics}
                        onChange={(e) => updateSong({ lyrics: e.target.value })}
                      />
                    </label>
                    <p className="muted">
                      [instrumental:4]
                      は4小節の間奏です。自動配置は歌唱位置の推定で、音源解析ではありません。
                    </p>
                    <div className="form-row">
                      <label className="field">
                        曲の長さ
                        <input
                          aria-label="曲の長さ"
                          defaultValue={clock(song.duration)}
                          key={song.id + song.duration}
                          onBlur={(e) => {
                            const d = parseDuration(e.target.value);
                            if (d > 0) updateSong({ duration: d });
                            else e.target.value = clock(song.duration);
                          }}
                        />
                      </label>
                      <label className="field">
                        拍子
                        <select
                          value={song.beatsPerBar}
                          onChange={(e) =>
                            updateSong({ beatsPerBar: Number(e.target.value) })
                          }
                        >
                          {[3, 4, 5, 6, 7].map((n) => (
                            <option key={n} value={n}>
                              {n}拍 / 小節
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      className="primary wide"
                      onClick={() => {
                        updateSong({
                          cues: distributeLyrics(
                            song.lyrics,
                            song.duration,
                            song.bpm,
                            song.beatsPerBar,
                          ),
                          offset: 0,
                          timelineBpm: song.bpm,
                        });
                        transport.current.setRate(1, performance.now());
                        beatAnchor.current = {
                          time,
                          beat: beatAt(time, beatAnchor.current),
                          bpm: song.bpm,
                          rate: 1,
                        };
                        announce(
                          "歌詞を推定配置しました。歌い出しと間奏を確認してください。",
                        );
                      }}
                    >
                      <Activity size={15} />
                      歌詞を自動配置
                    </button>
                    <button
                      className="wide"
                      onClick={() => audioInput.current?.click()}
                    >
                      <Music2 size={15} />
                      {audioReady ? song.audioName : "同期用音源を読み込む"}
                    </button>
                  </div>
                  <div className="cue-editor-list">
                    {song.cues.map((c, i) => (
                      <div
                        className={
                          "cue-edit-row " + (cue.index === i ? "current" : "")
                        }
                        key={c.id}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <input
                          aria-label={`歌詞${i + 1}開始秒`}
                          type="number"
                          min="0"
                          step=".01"
                          value={Number(c.start.toFixed(2))}
                          onChange={(e) => {
                            const start = clamp(
                              Number(e.target.value),
                              0,
                              song.duration,
                            );
                            updateSong({
                              cues: song.cues.map((x) =>
                                x.id === c.id
                                  ? {
                                      ...x,
                                      start,
                                      end: Math.max(start + 0.1, x.end),
                                      section: "manual",
                                    }
                                  : x,
                              ),
                            });
                          }}
                        />
                        <input
                          aria-label={`歌詞${i + 1}終了秒`}
                          type="number"
                          min="0"
                          step=".01"
                          value={Number(c.end.toFixed(2))}
                          onChange={(e) =>
                            updateSong({
                              cues: song.cues.map((x) =>
                                x.id === c.id
                                  ? {
                                      ...x,
                                      end: Math.max(
                                        x.start,
                                        Number(e.target.value),
                                      ),
                                      section: "manual",
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                        <span className="cue-text">{c.text || "間奏"}</span>
                        <button onClick={() => stampCue(c.id)}>今を記録</button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="library-toolbar">
                  <div>
                    <h2>セットリスト</h2>
                    <p>曲の切替は停止状態で行います</p>
                  </div>
                  <button
                    onClick={() =>
                      update({
                        songs: [
                          ...show.songs,
                          makeSong(`New song ${show.songs.length + 1}`),
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    曲を追加
                  </button>
                </div>
                <div className="setlist">
                  {show.songs.map((s, i) => (
                    <div
                      className={
                        "setlist-row " + (s.id === song.id ? "current" : "")
                      }
                      key={s.id}
                    >
                      <b>{String(i + 1).padStart(2, "0")}</b>
                      <input
                        aria-label={`曲${i + 1}名前`}
                        value={s.title}
                        onChange={(e) =>
                          update({
                            songs: show.songs.map((x) =>
                              x.id === s.id
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                      <span>{s.bpm} BPM</span>
                      <span>{clock(s.duration)}</span>
                      <button onClick={() => switchSong(s.id)}>ロード</button>
                      <button
                        disabled={!i}
                        onClick={() => {
                          const arr = [...show.songs];
                          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                          update({ songs: arr });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        disabled={show.songs.length === 1}
                        aria-label={`曲${i + 1}削除`}
                        onClick={() => {
                          if (s.id === song.id)
                            switchSong(
                              show.songs.find((x) => x.id !== s.id)!.id,
                            );
                          update({
                            songs: show.songs.filter((x) => x.id !== s.id),
                          });
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </main>
        <PanelDivider
          name="歌詞パネルの幅"
          controls="lyrics-panel"
          axis="x"
          reverse
          value={panels.sides.lyrics}
          min={210}
          max={Math.min(
            440,
            panels.workspace.width - 476 - panels.sides.sidebar,
          )}
          onChange={(v) => panels.set("lyrics", v)}
          onReset={() => panels.set("lyrics", defaultLayout.lyrics)}
        />
        <aside
          className="lyrics-panel"
          id="lyrics-panel"
          aria-label="歌詞キュー"
          tabIndex={0}
          data-scroll-region
        >
          <div className="panel-head">
            <span>
              <Music2 size={13} /> LYRICS
            </span>
            <button onClick={() => setModal("lyricStyle")}>
              <Settings2 size={14} />
            </button>
          </div>
          <div className="lyric-switch">
            <label>
              <input
                type="checkbox"
                checked={show.lyricStyle.enabled}
                onChange={(e) =>
                  update({
                    lyricStyle: {
                      ...show.lyricStyle,
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              歌詞を出力
            </label>
            <span>{mode === "live" ? "LIVE CUE" : "AUDIO SYNC"}</span>
          </div>
          <div className="current-lyric">
            <span className="tiny">ON AIR</span>
            <p>{cue.cue?.text || "INSTRUMENTAL"}</p>
            <div className="cue-progress">
              <i style={{ width: `${cue.progress * 100}%` }} />
            </div>
          </div>
          <div className="next-lyric">
            <span className="tiny">UP NEXT</span>
            <p>{song.cues[cue.index + 1]?.text || "間奏 / END"}</p>
          </div>
          <div className="cue-nav">
            <button onClick={() => cueJump(-1)}>
              <SkipBack size={14} />
              前へ
            </button>
            <button className="next-cue" onClick={() => cueJump(1)}>
              次の歌詞
              <SkipForward size={15} />
            </button>
          </div>
          <div className="offset">
            <span>
              歌詞オフセット{" "}
              <b>
                {song.offset >= 0 ? "+" : ""}
                {song.offset.toFixed(2)}s
              </b>
            </span>
            <div>
              <button
                onClick={() =>
                  updateSong({ offset: song.offset - 60 / song.bpm })
                }
              >
                −1拍
              </button>
              <button onClick={() => updateSong({ offset: 0 })}>RESET</button>
              <button
                onClick={() =>
                  updateSong({ offset: song.offset + 60 / song.bpm })
                }
              >
                ＋1拍
              </button>
            </div>
          </div>
          <div className="cue-list-title">
            <span>LYRIC CUES · {song.cues.length}</span>
            <button onClick={() => setCueEdit((v) => !v)}>
              {cueEdit ? "完了" : "記録"}
            </button>
          </div>
          <div className="live-cues">
            {song.cues.map((c, i) => (
              <button
                className={cue.index === i ? "current" : ""}
                key={c.id}
                onClick={() => {
                  if (cueEdit) stampCue(c.id);
                  else if (mode === "live")
                    updateSong({ offset: c.start - time });
                  else seek(c.start - song.offset);
                }}
              >
                <span>{clock(c.start)}</span>
                <b>{c.text || "— INSTRUMENTAL —"}</b>
                {c.section?.includes("estimat") && <em>推定</em>}
              </button>
            ))}
          </div>
          <div className="lyrics-bottom">
            <button onClick={() => setTab("lyrics")}>
              歌詞を編集 <ChevronRight size={13} />
            </button>
            <button
              onClick={() => void connectMic()}
              className={micOn ? "active" : ""}
            >
              <Mic size={14} />
              {micOn ? "入力ON" : "音声反応"}
            </button>
          </div>
        </aside>
      </div>
      <PanelDivider
        name="タイムラインの高さ"
        controls="transport-timeline"
        axis="y"
        reverse
        className="timeline-divider"
        value={panels.layout.timeline}
        min={60}
        max={160}
        onChange={(v) => panels.set("timeline", v)}
        onReset={() => panels.set("timeline", defaultLayout.timeline)}
      />
      <footer className="timeline" id="transport-timeline">
        <div className="timeline-time">
          <span>TRANSPORT</span>
          <b>{clock(time)}</b>
        </div>
        <div className="timeline-track">
          <div className="timeline-cues">
            {song.cues.map((c, i) => (
              <div
                key={c.id}
                className={cue.index === i ? "active" : ""}
                style={{
                  left: `${(c.start / song.duration) * 100}%`,
                  width: `${(Math.max(0, c.end - c.start) / song.duration) * 100}%`,
                }}
              >
                {c.text ? "VOCAL" : "INST"}
              </div>
            ))}
          </div>
          <input
            aria-label="再生位置"
            type="range"
            min="0"
            max={song.duration}
            step=".01"
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <div className="timeline-ruler">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{clock((song.duration * i) / 6)}</span>
            ))}
          </div>
        </div>
        <label className="loop-toggle">
          <input
            type="checkbox"
            checked={loopSong}
            onChange={(e) => setLoopSong(e.target.checked)}
          />
          LOOP
        </label>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {stats.mediaErrors.length > 0 && (
        <button className="error-badge" onClick={() => setModal("errors")}>
          {stats.mediaErrors.length} 件の映像エラー
        </button>
      )}
      <input
        hidden
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,image/*"
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={folderInput}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        aria-label="素材フォルダーを選択"
        onChange={(e) => {
          void connectFolder(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={showInput}
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f && f.size < 10 * 1024 * 1024) await applyShow(await f.text());
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={audioInput}
        type="file"
        accept="audio/*"
        onChange={(e) => {
          void loadAudio(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={lyricInput}
        type="file"
        accept=".lrc,.srt,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const text = await f.text(),
              cues = f.name.endsWith(".srt") ? parseSrt(text) : parseLrc(text);
            if (cues.length) {
              updateSong({
                cues,
                lyrics: cues.map((c) => c.text).join("\n"),
                offset: 0,
                timelineBpm: song.bpm,
              });
              announce(`${cues.length}行の歌詞を読み込みました`);
            } else announce("時刻付きの歌詞が見つかりません");
          }
          e.target.value = "";
        }}
      />
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal("");
          }}
        >
          <section
            className="modal"
            ref={modalPanel}
            role="dialog"
            aria-modal="true"
            aria-label="設定"
          >
            <button
              className="modal-close"
              aria-label="閉じる"
              onClick={() => setModal("")}
            >
              <X size={18} />
            </button>
            {modal === "library" ? (
              <>
                <h2>素材管理</h2>
                <p>
                  オンライン素材はそのまま選んで再生できます。本番前に端末へ保存すると、開いている操作画面で通信が切れても再生できます。オフラインで起動する場合は、保存した単一HTMLを開き、手元の素材フォルダーを接続してください。このサイトの保存データは単一HTMLには引き継がれません。
                </p>
                <button
                  className="primary"
                  disabled={
                    libraryBusy ||
                    playing ||
                    !show.assets.some(
                      (a) =>
                        a.tags.includes("web-library") &&
                        a.url &&
                        !a.url.startsWith("blob:"),
                    )
                  }
                  onClick={() => void cacheOnlineMedia()}
                >
                  オンライン素材を端末に保存
                </button>
                {playing && <p>素材の一括保存は再生を停止してから行います。</p>}
                <hr />
                <h3>収集済み素材・USBのフォルダー</h3>
                <p>
                  収集済みライブラリは「assets」フォルダーを選択してください。catalog.jsonを使い、素材名・タグ・利用条件を引き継いでまとめて接続します。一般の動画フォルダーも選べます。
                </p>
                <button
                  disabled={libraryBusy}
                  onClick={() => folderInput.current?.click()}
                >
                  フォルダーを接続
                </button>
                <p>
                  フォルダー接続は動画をコピーしないため、ブラウザーの保存容量を消費しません。次回起動時には同じフォルダーを選び直します。MOVなど端末で再生できないコーデックは、MP4／H.264へ変換してください。
                </p>
                {libraryProgress && <p role="status">{libraryProgress}</p>}
                {libraryTransfer.current && (
                  <button onClick={() => libraryTransfer.current?.abort()}>
                    保存を中止
                  </button>
                )}
              </>
            ) : modal === "layout" ? (
              <>
                <h2>画面レイアウト</h2>
                <p>
                  パネルの境界線をドラッグして調節できます。ダブルクリックでその境界を標準に戻します。
                </p>
                {(
                  [
                    ["sidebar", "サイドバーの幅", 120, 280],
                    ["lyrics", "歌詞パネルの幅", 210, 440],
                    ["preview", "プレビューの高さ", 18, 70],
                    ["monitor", "プレビューの横幅", 25, 75],
                    ["timeline", "タイムラインの高さ", 60, 160],
                    ["thumbnail", "サムネイルの大きさ", 140, 320],
                  ] as const
                ).map(([key, label, min, max]) => {
                  const ratio = key === "preview" || key === "monitor";
                  return (
                    <label className="layout-setting" key={key}>
                      <span>
                        {label}
                        <b>
                          {Math.round(panels.layout[key] * (ratio ? 100 : 1))}
                          {ratio ? "%" : "px"}
                        </b>
                      </span>
                      <input
                        aria-label={label}
                        type="range"
                        min={min}
                        max={max}
                        step={1}
                        value={panels.layout[key] * (ratio ? 100 : 1)}
                        onChange={(e) =>
                          panels.set(
                            key,
                            Number(e.target.value) / (ratio ? 100 : 1),
                          )
                        }
                      />
                    </label>
                  );
                })}
                <p>
                  画面が狭いときは収まる大きさに調整します。小さなウィンドウではパネルを縦に並べます。設定はこのブラウザーに保存します。
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    panels.reset();
                    setLibraryFocus(false);
                  }}
                >
                  標準レイアウトに戻す
                </button>
              </>
            ) : modal === "settings" ? (
              <>
                <h2>接続・出力</h2>
                <div className="form-row">
                  <label className="field">
                    内部解像度
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(Number(e.target.value))}
                    >
                      <option value={960}>960 × 540 · 省電力</option>
                      <option value={1280}>1280 × 720 · 推奨開始値</option>
                      <option value={1920}>1920 × 1080 · フルHD</option>
                    </select>
                  </label>
                  <label className="field">
                    フレームレート
                    <select
                      value={fpsLimit}
                      onChange={(e) => setFpsLimit(Number(e.target.value))}
                    >
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </label>
                </div>
                <p>
                  プロジェクターの出力は1920×1080に設定できます。内部解像度を下げると、映像を拡大してGPU負荷を抑えます。
                </p>
                {displays.length > 0 && (
                  <label className="field">
                    出力先ディスプレイ
                    <select
                      value={displayId ?? ""}
                      onChange={(e) =>
                        setDisplayId(
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    >
                      <option value="">外部画面を自動選択</option>
                      {displays.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label} · {d.width}×{d.height}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="primary" onClick={() => void openOutput()}>
                  <Monitor size={15} />
                  外部出力を開く
                </button>
                <hr />
                <h3>音源・入力</h3>
                <button onClick={() => audioInput.current?.click()}>
                  <Music2 size={15} />
                  音源を読み込む
                </button>
                <button onClick={() => void connectMic()}>
                  <Mic size={15} />
                  {micOn ? "音声入力を停止" : "マイク / ライン入力"}
                </button>
                <hr />
                <h3>MIDI / OSC</h3>
                <button
                  onClick={async () => {
                    try {
                      const n = await midi.current.connect();
                      setMidiOn(true);
                      announce(
                        `MIDI接続: ${n}入力。後から接続した機器も認識します。`,
                      );
                    } catch (e) {
                      announce(String(e));
                    }
                  }}
                >
                  <Radio size={15} />
                  {midiOn ? "MIDI 接続中" : "MIDIを接続"}
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={midiClock}
                    onChange={(e) => setMidiClock(e.target.checked)}
                  />
                  MIDI ClockからBPMを受信
                </label>
                <p>
                  Note 36/37: 次/前の歌詞、38: TAP、39: 暗転、40: 再生、41:
                  AUTO、42: FREEZE。CC1: フェーダー、CC7: MASTER。Note48–55:
                  素材1–8。
                </p>
                <p>
                  Windows版はOSC 127.0.0.1:9000で
                  /lumina/play・stop・next・prev・tap・blackout・crossfade・master・clip
                  を受信します。
                </p>
              </>
            ) : modal === "effects" ? (
              <>
                <h2>エフェクト</h2>
                {(Object.keys(show.fx) as (keyof Show["fx"])[]).map((k) => (
                  <Range
                    key={k}
                    label={k.toUpperCase()}
                    value={show.fx[k]}
                    unit="%"
                    onChange={(v) => update({ fx: { ...show.fx, [k]: v } })}
                  />
                ))}
                <label className="field">
                  AUTOフェード長
                  <select
                    value={transitionBeats}
                    onChange={(e) => setTransitionBeats(Number(e.target.value))}
                  >
                    {[1, 2, 4, 8, 16].map((v) => (
                      <option key={v} value={v}>
                        {v}拍
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() =>
                    update({
                      fx: {
                        glitch: 0,
                        bloom: 0,
                        vignette: 0,
                        chromatic: 0,
                        pixelate: 0,
                      },
                    })
                  }
                >
                  すべて解除
                </button>
              </>
            ) : modal === "deck" ? (
              <>
                <h2>デッキ {"ABC"[target]} の映像設定</h2>
                <Range
                  label="不透明度"
                  value={show.decks[target].opacity}
                  unit="%"
                  onChange={(v) => changeDeck(target, { opacity: v })}
                />
                <Range
                  label="スピード"
                  value={show.decks[target].speed}
                  min={0.25}
                  max={4}
                  step={0.25}
                  unit="×"
                  onChange={(v) => changeDeck(target, { speed: v })}
                />
                <Range
                  label="拡大"
                  value={show.decks[target].scale}
                  min={0.25}
                  max={4}
                  onChange={(v) => changeDeck(target, { scale: v })}
                />
                <Range
                  label="回転"
                  value={show.decks[target].rotation}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => changeDeck(target, { rotation: v })}
                />
                <Range
                  label="色相"
                  value={show.decks[target].hue}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => changeDeck(target, { hue: v })}
                />
                <Range
                  label="彩度"
                  value={show.decks[target].saturation}
                  max={2}
                  onChange={(v) => changeDeck(target, { saturation: v })}
                />
                <Range
                  label="明るさ"
                  value={show.decks[target].brightness}
                  max={2}
                  onChange={(v) => changeDeck(target, { brightness: v })}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={show.decks[target].mirror}
                    onChange={(e) =>
                      changeDeck(target, { mirror: e.target.checked })
                    }
                  />
                  左右反転
                </label>
                <label className="field">
                  ブレンド
                  <select
                    value={show.decks[target].blend}
                    onChange={(e) =>
                      changeDeck(target, {
                        blend: e.target.value as Deck["blend"],
                      })
                    }
                  >
                    {["normal", "screen", "add", "multiply", "difference"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </label>
              </>
            ) : modal === "lyricStyle" ? (
              <>
                <h2>歌詞の表示</h2>
                <Range
                  label="文字サイズ"
                  value={show.lyricStyle.size}
                  min={24}
                  max={120}
                  step={1}
                  onChange={(v) =>
                    update({ lyricStyle: { ...show.lyricStyle, size: v } })
                  }
                />
                <Range
                  label="縦位置"
                  value={show.lyricStyle.position}
                  min={0.1}
                  max={0.9}
                  onChange={(v) =>
                    update({ lyricStyle: { ...show.lyricStyle, position: v } })
                  }
                />
                <label className="field">
                  表示方式
                  <select
                    value={show.lyricStyle.mode}
                    onChange={(e) =>
                      update({
                        lyricStyle: {
                          ...show.lyricStyle,
                          mode: e.target.value as "line",
                        },
                      })
                    }
                  >
                    <option value="line">行単位</option>
                    <option value="karaoke">カラオケ（行内は均等進行）</option>
                    <option value="typewriter">タイプライター</option>
                  </select>
                </label>
                <label className="field">
                  文字色
                  <input
                    type="color"
                    value={show.lyricStyle.color}
                    onChange={(e) =>
                      update({
                        lyricStyle: {
                          ...show.lyricStyle,
                          color: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={show.lyricStyle.shadow}
                    onChange={(e) =>
                      update({
                        lyricStyle: {
                          ...show.lyricStyle,
                          shadow: e.target.checked,
                        },
                      })
                    }
                  />
                  影で可読性を確保
                </label>
              </>
            ) : modal === "asset" ? (
              <>
                <h2>{asset?.name}</h2>
                <p>{asset?.license}</p>
                <p>{asset?.attribution}</p>
                <p>{asset?.tags.join(" · ")}</p>
                {asset?.source?.startsWith("https://") ? (
                  <a href={asset.source} target="_blank" rel="noreferrer">
                    配布元・利用条件を開く
                  </a>
                ) : (
                  <p>{asset?.source}</p>
                )}
                <p>{asset?.status}</p>
                {asset?.tags.includes("web-library") && (
                  <p>
                    公開版は軽量化・無音化しています。
                    <a
                      href="./assets/credits.txt"
                      target="_blank"
                      rel="noreferrer"
                    >
                      全素材のクレジット
                    </a>
                    を確認できます。
                  </p>
                )}
                {asset?.license.includes("CC BY 4.0") && (
                  <a
                    href="https://creativecommons.org/licenses/by/4.0/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CC BY 4.0 利用条件
                  </a>
                )}
              </>
            ) : modal === "errors" ? (
              <>
                <h2>映像の診断</h2>
                {stats.mediaErrors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </>
            ) : (
              <>
                <h2>ライブ操作ガイド</h2>
                <p>
                  素材をA/Bに読み込み、クロスフェーダーで切り替えます。Cは重ね映像です。Bキーで全出力を暗転できます。
                </p>
                <div className="shortcut-list">
                  {[
                    ["Space", "再生 / 一時停止"],
                    ["T", "タップテンポ"],
                    ["← / →", "前 / 次の歌詞"],
                    ["↑ / ↓", "歌詞を ±1拍 補正"],
                    ["A / D", "A / Bへカット"],
                    ["X", "AUTOクロスフェード"],
                    ["F", "映像フリーズ"],
                    ["B", "暗転 / 解除"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <kbd>{k}</kbd>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
                <p>
                  LIVE方式では次の歌詞を押すと、曲の再生位置を変えずに歌詞のオフセットを調整します。AUDIO方式では音源の時刻を基準に再生します。
                </p>
                <p>
                  本番前に全素材・全歌詞を通し、HDMIの拡張表示と音声出力先を確認してください。Chromebookはブラウザー版を使用します。録画は音声なしWebM、256MBで自動停止します。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
