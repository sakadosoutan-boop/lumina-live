import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import https from "node:https";
import sevenZip from "7zip-bin";

// This lane owns only the paths below; no package/catalog changes or stock scraping.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = path.join(ROOT, "assets/media/packs");
const DOWNLOADS = path.join(ROOT, "assets/downloads/packs");
const SNAPSHOTS = path.join(ROOT, "research/pack-snapshots");
const CANDIDATES = path.join(ROOT, "assets/pack-candidates.json");
const RECORD = path.join(ROOT, "research/pack-acquisition.json");
const LIMIT = 9_500_000_000;
const WORK_LIMIT = LIMIT - 16 * 1024 ** 2; // reserve for atomic journals and evidence
const LOCK = path.join(SNAPSHOTS, "pack-collector.lock");
const cancel = new AbortController();
process.on("SIGINT", () => cancel.abort(new Error("Interrupted by SIGINT")));
process.on("SIGTERM", () => cancel.abort(new Error("Interrupted by SIGTERM")));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BE = "https://www.beeple-crap.com/vjloops";
const NE = "https://nebmotion.co.uk/vj-loops/free/";
const packs = [
  {
    id: "beeple-manifest",
    name: "MANIFEST",
    author: "Beeple / Mike Winkelmann",
    source: BE,
    page: "https://www.mediafire.com/file/wxck3hz5hpvaple/BEEPLE_MANIFEST-DESTINY_CLIPS.zip/file",
    expectedVideos: 65,
    order: 0,
  },
  {
    id: "beeple-four-color-process",
    name: "four.color.process",
    author: "Beeple / Mike Winkelmann",
    source: BE,
    page: "https://www.mediafire.com/download/32q1zhardzdck3m/beeple-four_color_process.zip",
    expectedVideos: 10,
    order: 1,
  },
  {
    id: "beeple-brainfader",
    name: "Brainfader Vol.1 (archive: brainfeeder)",
    author: "Beeple / Mike Winkelmann",
    source: BE,
    page: "https://www.mediafire.com/download/y0b3wiwxiwwbaci/brainfeeder_beeple-vjclips.zip",
    expectedVideos: 10,
    order: 2,
  },
  {
    id: "beeple-resolume",
    name: "Resolume VJ Pack",
    author: "Beeple / Mike Winkelmann",
    source: BE,
    page: "https://www.mediafire.com/download/c46fy4534tfdr2y/beeple-resolume_pack.zip",
    expectedVideos: 10,
    order: 3,
  },
  {
    id: "beeple-ubersketch",
    name: "übersketch",
    author: "Beeple / Mike Winkelmann",
    source: BE,
    page: "https://www.mediafire.com/download/35y1do8pmndr26y/ubersketch.zip",
    expectedVideos: 10,
    order: 4,
  },
  {
    id: "neb-abstract-tunnels-2",
    name: "Abstract Tunnels Vol.2",
    author: "Neb Motion",
    source: NE,
    page: "https://www.dropbox.com/sh/2myy6sshj7cizqz/AABz9xNzE0JjEUqlWnujcNiPa?dl=0",
    expectedVideos: 10,
    order: 5,
  },
  {
    id: "neb-retro-sunsets-1",
    name: "80s Retro Sunsets Vol.1",
    author: "Neb Motion",
    source: NE,
    page: "https://www.dropbox.com/sh/ty4ajnw9sfda488/AABanV8MeNZzgZ60q9MM3yO9a?dl=0",
    expectedVideos: 10,
    order: 6,
  },
  {
    id: "neb-abstract-tunnels-1",
    name: "Abstract Tunnels Vol.1",
    author: "Neb Motion",
    source: NE,
    landing: "https://nebmotion.co.uk/x-lp-abstract-tunnels-vol-1/",
    page: "https://www.dropbox.com/sh/25kyxmwsg9ivatl/AABydZmHbaCGZsQy9SHCsbMma?dl=0",
    expectedVideos: 10,
    order: 7,
  },
  {
    id: "neb-abstract-geometry-1",
    name: "Abstract Geometry Vol.1",
    author: "Neb Motion",
    source: NE,
    landing: "https://nebmotion.co.uk/x-lp-abstract-geometry-vol-1/",
    page: "https://www.dropbox.com/sh/m8k37h81a38ruhy/AAARKe_8BPGOgsIeChDi_T7Sa?dl=0",
    expectedVideos: 10,
    order: 8,
  },
];
const now = () => new Date().toISOString();
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const exists = (p) => fs.existsSync(p);
function inside(p, root) {
  const r = path.relative(root, path.resolve(p));
  return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
}
function assertPath(p, roots = [MEDIA, DOWNLOADS, SNAPSHOTS]) {
  p = path.resolve(p);
  if (!roots.some((root) => inside(p, root)))
    throw new Error(`Out-of-scope path: ${p}`);
  let q = path.dirname(p);
  while (q !== ROOT && inside(q, ROOT)) {
    if (exists(q) && fs.lstatSync(q).isSymbolicLink())
      throw new Error(`Symlink parent rejected: ${q}`);
    q = path.dirname(q);
  }
  if (exists(p) && fs.lstatSync(p).isSymbolicLink())
    throw new Error(`Symlink target rejected: ${p}`);
  return p;
}
async function treeBytes(dir) {
  if (!exists(dir)) return 0;
  let n = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in lane: ${p}`);
    n += entry.isDirectory() ? await treeBytes(p) : (await fsp.stat(p)).size;
  }
  return n;
}
async function usage() {
  return (
    (await treeBytes(MEDIA)) +
    (await treeBytes(DOWNLOADS)) +
    (await treeBytes(SNAPSHOTS)) +
    (exists(CANDIDATES) ? (await fsp.stat(CANDIDATES)).size : 0) +
    (exists(RECORD) ? (await fsp.stat(RECORD)).size : 0) +
    (await fsp.stat(fileURLToPath(import.meta.url))).size
  );
}
async function retryIO(callback) {
  for (let n = 0; ; n++) {
    try {
      return await callback();
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || n >= 7) throw e;
      await delay(Math.min(1000, 100 * 2 ** n));
    }
  }
}
async function unlinkDownload(p) {
  await retryIO(() => fsp.unlink(assertPath(p, [DOWNLOADS])));
}
async function atomic(target, body) {
  const temp = assertPath(
    path.join(SNAPSHOTS, path.basename(target) + ".atomic.part"),
  );
  if ((await usage()) + Buffer.byteLength(body) > LIMIT)
    throw new Error("Pack metadata would exceed 9,500,000,000-byte cap");
  await fsp.writeFile(temp, body);
  await retryIO(() => fsp.rename(temp, target));
}
async function writeSnapshot(name, body) {
  const p = assertPath(path.join(SNAPSHOTS, name));
  await atomic(p, body);
  return { localPath: rel(p), sha256: sha(body) };
}
function run(cmd, args, input, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(timeout)]),
    });
    let out = "",
      err = "";
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (b) => {
      out += b;
      if (out.length > 8 * 1024 ** 2) p.kill();
    });
    p.stderr.on("data", (b) => {
      err = (err + b).slice(-2 * 1024 ** 2);
    });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, out, err }));
    p.stdin.end(input || "");
  });
}
const PY = String.raw`
import sys,json,zipfile,pathlib,stat,hashlib,os,re,zlib
x=json.loads(sys.stdin.buffer.read().decode('utf-8'))
root=pathlib.Path(x['destination']).resolve(); archive=pathlib.Path(x['archive']).resolve()
videos={'.mp4','.mov','.m4v','.webm','.mkv','.avi','.mpg','.mpeg','.wmv'}
allowed_nested=set(x.get('allowedNested',[]))
def items(z):
 infos=z.infolist()
 if len(infos)>5000: raise Exception('Archive entry count exceeds bounded inventory')
 seen=set()
 for i in infos:
  n=i.filename.replace('\\','/'); p=pathlib.PurePosixPath(n); bits=p.parts
  if i.is_dir() or '__MACOSX' in bits or any(b.startswith('._') for b in bits): continue
  if p.is_absolute() or not bits or any(b in ('..','.') or re.search(r'[<>:"|?*\x00-\x1f]',b) or b.endswith((' ','.')) or re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)',b) for b in bits): raise Exception('Unsafe archive path: '+n)
  if stat.S_ISLNK(i.external_attr>>16): raise Exception('Archive symlink rejected: '+n)
  if i.flag_bits & 1: raise Exception('Encrypted member rejected: '+n)
  if i.file_size<0 or i.file_size>8000000000: raise Exception('Archive member exceeds bounded size: '+n)
  key=n.casefold()
  if key in seen: raise Exception('Duplicate case-insensitive path: '+n)
  seen.add(key)
  typ='video' if p.suffix.lower() in videos else 'archive' if p.suffix.lower()=='.zip' else 'document' if re.match(r'(?i)^(readme|license|licence|copying|credits)([ ._-].*)?$',p.name) and p.suffix.lower() in ('','.txt','.md','.pdf','.rtf','.nfo') else 'ignored'
  dest=root.joinpath(*bits).resolve()
  if not dest.is_relative_to(root): raise Exception('Path escaped destination')
  yield i,dict(name=n,bytes=i.file_size,compressedBytes=i.compress_size,compressionMethod=i.compress_type,crc32=format(i.CRC,'08x'),type=typ,path=str(dest))
def check_target(target):
 if not target.resolve().is_relative_to(root): raise Exception('Target escaped extraction root')
 for ancestor in [target,*target.parents]:
  if ancestor.is_symlink(): raise Exception('Symlink extraction target')
  if ancestor==root: break
with zipfile.ZipFile(archive) as z:
 entries=list(items(z))
 if x['action']=='list': print(json.dumps([d for i,d in entries]));sys.exit()
 if x['action']=='verify':
  if sum(i.file_size for i in z.infolist())>x.get('maxVerifyBytes',8000000000): raise Exception('Archive CRC verification exceeds bounded expanded size')
  bad=z.testzip()
  if bad: raise Exception('Archive CRC failed: '+bad)
  print(json.dumps(dict(crcVerified=True,members=len(z.infolist()))));sys.exit()
 selected=set(x['selected'])
 if len(selected)!=len(x['selected']) or not selected.issubset({d['name'] for i,d in entries}): raise Exception('Unknown or duplicate selected member')
 budget=x['maxNewBytes'];written=0
 for i,d in entries:
  if d['name'] not in selected: continue
  if d['type'] not in ('video','document') and not (d['type']=='archive' and d['name'] in allowed_nested): raise Exception('Selected member type not authorized')
  target=pathlib.Path(d['path'])
  if 'rename' in x:
   if len(selected)!=1 or d['type']!='archive' or not re.fullmatch(r'[A-Za-z0-9_.-]+',x['rename']): raise Exception('Invalid bounded nested target')
   target=root/x['rename'];d['path']=str(target)
  check_target(target);target.parent.mkdir(parents=True,exist_ok=True)
  if target.exists():
   if not target.is_file() or target.stat().st_size!=i.file_size: raise Exception('Existing member mismatch: '+str(target))
   h=hashlib.sha256();crc=0
   with target.open('rb') as current:
    while True:
     b=current.read(1024*1024)
     if not b: break
     h.update(b);crc=zlib.crc32(b,crc)
   if crc!=i.CRC: raise Exception('Existing member CRC mismatch: '+str(target))
   d.update(sha256=h.hexdigest(),crcVerified=True,sizeVerified=True);print(json.dumps(d),flush=True);continue
  if written+i.file_size>budget: raise Exception('Extraction lane budget exceeded')
  temp=pathlib.Path(str(target)+'.extracting.part');check_target(temp)
  if temp.exists():
   if not temp.is_file(): raise Exception('Unexpected extraction temporary target')
   temp.unlink()
  h=hashlib.sha256();count=0;crc=0;first=b''
  try:
   with z.open(i) as src,temp.open('xb') as dst:
    while True:
     b=src.read(1024*1024)
     if not b: break
     if not first:first=b[:1024]
     count+=len(b)
     if count>i.file_size or written+count>budget:raise Exception('Unexpected expanded size')
     dst.write(b);h.update(b);crc=zlib.crc32(b,crc)
    dst.flush();os.fsync(dst.fileno())
   if count!=i.file_size or crc!=i.CRC:raise Exception('Member CRC/size mismatch')
   if d['type']=='video':
    lower=first.lstrip().lower()
    if lower.startswith((b'<html',b'<!doctype',b'<?xml',b'{')):raise Exception('Disguised HTML/JSON video')
    recognized=first[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free',b'skip',b'pnot') or first.startswith((b'RIFF',b'\x1aE\xdf\xa3',b'\x00\x00\x01',b'0&\xb2u'))
    if not recognized:raise Exception('Unrecognized video file signature')
   elif d['type']=='archive' and not zipfile.is_zipfile(temp):raise Exception('Nested member is not ZIP')
   os.replace(temp,target);written+=count
   d.update(sha256=h.hexdigest(),crcVerified=True,sizeVerified=True);print(json.dumps(d),flush=True)
  except:
   if temp.is_file():temp.unlink()
   raise
`;
let state = exists(RECORD)
  ? JSON.parse(await fsp.readFile(RECORD, "utf8"))
  : {
      version: 1,
      startedAt: now(),
      laneLimitBytes: LIMIT,
      overallUserLimitBytes: 20_000_000_000,
      parentOtherLaneLimitBytes: 6 * 1024 ** 3,
      packs: [],
      events: [],
    };
let candidates = exists(CANDIDATES)
  ? JSON.parse(await fsp.readFile(CANDIDATES, "utf8"))
  : [];
if (!Array.isArray(candidates))
  throw new Error("Expected Asset[] in pack-candidates.json");
for (const dir of [MEDIA, DOWNLOADS, SNAPSHOTS]) {
  assertPath(path.join(dir, ".scope-check"));
  await fsp.mkdir(dir, { recursive: true });
}
async function save() {
  state.laneLimitBytes = LIMIT;
  state.parentOtherLaneLimitBytes = 8_500_000_000;
  state.updatedAt = now();
  state.actualLaneBytes = await usage();
  state.remainingLaneBytes = LIMIT - state.actualLaneBytes;
  state.downloadedVideos = candidates.length;
  await fsp.writeFile(CANDIDATES, JSON.stringify(candidates, null, 2) + "\n");
  await fsp.writeFile(RECORD, JSON.stringify(state, null, 2) + "\n");
}
async function event(pack, action, detail = {}) {
  const e = { at: now(), packId: pack.id, action, ...detail };
  state.events.push(e);
  console.log(JSON.stringify(e));
  await save();
}
async function pageSnapshot(url, name) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const body = await r.text();
  const sn = await writeSnapshot(name, body);
  return {
    response: r,
    body,
    evidence: {
      ...sn,
      sourceUrl: url,
      finalUrl: r.url,
      httpStatus: r.status,
      capturedAt: now(),
    },
  };
}
function binaryResponse(url, headers, redirects = 0) {
  if (redirects > 6) throw new Error("Too many download redirects");
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers, agent: false, signal: cancel.signal },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          resolve(
            binaryResponse(
              new URL(res.headers.location, url).href,
              headers,
              redirects + 1,
            ),
          );
        } else {
          res.finalUrl = url;
          resolve(res);
        }
      },
    );
    // Idle socket timeout resets with activity. Brief 40-second host stalls are permitted.
    request.setTimeout(180000, () =>
      request.destroy(new Error("Download socket idle for 180 seconds")),
    );
    request.on("error", reject);
  });
}
async function fileHash(p) {
  const h = createHash("sha256");
  for await (const b of fs.createReadStream(p)) h.update(b);
  return h.digest("hex");
}
async function downloadArchive(pack, record, archive, initialUrl) {
  const partial = assertPath(path.join(DOWNLOADS, pack.id + ".zip.part"));
  let download = initialUrl;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response, handle;
    const hasPartial = exists(partial);
    const offset = hasPartial ? (await fsp.stat(partial)).size : 0;
    try {
      if (attempt > 1 && pack.page.includes("mediafire.com")) {
        const refreshed = await pageSnapshot(
          pack.page,
          `${pack.id}-host-retry-${attempt}.html`,
        );
        const tag = [...refreshed.body.matchAll(/<a\b[^>]*>/gi)]
          .map((m) => m[0])
          .find((t) => /\bid=["']downloadButton["']/.test(t));
        const fresh = tag
          ?.match(/\bhref=["']([^"']+)["']/)?.[1]
          ?.replaceAll("&amp;", "&");
        if (!refreshed.response.ok || !fresh)
          throw new Error(
            "Host gate: normal download button unavailable on retry",
          );
        download = fresh;
        record.retryHostEvidence ??= [];
        record.retryHostEvidence.push(refreshed.evidence);
      }
      record.downloadUrl = download;
      const headers = { Referer: pack.page };
      if (offset) {
        headers.Range = `bytes=${offset}-`;
        if (record.resumeValidator)
          headers["If-Range"] = record.resumeValidator;
      }
      response = await binaryResponse(download, headers);
      const status = response.statusCode,
        type = String(response.headers["content-type"] || "");
      const length = Number(response.headers["content-length"] || 0);
      const range = String(response.headers["content-range"] || "").match(
        /^bytes (\d+)-(\d+)\/(\d+)$/,
      );
      record.downloadResponse = {
        status,
        url: response.finalUrl,
        contentType: type,
        contentLength: length,
        contentRange: response.headers["content-range"],
        contentDisposition: response.headers["content-disposition"],
        etag: response.headers.etag,
        lastModified: response.headers["last-modified"],
      };
      if (
        status < 200 ||
        status >= 300 ||
        /text\/html|application\/json/.test(type)
      ) {
        let errorBody = "";
        for await (const b of response) {
          errorBody += b.toString();
          if (errorBody.length > 1024 * 1024) {
            response.destroy();
            break;
          }
        }
        record.downloadFailureEvidence = await writeSnapshot(
          `${pack.id}-download-failure-${attempt}.html`,
          errorBody,
        );
        throw new Error(
          `Host gate/non-binary download: HTTP ${status} ${type}`,
        );
      }
      if (offset && (status !== 206 || !range || +range[1] !== offset))
        throw new Error(
          "Host did not honor exact HTTP Range; partial preserved, no blind append",
        );
      const total = range ? +range[3] : length;
      if (
        record.expectedArchiveBytes &&
        total &&
        record.expectedArchiveBytes !== total
      )
        throw new Error("Archive total changed during resume");
      if (total) record.expectedArchiveBytes = total;
      record.resumeValidator =
        response.headers.etag && !String(response.headers.etag).startsWith("W/")
          ? response.headers.etag
          : response.headers["last-modified"];
      const used = await usage(),
        additional = total ? total - offset : 0;
      if (used + additional > WORK_LIMIT)
        throw new Error("Lane budget: archive would exceed 9.5 GB allocation");
      const disk = await fsp.statfs(DOWNLOADS, { bigint: true });
      if (additional && BigInt(additional) > disk.bavail * disk.bsize)
        throw new Error("Insufficient filesystem capacity");
      handle = await fsp.open(partial, hasPartial ? "a" : "wx");
      let bytes = offset,
        last = Date.now(),
        first = offset === 0;
      await event(pack, offset ? "download-resuming" : "download-transfer", {
        attempt,
        offset,
        total,
      });
      for await (const chunk of response) {
        const b = Buffer.from(chunk);
        if (first) {
          if (b.length < 4 || b.readUInt32LE(0) !== 0x04034b50)
            throw new Error("Download is not ZIP (disguised binary rejected)");
          first = false;
        }
        if (used + bytes - offset + b.length > WORK_LIMIT)
          throw new Error("Lane budget reached during transfer");
        let written = 0;
        while (written < b.length) {
          const w = await handle.write(b, written, b.length - written);
          written += w.bytesWritten;
        }
        bytes += b.length;
        if (Date.now() - last > 20000) {
          record.downloadedBytes = bytes;
          await event(pack, "download-progress", { bytes, total, attempt });
          last = Date.now();
        }
      }
      if (!bytes || (total && bytes !== total))
        throw new Error("Truncated archive transfer");
      await handle.close();
      handle = undefined;
      const digest = await fileHash(partial);
      await fsp.rename(partial, archive);
      record.archive = {
        localPath: rel(archive),
        bytes,
        sha256: digest,
        downloadedAt: now(),
        retained: true,
      };
      record.partialBytes = 0;
      await event(pack, "archive-downloaded", { bytes, sha256: digest });
      return;
    } catch (e) {
      response?.destroy();
      await handle?.close().catch(() => {});
      record.partialBytes = exists(partial)
        ? (await fsp.stat(partial)).size
        : 0;
      record.transferFailures ??= [];
      record.transferFailures.push({
        at: now(),
        attempt,
        offset,
        partialBytes: record.partialBytes,
        error: e.message,
      });
      await event(pack, "transfer-interrupted", {
        attempt,
        partialBytes: record.partialBytes,
        error: e.message,
      });
      if (
        /Host gate|HTTP Range|changed during|budget|not ZIP|capacity/i.test(
          e.message,
        ) ||
        attempt === maxAttempts
      )
        throw e;
      await new Promise((r) => setTimeout(r, Math.min(10000, 2000 * attempt)));
    }
  }
}
async function metadata(file) {
  const ff = path.join(ROOT, "node_modules/ffmpeg-static/ffmpeg.exe");
  if (!exists(ff)) return { status: "pending-ffmpeg" };
  const r = await run(ff, ["-hide_banner", "-i", file]);
  const video = r.err.split(/\r?\n/).find((s) => /Stream #.*Video:/.test(s));
  if (!video) return { status: "probe-failed", detail: r.err.slice(-1800) };
  const codec = video.match(/Video:\s*([^\s,(]+)/)?.[1];
  const dimensions = video.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const d = r.err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const fps = video.match(/([\d.]+) fps/);
  const duration = d
    ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
    : undefined;
  return {
    status: "probed",
    tool: "ffmpeg-static",
    codec,
    width: dimensions ? +dimensions[1] : undefined,
    height: dimensions ? +dimensions[2] : undefined,
    fps: fps ? +fps[1] : undefined,
    duration,
    hasAudio: /Stream #.*Audio:/.test(r.err),
    streamDescription: video.trim(),
    needsTranscode: !(
      ["h264", "vp8", "vp9", "av1"].includes(codec) &&
      [".mp4", ".webm", ".m4v"].includes(path.extname(file).toLowerCase())
    ),
  };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
async function extractDeflate64(archive, member) {
  if (
    member.compressionMethod !== 9 ||
    !["video", "document"].includes(member.type)
  )
    throw Error("Unsupported bounded extraction method");
  const target = assertPath(member.path, [MEDIA]),
    temp = assertPath(target + ".extracting.part", [MEDIA]);
  if (exists(target)) throw Error("Unexpected existing Deflate64 destination");
  if (member.bytes > WORK_LIMIT - (await usage()))
    throw Error("Lane budget for Deflate64 member");
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (exists(temp)) await fsp.unlink(temp);
  const handle = await fsp.open(temp, "wx"),
    digest = createHash("sha256");
  let bytes = 0,
    crc = 0xffffffff,
    first = Buffer.alloc(0),
    err = "";
  const process7z = spawn(
    sevenZip.path7za,
    ["x", "-so", "-spd", "-y", "--", assertPath(archive, [DOWNLOADS]), member.name],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: cancel.signal,
    },
  );
  const ended = new Promise((resolve) => {
    process7z.on("error", (e) => {
      err += e.message;
      resolve(-1);
    });
    process7z.on("close", resolve);
  });
  process7z.stderr.on("data", (b) => (err = (err + b.toString()).slice(-4000)));
  try {
    for await (const b of process7z.stdout) {
      bytes += b.length;
      if (bytes > member.bytes)
        throw Error("Unexpected Deflate64 expanded size");
      if (first.length < 1024)
        first = Buffer.concat([first, b.subarray(0, 1024 - first.length)]);
      digest.update(b);
      for (const n of b) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
      let offset = 0;
      while (offset < b.length)
        offset += (await handle.write(b, offset, b.length - offset))
          .bytesWritten;
    }
    if ((await ended) !== 0) throw Error("Deflate64 extraction failed: " + err);
    if (
      bytes !== member.bytes ||
      ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0") !== member.crc32
    )
      throw Error("Deflate64 CRC/size mismatch");
    if (
      member.type === "video" &&
      !["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(
        first.subarray(4, 8).toString("ascii"),
      ) &&
      !first.subarray(0, 4).equals(Buffer.from("RIFF"))
    )
      throw Error("Unexpected video signature");
    await handle.sync();
    await handle.close();
    await fsp.rename(temp, target);
    return {
      ...member,
      path: target,
      sha256: digest.digest("hex"),
      crcVerified: true,
      sizeVerified: true,
    };
  } catch (e) {
    process7z.kill();
    await ended;
    await handle.close().catch(() => {});
    if (exists(temp)) await fsp.unlink(assertPath(temp, [MEDIA]));
    throw e;
  }
}
async function acquire(pack) {
  let record = state.packs.find((p) => p.id === pack.id);
  if (!record) {
    record = { ...pack, status: "queued", attempts: [] };
    state.packs.push(record);
  }
  if (
    ["complete", "partial-capacity"].includes(record.status) &&
    !process.argv.includes("--retry")
  ) {
    delete record.error;
    return;
  }
  const attempt = { startedAt: now() };
  record.attempts.push(attempt);
  try {
    if (!record.licenseEvidence) {
      const source = await pageSnapshot(pack.source, pack.id + "-source.html");
      if (!source.response.ok)
        throw new Error("Official source HTTP " + source.response.status);
      record.licenseEvidence = source.evidence;
      record.license = {
        label:
          pack.source === BE
            ? "Creator permits commercial/non-commercial video use in any form; Creative Commons variant unspecified"
            : "Creator permits commercial/non-commercial use, no attribution required; Creative Commons variant unspecified",
        url: pack.source,
        commercialUse: true,
        publicPerformance:
          pack.source === BE
            ? "Included in broad any-form commercial grant"
            : "Live music events explicitly described",
        attributionRequired:
          pack.source === BE
            ? "Unspecified CC variant; retain and display creator credit conservatively"
            : false,
        attribution: pack.author + " — " + pack.source,
        redistribution:
          "Not established; retain for local performance, do not redistribute source files",
        audioRights:
          pack.source === BE
            ? "All audio rights remain with respective owners; video permission does not clear demo soundtracks"
            : "Do not infer separate soundtrack rights",
        capturedAt: now(),
      };
      if (pack.landing) {
        const landing = await pageSnapshot(
          pack.landing,
          pack.id + "-landing.html",
        );
        record.landingEvidence = landing.evidence;
      }
    }
    await event(pack, "starting");
    const outerArchive = assertPath(path.join(DOWNLOADS, pack.id + ".zip"));
    const nestedArchive = assertPath(
      path.join(DOWNLOADS, pack.id + "-videos.zip"),
    );
    let archive =
      pack.id === "beeple-brainfader" && exists(nestedArchive)
        ? nestedArchive
        : outerArchive;
    if (!exists(archive)) {
      const host = await pageSnapshot(pack.page, pack.id + "-host.html");
      record.hostEvidence = host.evidence;
      if (!host.response.ok)
        throw new Error(`Host gate HTTP ${host.response.status}`);
      let download;
      if (pack.page.includes("mediafire.com")) {
        const tag = [...host.body.matchAll(/<a\b[^>]*>/gi)]
          .map((m) => m[0])
          .find((t) => /\bid=["']downloadButton["']/.test(t));
        download = tag
          ?.match(/\bhref=["']([^"']+)["']/)?.[1]
          ?.replaceAll("&amp;", "&");
        if (!download)
          throw new Error(
            "Host gate: normal MediaFire download button unavailable; no bypass attempted",
          );
        if (!/^https:\/\/download\d+\.mediafire\.com\//.test(download))
          throw new Error("Unexpected MediaFire download target");
      } else {
        const u = new URL(host.response.url);
        u.searchParams.set("dl", "1");
        download = u.href;
        record.downloadMethod =
          "Dropbox documented dl=1 parameter on publicly shared folder";
      }
      record.downloadUrl = download;
      record.status = "downloading";
      await save();
      await downloadArchive(pack, record, archive, download);
    }
    const destination = assertPath(path.join(MEDIA, pack.id));
    if (pack.id === "beeple-brainfader" && archive === outerArchive) {
      const outerBase = {
        archive: outerArchive.split(path.sep).join("/"),
        destination: destination.split(path.sep).join("/"),
      };
      const outerList = await run(
        "python",
        ["-X", "utf8", "-c", PY],
        JSON.stringify({ ...outerBase, action: "list" }),
      );
      if (outerList.code !== 0)
        throw Error("Outer ZIP inventory failed: " + outerList.err);
      const inventory = JSON.parse(outerList.out),
        nested = inventory.find(
          (e) => e.name === "vj clips.zip" && e.type === "archive",
        );
      if (!nested) throw Error("Expected single VJ clips archive not found");
      for (const doc of inventory.filter((e) => e.type === "document")) {
        const result = await run(
          "python",
          ["-X", "utf8", "-c", PY],
          JSON.stringify({
            ...outerBase,
            action: "extract",
            selected: [doc.name],
            maxNewBytes: WORK_LIMIT - (await usage()),
          }),
        );
        if (result.code !== 0)
          throw Error("Outer credit extraction failed: " + result.err);
        const file = JSON.parse(result.out.trim());
        record.documents ??= [];
        if (!record.documents.some((d) => d.name === file.name))
          record.documents.push({ ...file, localPath: rel(file.path) });
      }
      if (nested.bytes > WORK_LIMIT - (await usage()))
        throw Error("Lane budget: insufficient room for bounded nested ZIP");
      const unpack = await run(
        "python",
        ["-X", "utf8", "-c", PY],
        JSON.stringify({
          ...outerBase,
          destination: DOWNLOADS.split(path.sep).join("/"),
          action: "extract",
          selected: [nested.name],
          allowedNested: [nested.name],
          rename: path.basename(nestedArchive),
          maxNewBytes: WORK_LIMIT - (await usage()),
        }),
      );
      if (unpack.code !== 0)
        throw Error("Nested VJ ZIP extraction failed: " + unpack.err);
      const file = JSON.parse(unpack.out.trim());
      const verify = await run(
        "python",
        ["-X", "utf8", "-c", PY],
        JSON.stringify({
          ...outerBase,
          archive: nestedArchive.split(path.sep).join("/"),
          action: "verify",
          maxVerifyBytes: WORK_LIMIT,
        }),
      );
      if (verify.code !== 0)
        throw Error("Nested VJ ZIP CRC failed: " + verify.err);
      record.nestedArchive = {
        ...file,
        localPath: rel(nestedArchive),
        retained: true,
        verifiedAt: now(),
      };
      await save();
      await unlinkDownload(outerArchive);
      record.archive.retained = false;
      record.archive.removalReason =
        "Verified VJ-only nested archive retained; 3D project files omitted";
      archive = nestedArchive;
      await event(pack, "nested-archive-verified", {
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
    const base = {
      archive: archive.split(path.sep).join("/"),
      destination: destination.split(path.sep).join("/"),
    };
    const listing = await run(
      "python",
      ["-X", "utf8", "-c", PY],
      JSON.stringify({ ...base, action: "list" }),
    );
    if (listing.code !== 0)
      throw new Error("Archive validation failed: " + listing.err.slice(-2000));
    const entries = JSON.parse(listing.out);
    record.archiveInventory = await writeSnapshot(
      pack.id + "-zip-inventory.json",
      JSON.stringify(
        entries.map(({ path, ...e }) => e),
        null,
        2,
      ),
    );
    // When packs include alternate encodings, prefer the MP4 of the same relative stem.
    const mp4Stems = new Set(
      entries
        .filter((e) => /\.mp4$/i.test(e.name))
        .map((e) => e.name.replace(/\.[^.]+$/, "").toLowerCase()),
    );
    const hasNebH264 =
      pack.source === NE &&
      entries.some(
        (e) => e.type === "video" && /(^|\/)h\.?264\//i.test(e.name),
      );
    const selected = entries
      .filter((e) => ["video", "document"].includes(e.type))
      .filter(
        (e) =>
          !(
            e.type === "video" &&
            !/\.mp4$/i.test(e.name) &&
            mp4Stems.has(e.name.replace(/\.[^.]+$/, "").toLowerCase())
          ),
      )
      .filter(
        (e) =>
          !hasNebH264 || e.type !== "video" || /(^|\/)h\.?264\//i.test(e.name),
      );
    record.selectionPolicy = hasNebH264
      ? "Retain supplied H264 video folder and documents; omit alternate codec folders and non-video media"
      : "Prefer MP4 for matching stems; retain source codecs otherwise";
    record.omittedAlternateEncodings = entries
      .filter((e) => !selected.includes(e))
      .map((e) => e.name);
    const wanted = selected
      .filter(
        (e) =>
          !candidates.some(
            (a) => a.packId === pack.id && a.archiveMember === e.name,
          ) && !(record.documents || []).some((d) => d.name === e.name),
      )
      .sort((a, b) =>
        a.type === "document"
          ? -1
          : b.type === "document"
            ? 1
            : a.bytes - b.bytes,
      );
    const remaining = [];
    let available = WORK_LIMIT - (await usage());
    record.skippedBudget = [];
    for (const entry of wanted) {
      if (entry.bytes <= available) {
        remaining.push(entry);
        available -= entry.bytes;
      } else
        record.skippedBudget.push({ name: entry.name, bytes: entry.bytes });
    }
    record.availableVideos = selected.filter((e) => e.type === "video").length;
    record.expectedSelectedVideos =
      candidates.filter((a) => a.packId === pack.id).length +
      remaining.filter((e) => e.type === "video").length;
    record.selectedExpandedBytes = selected.reduce((n, e) => n + e.bytes, 0);
    record.status = "extracting";
    await event(pack, "extracting", {
      members: remaining.length,
      expandedBytes: record.selectedExpandedBytes,
    });
    for (const member of remaining.sort((a, b) =>
      a.type === "document"
        ? -1
        : b.type === "document"
          ? 1
          : a.bytes - b.bytes,
    )) {
      let file;
      if (member.compressionMethod === 9 && !exists(member.path))
        file = await extractDeflate64(archive, member);
      else {
        const extraction = await run(
          "python",
          ["-X", "utf8", "-c", PY],
          JSON.stringify({
            ...base,
            action: "extract",
            selected: [member.name],
            maxNewBytes: WORK_LIMIT - (await usage()),
          }),
        );
        if (extraction.code !== 0)
          throw new Error(
            "Safe extraction failed: " + extraction.err.slice(-2000),
          );
        file = JSON.parse(extraction.out.trim());
      }
      if (file.type === "document") {
        record.documents ??= [];
        record.documents.push({ ...file, localPath: rel(file.path) });
        await save();
        continue;
      }
      const meta = await metadata(file.path);
      const isBeeple = pack.source === BE;
      const entry = {
        id: pack.id + "-" + file.sha256.slice(0, 16),
        name: path.basename(file.name, path.extname(file.name)),
        kind: "video",
        url: "/" + rel(file.path),
        tags: [
          "vj-loop",
          isBeeple ? "beeple" : "neb-motion",
          pack.id,
          meta.codec || "metadata-pending",
          ...(meta.needsTranscode ? ["needs-transcode"] : []),
        ],
        hue: 0,
        energy: 0.5,
        duration: meta.duration,
        license: record.license.label,
        source: pack.source,
        attribution: record.license.attribution,
        status:
          meta.status === "probe-failed"
            ? "metadata-failed"
            : meta.needsTranscode
              ? "downloaded-needs-transcode"
              : "downloaded",
        bytes: file.bytes,
        localPath: rel(file.path),
        sha256: file.sha256,
        packId: pack.id,
        packName: pack.name,
        archiveMember: file.name,
        downloadUrl: record.downloadUrl,
        downloadPage: pack.page,
        licenseUrl: pack.source,
        licenseDetails: record.license,
        evidence: [
          record.licenseEvidence,
          record.hostEvidence,
          ...(record.landingEvidence ? [record.landingEvidence] : []),
        ],
        metadata: meta,
        validation: {
          zipCrcVerified: true,
          videoSignatureVerified: true,
          sha256Verified: true,
        },
        acquiredAt: now(),
      };
      candidates.push(entry);
      await save();
      console.log(
        JSON.stringify({
          at: now(),
          packId: pack.id,
          action: "video-extracted",
          name: entry.name,
          bytes: entry.bytes,
          codec: meta.codec,
        }),
      );
    }
    const actual = candidates.filter((a) => a.packId === pack.id);
    if (actual.length !== record.expectedSelectedVideos || !actual.length)
      throw new Error("Extracted video count does not match safe inventory");
    record.videoCount = actual.length;
    record.status = record.skippedBudget.length
      ? "partial-capacity"
      : "complete";
    delete record.error;
    record.completedAt = now();
    // Reclaim exact verified archive only; always validate absolute path inside DOWNLOADS.
    if (exists(archive)) {
      await unlinkDownload(archive);
      record.archive.retained = false;
      record.archive.removedAt = now();
      record.archive.removalReason =
        "Selected videos verified by CRC/size/SHA256; reclaim ZIP within 9.5 GB allocation";
      if (record.nestedArchive) record.nestedArchive.retained = false;
    }
    attempt.outcome = record.status;
    await event(pack, record.status, {
      videoCount: actual.length,
      laneBytes: await usage(),
      skipped: record.skippedBudget.length,
    });
  } catch (e) {
    record.status = /budget/i.test(e.message)
      ? "capacity-blocked"
      : /Host gate|non-binary|download button/i.test(e.message)
        ? "host-gated"
        : "failed";
    record.error = e.message;
    attempt.outcome = record.status;
    attempt.error = e.message;
    if (["capacity-blocked", "host-gated"].includes(record.status)) {
      for (const name of [
        pack.id + ".zip",
        pack.id + ".zip.part",
        pack.id + "-videos.zip",
      ]) {
        const target = assertPath(path.join(DOWNLOADS, name));
        if (exists(target)) await unlinkDownload(target);
      }
      record.partialBytes = 0;
      if (record.archive) record.archive.retained = false;
      if (record.nestedArchive) record.nestedArchive.retained = false;
      record.cleanupReason =
        "Temporary archives reclaimed after terminal capacity/host limitation; verified extracted videos retained";
    }
    await event(pack, record.status, { error: e.message });
  }
  attempt.endedAt = now();
  await save();
}
try {
  await fsp.writeFile(
    LOCK,
    JSON.stringify({ pid: process.pid, startedAt: now() }),
    { flag: "wx" },
  );
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  const old = JSON.parse(await fsp.readFile(LOCK, "utf8"));
  let alive = true;
  try {
    process.kill(old.pid, 0);
  } catch {
    alive = false;
  }
  if (alive) throw Error("Another pack collector is running");
  await fsp.unlink(assertPath(LOCK));
  await fsp.writeFile(
    LOCK,
    JSON.stringify({ pid: process.pid, startedAt: now() }),
    { flag: "wx" },
  );
}
try {
  await save();
  const chosen = process.argv.includes("--pack")
    ? packs.filter(
        (p) => p.id === process.argv[process.argv.indexOf("--pack") + 1],
      )
    : packs;
  if (!chosen.length) throw new Error("Unknown pack");
  for (const pack of chosen) {
    if (cancel.signal.aborted) break;
    await acquire(pack);
  }
  console.log(
    JSON.stringify({
      action: "lane-finished",
      videos: candidates.length,
      laneBytes: await usage(),
      statuses: state.packs.map((p) => ({
        id: p.id,
        status: p.status,
        videos: p.videoCount,
        error: p.error,
      })),
    }),
  );
} finally {
  await fsp.unlink(assertPath(LOCK)).catch(() => {});
}
