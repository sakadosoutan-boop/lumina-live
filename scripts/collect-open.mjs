import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// No dependencies, credentials, TLS overrides, remote code evaluation or catalog writes.
// One network request at a time. Rerun the same command to recover/retry missing files.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = path.join(ROOT, "assets/media/open");
const SNAP = path.join(ROOT, "research/source-snapshots");
const MANIFEST = path.join(ROOT, "assets/open-candidates.json");
const JOURNAL = path.join(ROOT, "research/open-acquisition.json");
const LOCK = path.join(SNAP, "open-collector.lock");
const GiB = 1024 ** 3;
// Parent reserves 8 GB for packs and 3.3 GB for shared proxies/thumbnails.
const CAP = 8_500_000_000;
const MEDIA_CAP = CAP - 32 * 1024 ** 2; // reserve for evidence, manifests and atomic writes
const MAX_FILE = GiB;
const MAX_SNAPSHOT = 2 * 1024 ** 2;
const MAX_SNAPSHOTS = 12 * 1024 ** 2;
const MAX_ATTEMPTS = 2;
const args = process.argv.slice(2);
if (
  args.some(
    (a) =>
      !["--plan", "--verify-only", "--help"].includes(a) &&
      !/^--limit=\d+$/.test(a),
  )
)
  throw Error("Unknown arguments");
if (args.includes("--help")) {
  console.log(
    "node scripts/collect-open.mjs [--plan | --verify-only] [--limit=N]\n8,500,000,000-byte open lane cap; nature/NASA before Mantissa; one request; two attempts per file per run; .part + validators for resume.",
  );
  process.exit(0);
}
const PLAN = args.includes("--plan");
const VERIFY = args.includes("--verify-only");
const LIMIT = Number(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity,
);
// Close idle connections when switching source hosts. A single retained idle socket
// with maxTotalSockets=1 can strand a request queued for a different host.
const agent = new https.Agent({
  keepAlive: false,
  maxSockets: 1,
  maxTotalSockets: 1,
});
const cancel = new AbortController();
process.on("SIGINT", () => cancel.abort(Error("Interrupted by SIGINT")));
process.on("SIGTERM", () => cancel.abort(Error("Interrupted by SIGTERM")));
const now = () => new Date().toISOString();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const relative = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const exists = async (p) => {
  try {
    return await fs.stat(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
const sha = (data) => createHash("sha256").update(data).digest("hex");
const hashFile = async (p) => {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest("hex");
};
const errorText = (e) => [e.code, e.message].filter(Boolean).join(": ");
function tagged(message, code) {
  const e = Error(message);
  e.code = code;
  return e;
}
function safeName(name) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name))
    throw Error(`Unsafe local filename: ${name}`);
  return name;
}
function canonical(url) {
  const u = new URL(url);
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith("utm_")) u.searchParams.delete(k);
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Only credential-free HTTPS URLs permitted");
  return u.href;
}
function unescapeHTML(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([\da-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}
function links(html, base) {
  const result = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!href) continue;
    try {
      result.push({
        url: canonical(
          new URL(unescapeHTML(href[1] ?? href[2] ?? href[3]), base),
        ),
        text: unescapeHTML(m[2].replace(/<[^>]+>/g, " "))
          .replace(/\s+/g, " ")
          .trim(),
      });
    } catch {
      /* non-HTTPS navigation is not a media source */
    }
  }
  return result;
}
function publishedLink(html, base, predicate) {
  const found = links(html, base).find(predicate);
  if (!found)
    throw tagged(
      `Expected published download not found on ${base}`,
      "SOURCE_LINK_MISSING",
    );
  return found.url;
}
let lastRequest = 0;
async function request(url, headers = {}, redirects = 0) {
  if (cancel.signal.aborted) throw cancel.signal.reason;
  url = canonical(url);
  await delay(Math.max(0, 350 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  const response = await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent,
        signal: cancel.signal,
        headers: {
          "User-Agent":
            "OpenMediaAcquisition/1.0 (bounded personal archive; one connection)",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          ...headers,
        },
      },
      (res) => {
        clearTimeout(deadline);
        resolve(res);
      },
    );
    const deadline = setTimeout(() => {
      const error = tagged(
        "35 second connection/header deadline",
        "NETWORK_TIMEOUT",
      );
      reject(error); // Queued requests must settle even before a socket is assigned.
      req.destroy(error);
    }, 35_000);
    req.setTimeout(30_000, () =>
      req.destroy(tagged("30 second network idle timeout", "NETWORK_TIMEOUT")),
    );
    req.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers.location;
    response.destroy();
    if (!location || redirects >= 5)
      throw tagged("Redirect limit or missing Location", "REDIRECT_LIMIT");
    return request(new URL(location, url).href, headers, redirects + 1);
  }
  response.finalUrl = url;
  return response;
}
async function writeAtomic(target, data, tempName) {
  // Atomic siblings for evidence; explicitly permitted media/snapshot dirs hold JSON temps.
  const temp = path.join(SNAP, safeName(tempName));
  const h = await fs.open(temp, "w");
  try {
    await h.writeFile(data);
    await h.sync();
  } finally {
    await h.close();
  }
  // OneDrive/indexers/readers can briefly hold the destination open on Windows.
  // Keep the old complete JSON intact and retry the atomic replacement.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, target);
      break;
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || attempt >= 7)
        throw e;
      await delay(Math.min(1000, 100 * 2 ** attempt));
    }
  }
}
async function diskBytes(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw Error(`Refusing symlink in managed output: ${p}`);
    if (entry.isDirectory()) total += await diskBytes(p);
    else if (entry.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}
let state,
  catalog = [],
  mediaBytes = 0,
  ffmpeg,
  ffmpegVersion,
  acquiredThisRun = 0,
  discoveryKeys;
let discoveredIds = new Set();
async function persist() {
  const entries = Object.values(state.entries);
  catalog = entries
    .filter(
      (e) => e.status === "acquired" && e.asset.probe?.status === "verified",
    )
    .map((e) => e.asset);
  state.updatedAt = now();
  state.summary = {
    planned: entries.length,
    acquired: catalog.length,
    missing: entries.length - catalog.length,
    acquiredBytes: catalog.reduce((s, a) => s + a.bytes, 0),
    mediaDiskBytes: mediaBytes,
    capBytes: CAP,
    mediaCapBytes: MEDIA_CAP,
    remainingMediaBytes: Math.max(0, MEDIA_CAP - mediaBytes),
    verifiedVideos: catalog.filter((a) => a.probe?.status === "verified")
      .length,
    pendingProbes: catalog.filter((a) => a.probe?.status !== "verified").length,
    byProvider: Object.fromEntries(
      [...new Set(entries.map((e) => e.provider))].map((provider) => {
        const group = entries.filter((e) => e.provider === provider);
        return [
          provider,
          {
            planned: group.length,
            acquired: group.filter((e) => e.status === "acquired").length,
            bytes: group.reduce(
              (s, e) => s + (e.status === "acquired" ? e.asset.bytes : 0),
              0,
            ),
          },
        ];
      }),
    ),
  };
  state.missing = entries
    .filter((e) => e.status !== "acquired")
    .map((e) => ({
      id: e.id,
      provider: e.provider,
      status: e.status,
      downloadUrl: e.downloadUrl,
      localPath: e.localPath,
      partialBytes: e.partialBytes ?? 0,
      error: e.error ?? null,
      attempts: e.attempts ?? 0,
    }));
  await writeAtomic(
    MANIFEST,
    JSON.stringify(catalog, null, 2) + "\n",
    "open-candidates.json.part",
  );
  await writeAtomic(
    JOURNAL,
    JSON.stringify(state, null, 2) + "\n",
    "open-acquisition.json.part",
  );
}
async function snapshot(key, url, localInput) {
  const file = path.join(SNAP, safeName(`open-${key}.html`));
  const cached = await exists(file);
  let data, responseInfo;
  if (cached) {
    if (cached.size > MAX_SNAPSHOT)
      throw Error("Cached evidence exceeds limit");
    data = await fs.readFile(file);
    responseInfo = state.sources[key] ?? {
      observedAt: cached.mtime.toISOString(),
      retrieval: "existing local snapshot",
    };
  } else if (localInput) {
    data = await fs.readFile(localInput);
    responseInfo = {
      observedAt: now(),
      retrieval: "parent-retrieved source HTML",
      inputPath: localInput,
      inputModifiedAt: (await fs.stat(localInput)).mtime.toISOString(),
    };
  } else {
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await request(url, { Accept: "text/html,application/xhtml+xml" });
        if (res.statusCode !== 200)
          throw tagged(
            `Evidence HTTP ${res.statusCode}: ${url}`,
            `HTTP_${res.statusCode}`,
          );
        const length = Number(res.headers["content-length"]);
        if (Number.isFinite(length) && length > MAX_SNAPSHOT)
          throw tagged("Evidence Content-Length exceeds limit", "SIZE_LIMIT");
        const chunks = [];
        let size = 0;
        for await (const chunk of res) {
          size += chunk.length;
          if (size > MAX_SNAPSHOT)
            throw tagged("Evidence stream exceeds limit", "SIZE_LIMIT");
          chunks.push(chunk);
        }
        data = Buffer.concat(chunks);
        responseInfo = {
          observedAt: now(),
          retrieval: "HTTPS GET",
          finalUrl: res.finalUrl,
          httpStatus: res.statusCode,
          contentType: res.headers["content-type"],
          etag: res.headers.etag,
          lastModified: res.headers["last-modified"],
        };
        break;
      } catch (e) {
        last = e;
        res?.destroy();
        if (
          cancel.signal.aborted ||
          /^HTTP_4/.test(e.code ?? "") ||
          e.code === "SIZE_LIMIT"
        )
          break;
        if (attempt < MAX_ATTEMPTS) await delay(2500);
      }
    }
    if (!data) throw last;
  }
  if (data.length > MAX_SNAPSHOT) throw Error("Source snapshot too large");
  if (!cached) {
    if ((await diskBytes(SNAP)) + data.length > MAX_SNAPSHOTS)
      throw Error("Total source evidence budget exceeded");
    await writeAtomic(file, data, `open-${key}.html.part`);
  }
  state.sources[key] = {
    ...responseInfo,
    url,
    localPath: file,
    bytes: data.length,
    sha256: sha(data),
  };
  delete state.sourceErrors[key];
  return data.toString("utf8");
}
function evidence(key, excerpt) {
  const s = state.sources[key];
  if (!s) throw Error(`Missing evidence ${key}`);
  return {
    url: s.url,
    localPath: s.localPath,
    sha256: s.sha256,
    observedAt: s.observedAt,
    excerpt,
  };
}
function rights(license, policyKey, excerpt, attribution, extra = {}) {
  return {
    label: license,
    attribution,
    evidence: [evidence(policyKey, excerpt)],
    commercialProjection: "permitted under stated rights; no endorsement",
    localStorageAndEditing: "permitted",
    redistribution: "permitted subject to attribution and stated exceptions",
    ...extra,
  };
}
function add({
  id,
  name,
  provider,
  downloadUrl,
  source,
  filename,
  tags,
  hue = 0,
  energy = 0.5,
  sourceRights,
  assetEvidenceKey,
  publishedDate,
  loop = "not verified seamless",
}) {
  safeName(filename);
  downloadUrl = canonical(downloadUrl);
  const duplicate = Object.values(state.entries).find(
    (e) => e.downloadUrl === downloadUrl && e.id !== id,
  );
  if (duplicate) {
    state.duplicates.push({ id, duplicateOf: duplicate.id, downloadUrl });
    return;
  }
  const localPath = path.join(MEDIA, filename);
  const previous = state.entries[id];
  if (
    previous &&
    (previous.downloadUrl !== downloadUrl || previous.localPath !== localPath)
  )
    throw Error(`Candidate identity changed: ${id}`);
  const base = {
    id,
    name,
    kind: "video",
    url: `/assets/media/open/${filename}`,
    tags,
    hue,
    energy,
    license: sourceRights.label,
    source,
    attribution: sourceRights.attribution,
    localPath,
    downloadUrl,
    provider,
    publishedDate,
    loop,
    metadataNote:
      "hue and energy are neutral curation defaults, not measurements",
    sourceRights: {
      ...sourceRights,
      evidence: [
        ...sourceRights.evidence,
        ...(assetEvidenceKey
          ? [
              evidence(
                assetEvidenceKey,
                "Asset page publishes the selected download link and its credit/source information.",
              ),
            ]
          : []),
      ],
    },
  };
  state.entries[id] = {
    ...previous,
    id,
    provider,
    downloadUrl,
    localPath,
    status: previous?.status ?? "queued",
    asset: { ...previous?.asset, ...base },
  };
  discoveredIds.add(id);
}
async function group(key, callback) {
  if (discoveryKeys && !discoveryKeys.includes(key)) return;
  if (cancel.signal.aborted) return;
  discoveredIds = new Set();
  console.log(`[source] ${key}`);
  state.run.phase = `source:${key}`;
  await persist();
  try {
    await callback();
    delete state.sourceErrors[key];
  } catch (e) {
    state.sourceErrors[key] = { error: errorText(e), at: now() };
    console.error(`[source:${key}] ${errorText(e)}`);
  }
  await persist();
}
async function discoverMantissa() {
  await group("mantissa", async () => {
    const url = "https://mantissa.xyz/vj.html";
    const html = await snapshot(
      "mantissa",
      url,
      path.join(ROOT, "research/mantissa.html"),
    );
    const count = Number(/var\s+numLoops\s*=\s*(\d+)/.exec(html)?.[1]);
    const base = /var\s+baseUrl\s*=\s*"([^"]+)"/.exec(html)?.[1];
    const prefix = /var\s+loopPrefix\s*=\s*"([^"]+)"/.exec(html)?.[1];
    if (
      count !== 127 ||
      base !== "https://ftp.mantissa.xyz/vj_loops/" ||
      prefix !== "mantissa.xyz_loop_" ||
      !/h264Link\.href\s*=\s*baseUrl\s*\+\s*loopPrefix\s*\+\s*pad\(i,\s*3\)\s*\+\s*'\.mp4'/.test(
        html,
      ) ||
      !html.includes("licensed CC0 (Public Domain)")
    )
      throw Error(
        "Mantissa published generator or CC0 declaration no longer matches inspected source",
      );
    state.discovery.mantissa = {
      publishedCount: count,
      derivation:
        "Literal numLoops/baseUrl/loopPrefix + h264Link.href expression from saved HTML; remote script is never evaluated.",
    };
    for (let n = 1; n <= count; n++) {
      const number = String(n).padStart(3, "0");
      add({
        id: `open-mantissa-${number}`,
        name: `Mantissa ${number}`,
        provider: "Mantissa",
        downloadUrl: `${base}${prefix}${number}.mp4`,
        filename: `mantissa-${number}.mp4`,
        source: url,
        tags: ["open", "cc0", "abstract", "vj-loop", "mantissa"],
        loop: "creator labels VJ loop; seam not tested",
        sourceRights: rights(
          "CC0-1.0",
          "mantissa",
          "Free VJ loops for all your projects, licensed CC0 (Public Domain) so you can use them for anything. Credit isn't required but always appreciated.",
          "Midge “Mantissa” Sinnaeve — mantissa.xyz (optional)",
          {
            licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
            jurisdiction: "worldwide dedication to extent permitted by law",
            redistribution: "permitted, attribution not required",
            confidence: "high",
          },
        ),
      });
    }
  });
}
async function discover() {
  await group("nasa-toolkit", async () => {
    const html = await snapshot(
      "nasa-14126",
      "https://svs.gsfc.nasa.gov/14126/",
    );
    const policy = await snapshot(
      "nasa-svs-rights",
      "https://svs.gsfc.nasa.gov/help/",
    );
    await snapshot(
      "nasa-media-guidelines",
      "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    );
    if (!policy.includes("All of our content is in the public domain"))
      throw Error("NASA SVS public-domain statement missing");
    const mp4s = [
      ...new Set(
        links(html, "https://svs.gsfc.nasa.gov/14126/")
          .map((l) => l.url)
          .filter(
            (u) =>
              new URL(u).hostname === "svs.gsfc.nasa.gov" &&
              /\/a014126\/[^/]+\.mp4$/i.test(new URL(u).pathname),
          ),
      ),
    ];
    if (mp4s.length < 10 || mp4s.length > 80)
      throw Error(`Unexpected toolkit MP4 count ${mp4s.length}`);
    state.discovery.nasa14126 = {
      uniquePublishedMp4s: mp4s.length,
      downloads: mp4s,
    };
    for (const downloadUrl of mp4s) {
      const original = path.basename(new URL(downloadUrl).pathname);
      const slug = original
        .slice(0, -4)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      add({
        id: `open-nasa-14126-${slug}`,
        name: `SDO — ${original.slice(0, -4).replace(/_/g, " ")}`,
        provider: "NASA SVS",
        source: "https://svs.gsfc.nasa.gov/14126/",
        downloadUrl,
        filename: `nasa-14126-${safeName(original)}`,
        tags: ["open", "space", "sun", "solar", "nasa"],
        publishedDate: "2022-04-01",
        assetEvidenceKey: "nasa-14126",
        sourceRights: rights(
          "Public domain (NASA SVS; U.S. copyright status)",
          "nasa-svs-rights",
          "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit.",
          "NASA's Goddard Space Flight Center",
          {
            jurisdiction:
              "PD claim is U.S. status; not an independent worldwide legal determination",
            confidence: "high",
            audioUse:
              "visual layer cleared; separately licensed audio is excluded; mute for VJ use unless independently cleared",
            exceptions:
              "Third-party marked material, logos, identifiable people and endorsement remain subject to NASA guidelines.",
          },
        ),
      });
    }
  });
  const ccby = (key, attribution) =>
    rights(
      "CC-BY-4.0",
      key,
      "Published official policy licenses video under Creative Commons Attribution 4.0, subject to item-specific exceptions.",
      attribution,
      {
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        confidence: "high",
        redistribution:
          "permitted with full creator credit, license URL and indication of changes",
        creditPresentation:
          "Full footage credit visibly associated with projection, e.g. a visible end-credit slate; retain it with redistributed media.",
        audioUse:
          "Separate music is not covered by the general footage policy; use visual layer only.",
      },
    );
  await group("nasa-planets", async () => {
    const url = "https://svs.gsfc.nasa.gov/20249/";
    const html = await snapshot("nasa-20249", url);
    add({
      id: "open-nasa-solar-system-4k",
      name: "Solar System Animation — 4K",
      provider: "NASA SVS",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        l.url.endsWith("/SolarSystem_H264_4K.mov"),
      ),
      filename: "nasa-solar-system-4k.mov",
      tags: ["open", "space", "planets", "nasa"],
      assetEvidenceKey: "nasa-20249",
      publishedDate: "2016-09-20",
      sourceRights: rights(
        "Public domain (NASA SVS; U.S. copyright status)",
        "nasa-svs-rights",
        "SVS content is public domain unless otherwise noted and free to download, use and redistribute for any purpose.",
        "NASA's Goddard Space Flight Center Conceptual Image Lab",
        {
          confidence: "high",
          audioUse: "Visual layer; separately licensed audio excluded",
          jurisdiction: "U.S. PD claim",
        },
      ),
    });
  });
  await group("eso", async () => {
    const policy = await snapshot(
      "eso-rights",
      "https://eso.org/public/outreach/copyright/",
    );
    if (!/Attribution 4\.0/i.test(policy))
      throw Error("ESO CC-BY policy missing");
    const url = "https://www.eso.org/public/videos/uhd_yb_paranal_01/";
    const html = await snapshot("eso-milky-way", url);
    add({
      id: "open-eso-milky-way",
      name: "Milky Way Revealed — Paranal",
      provider: "ESO",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /\/ultra_hd\/uhd_yb_paranal_01\.mp4$/.test(l.url),
      ),
      filename: "eso-milky-way-4k.mp4",
      tags: ["open", "space", "stars", "night-sky", "timelapse"],
      assetEvidenceKey: "eso-milky-way",
      publishedDate: "2014-05-09",
      sourceRights: ccby("eso-rights", "ESO/B. Tafreshi"),
    });
  });
  await group("hubble", async () => {
    const policy = await snapshot(
      "hubble-rights",
      "https://esahubble.org/copyright/",
    );
    if (!/Attribution 4\.0/.test(policy))
      throw Error("ESA/Hubble CC-BY policy missing");
    const url = "https://esahubble.org/videos/heic1501f/";
    const html = await snapshot("hubble-pillars", url);
    add({
      id: "open-hubble-pillars",
      name: "Pillars of Creation — Zoom",
      provider: "ESA/Hubble",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /hd_1080p25_screen\/heic1501f\.mp4$/.test(l.url),
      ),
      filename: "hubble-pillars-1080.mp4",
      tags: ["open", "space", "nebula", "stars", "zoom"],
      assetEvidenceKey: "hubble-pillars",
      publishedDate: "2015-01-05",
      sourceRights: ccby(
        "hubble-rights",
        "NASA, ESA/Hubble and the Hubble Heritage Team",
      ),
    });
  });
  await group("noaa", async () => {
    const policy = await snapshot(
      "noaa-rights",
      "https://oceanexplorer.noaa.gov/faqs/",
    );
    if (!/public domain/i.test(policy))
      throw Error("NOAA public-domain statement missing");
    const url =
      "https://oceanexplorer.noaa.gov/multimedia/video-playlist-extras-diving/";
    const html = await snapshot("noaa-details", url);
    add({
      id: "open-noaa-diving-details",
      name: "Diving for Details — Deep Ocean",
      provider: "NOAA Ocean Exploration",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /details-1280x720.*\.mp4/.test(l.url),
      ),
      filename: "noaa-diving-details.mp4",
      tags: ["open", "nature", "ocean", "marine", "macro"],
      assetEvidenceKey: "noaa-details",
      sourceRights: rights(
        "Public domain (NOAA; U.S. copyright status)",
        "noaa-rights",
        "Unless otherwise noted (copyrighted material for example), information presented on this website is in the public domain and may be distributed freely.",
        "NOAA Ocean Exploration",
        {
          confidence: "high",
          jurisdiction: "U.S. PD claim; caption exceptions must be respected",
          audioUse:
            "Use visual layer; no separate soundtrack clearance asserted.",
        },
      ),
    });
  });
  await group("noaa-jellyfish", async () => {
    const policy = await snapshot(
      "noaa-rights",
      "https://oceanexplorer.noaa.gov/faqs/",
    );
    if (!/public domain/i.test(policy))
      throw Error("NOAA public-domain statement missing");
    // Single curated official HD clip, checked 2026-09-09; no index/bulk crawling.
    const url =
      "https://oceanexplorer.noaa.gov/multimedia/okeanos-explorations-ex2107-gallery-media-dive03-jellyfish/";
    const html = await snapshot("noaa-jellyfish-ex2107", url);
    const credit = "NOAA Ocean Exploration, Windows to the Deep 2021";
    if (!html.includes(credit))
      throw Error("NOAA jellyfish item credit changed");
    add({
      id: "open-noaa-jellyfish-ex2107",
      name: "Narcomedusae Jellyfish — Deep Ocean",
      provider: "NOAA Ocean Exploration",
      source: url,
      downloadUrl: publishedLink(
        html,
        url,
        (l) =>
          /^HD version/.test(l.text) &&
          new URL(l.url).hostname === "oceanexplorer.noaa.gov" &&
          /\.mp4$/i.test(l.url),
      ),
      filename: "noaa-jellyfish-ex2107-hd.mp4",
      tags: ["open", "nature", "ocean", "marine", "jellyfish"],
      assetEvidenceKey: "noaa-jellyfish-ex2107",
      sourceRights: rights(
        "Public domain (NOAA; U.S. copyright status)",
        "noaa-rights",
        "Unless otherwise noted, information presented on this website is in the public domain and may be distributed freely; use the credit from the original source page.",
        credit,
        {
          confidence: "high",
          jurisdiction:
            "U.S. PD claim; item credits and copyright exceptions checked",
          audioUse:
            "Use visual layer; no separate soundtrack clearance asserted.",
        },
      ),
    });
  });
  await group("usgs", async () => {
    const url = "https://www.usgs.gov/media/videos/lava-flow";
    const html = await snapshot("usgs-lava", url);
    if (!/Public Domain/i.test(html))
      throw Error("USGS asset PD label missing");
    add({
      id: "open-usgs-lava-flow",
      name: "Lava Flow — Hawaii",
      provider: "USGS",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /20030607-0602-clipped\.mp4/.test(l.url),
      ),
      filename: "usgs-lava-flow.mp4",
      tags: ["open", "nature", "lava", "volcano"],
      publishedDate: "2003-06-07",
      sourceRights: rights(
        "Public domain (USGS; U.S. copyright status)",
        "usgs-lava",
        "Sources/Usage: Public Domain.",
        "USGS / Hawaiian Volcano Observatory",
        { confidence: "high", jurisdiction: "U.S. PD claim" },
      ),
    });
  });
  await group("nps", async () => {
    const url =
      "https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96";
    const html = await snapshot("nps-rainfall", url);
    if (!/Public domain:Full Granting Rights/i.test(html))
      throw Error("NPS explicit PD rights label missing");
    add({
      id: "open-nps-summer-rainfall",
      name: "Summer Rainfall — Zion Canyon",
      provider: "National Park Service",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /GetAsset\/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96\/original/.test(l.url),
      ),
      filename: "nps-zion-rainfall.mp4",
      tags: ["open", "nature", "rain", "waterfall", "canyon"],
      publishedDate: "2023-08-02",
      sourceRights: rights(
        "Public domain (NPS; U.S. copyright status)",
        "nps-rainfall",
        "Constraints Information: Public domain:Full Granting Rights.",
        "NPS / Ally O'Rullian",
        {
          confidence: "high",
          jurisdiction: "U.S. PD claim",
          exceptions:
            "Includes people, signs and vehicles; no endorsement or personality-rights clearance asserted.",
        },
      ),
    });
  });
  await group("commons", async () => {
    const url =
      "https://commons.wikimedia.org/wiki/File:Staircase_Falls_timelapse_Yosemite_CA_2023-07-13_07-23-07_1.webm";
    const html = await snapshot("commons-staircase", url);
    if (!html.includes("creativecommons.org/licenses/by/4.0"))
      throw Error("Commons asset CC-BY license missing");
    add({
      id: "open-commons-staircase-falls",
      name: "Staircase Falls — Yosemite Timelapse",
      provider: "Wikimedia Commons / G. Edward Johnson",
      source: url,
      downloadUrl: publishedLink(html, url, (l) => l.text === "Original file"),
      filename: "commons-staircase-falls-4k.webm",
      tags: ["open", "nature", "waterfall", "timelapse", "yosemite"],
      publishedDate: "2023-07-13",
      sourceRights: {
        ...ccby("commons-staircase", "G. Edward Johnson"),
        evidence: [
          evidence(
            "commons-staircase",
            "Own work; G. Edward Johnson; Creative Commons Attribution 4.0 International.",
          ),
        ],
        audioUse:
          "Asset-level video CC-BY license; audio presence checked in probe.",
      },
    });
  });
  await group("blender", async () => {
    const policy = await snapshot(
      "spring-rights",
      "https://studio.blender.org/projects/spring/pages/about/",
    );
    if (!/Attribution 4\.0/.test(policy))
      throw Error("Spring CC-BY declaration missing");
    const url =
      "https://commons.wikimedia.org/wiki/File:Spring_-_Blender_Open_Movie.webm";
    const html = await snapshot("spring-mirror", url);
    add({
      id: "open-blender-spring",
      name: "Spring — Blender Open Movie",
      provider: "Blender Foundation",
      source: "https://studio.blender.org/projects/spring/pages/about/",
      downloadUrl: publishedLink(html, url, (l) => l.text === "Original file"),
      filename: "blender-spring.webm",
      tags: ["open", "animation", "forest", "fantasy", "nature"],
      publishedDate: "2019-04-04",
      assetEvidenceKey: "spring-mirror",
      sourceRights: {
        ...ccby(
          "spring-rights",
          "© Blender Foundation | cloud.blender.org/spring",
        ),
        audioUse:
          "Official Spring movie CC-BY license; unrelated site material and trademarks excluded.",
      },
    });
  });
  await group("prelinger", async () => {
    const url = "https://archive.org/details/MarketStreet19064KScan20181016";
    const html = await snapshot("prelinger-market-street", url);
    if (!html.includes("Anyone may reproduce or reuse this scan"))
      throw Error("Asset-specific scan reuse grant missing");
    add({
      id: "open-prelinger-market-street",
      name: "Market Street 1906 — Restored Moving View",
      provider: "Prelinger Archives / Internet Archive",
      source: url,
      downloadUrl: publishedLink(html, url, (l) =>
        /MarketStreet_4K_to_2K_cropped_higher_contrast\.mp4$/.test(l.url),
      ),
      filename: "prelinger-market-street.mp4",
      tags: ["open", "archive", "vintage", "city", "monochrome"],
      publishedDate: "2018-10-16",
      sourceRights: rights(
        "1906 underlying film; explicit Prelinger scan reuse permission (not CC0)",
        "prelinger-market-street",
        "Anyone may reproduce or reuse this scan. Please attribute it to its source: Prelinger Archives.",
        "Prelinger Archives",
        {
          confidence:
            "high for scan reuse grant; no independent worldwide PD determination",
          jurisdiction:
            "Underlying film PD-US by age; scan publisher grants reproduction/reuse",
          audioUse: "Source identifies this scan as silent.",
        },
      ),
    });
  });
}
async function locateFFmpeg() {
  const bundled = path.join(
    ROOT,
    "node_modules/ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  for (const candidate of [bundled, "ffmpeg"]) {
    try {
      const { stdout } = await promisify(execFile)(candidate, ["-version"], {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      });
      ffmpeg = candidate;
      ffmpegVersion = stdout.split(/\r?\n/)[0];
      return;
    } catch {
      /* parent may not have installed ffmpeg yet */
    }
  }
}
async function probe(file) {
  if (!ffmpeg)
    return {
      status: "pending",
      reason: "ffmpeg unavailable; rerun --verify-only after installation",
      checkedAt: now(),
    };
  try {
    const { stderr } = await promisify(execFile)(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-v",
        "info",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 ** 2 },
    );
    const input = stderr.split("Stream mapping:")[0];
    const video = input
      .split(/\r?\n/)
      .find((s) => /Stream #0:.*Video:/.test(s));
    const dimensions = /\b(\d{2,5})x(\d{2,5})\b/.exec(video ?? "");
    const duration = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(input);
    if (!video || !dimensions || !/frame=\s*1\b/.test(stderr))
      throw Error("No decoded video frame/dimensions found");
    return {
      status: "verified",
      tool: ffmpegVersion,
      checkedAt: now(),
      firstFrameDecoded: true,
      codec: /Video:\s*([^, ]+)/.exec(video)?.[1],
      width: +dimensions[1],
      height: +dimensions[2],
      fps: Number(/([\d.]+) fps/.exec(video)?.[1]) || null,
      durationSeconds: duration
        ? +duration[1] * 3600 + +duration[2] * 60 + +duration[3]
        : null,
      audioPresent: /Stream #0:.*Audio:/.test(input),
      inputStream: video.trim(),
    };
  } catch (e) {
    return {
      status: "failed",
      tool: ffmpegVersion,
      checkedAt: now(),
      error: errorText(e),
      diagnostic: String(e.stderr ?? "").slice(-3000),
    };
  }
}
async function magic(file) {
  const h = await fs.open(file, "r");
  const b = Buffer.alloc(512);
  try {
    const { bytesRead } = await h.read(b, 0, b.length, 0);
    return (
      b.subarray(0, bytesRead).includes(Buffer.from("ftyp")) ||
      b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    );
  } finally {
    await h.close();
  }
}
async function finalize(entry, part, fromExisting = false) {
  const target = entry.localPath;
  const source = fromExisting ? target : part;
  const stat = await fs.stat(source);
  if (stat.size < 1024 || !(await magic(source)))
    throw tagged(
      "Downloaded payload is not a recognized MP4/MOV/WebM",
      "INVALID_MEDIA",
    );
  const hash = await hashFile(source);
  if (fromExisting && entry.asset.sha256 && hash !== entry.asset.sha256)
    throw tagged("Saved SHA256 does not match existing file", "HASH_MISMATCH");
  if (!fromExisting) {
    entry.phase = "hashed-awaiting-rename";
    entry.asset.sha256 = hash;
    entry.partialBytes = stat.size;
    await persist();
    await fs.rename(part, target);
  }
  const metadata =
    fromExisting &&
    entry.asset.sha256 === hash &&
    entry.asset.probe?.status === "verified"
      ? entry.asset.probe
      : await probe(target);
  entry.asset = {
    ...entry.asset,
    status: metadata.status === "failed" ? "acquired-probe-failed" : "acquired",
    bytes: stat.size,
    acquiredBytes: stat.size,
    sha256: hash,
    acquiredAt: entry.asset.acquiredAt ?? now(),
    verifiedAt: now(),
    resolvedDownloadUrl:
      entry.response?.finalUrl ?? entry.asset.resolvedDownloadUrl,
    probe: metadata,
  };
  if (metadata.durationSeconds != null)
    entry.asset.duration = metadata.durationSeconds;
  entry.partialBytes = 0;
  entry.phase = "complete";
  entry.status = metadata.status === "failed" ? "probe-failed" : "acquired";
  entry.error = metadata.status === "failed" ? metadata.error : null;
  await persist();
}
async function download(entry) {
  const part = entry.localPath + ".part";
  const initial = await exists(part);
  const partialSize = initial?.size ?? 0;
  const previous = entry.response;
  const validator =
    previous?.etag && !previous.etag.startsWith("W/")
      ? previous.etag
      : previous?.lastModified;
  const resume =
    partialSize > 0 && validator && previous?.expectedTotal > partialSize;
  const offset = resume ? partialSize : 0;
  const headers = resume
    ? { Range: `bytes=${offset}-`, "If-Range": validator }
    : {};
  let res, handle, timer;
  try {
    res = await request(entry.downloadUrl, headers);
    timer = setTimeout(
      () =>
        res.destroy(
          tagged("File transfer exceeded 12 minutes", "TRANSFER_TIMEOUT"),
        ),
      12 * 60_000,
    );
    if (![200, 206].includes(res.statusCode))
      throw tagged(`HTTP ${res.statusCode}`, `HTTP_${res.statusCode}`);
    const contentType = String(res.headers["content-type"] ?? "")
      .split(";")[0]
      .trim();
    if (
      contentType &&
      !/^(video\/|application\/(octet-stream|binary|x-binary|ogg))/.test(
        contentType,
      )
    )
      throw tagged(
        `Unexpected media Content-Type ${contentType}`,
        "INVALID_CONTENT_TYPE",
      );
    if (
      res.headers["content-encoding"] &&
      res.headers["content-encoding"] !== "identity"
    )
      throw tagged("Unexpected encoded media response", "ENCODED_MEDIA");
    const lengthText = res.headers["content-length"];
    if (lengthText != null && !/^\d+$/.test(lengthText))
      throw tagged("Invalid Content-Length", "INVALID_LENGTH");
    const length = lengthText == null ? null : Number(lengthText);
    let start = 0,
      total = length;
    if (res.statusCode === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        String(res.headers["content-range"]),
      );
      if (
        !resume ||
        !range ||
        +range[1] !== offset ||
        +range[2] !== +range[3] - 1 ||
        (length != null && +range[2] - +range[1] + 1 !== length) ||
        +range[3] !== previous.expectedTotal
      )
        throw tagged("Inconsistent resumed Content-Range", "INVALID_RANGE");
      start = offset;
      total = +range[3];
    }
    if (
      total != null &&
      (!Number.isSafeInteger(total) || total < 1024 || total > MAX_FILE)
    )
      throw tagged(
        `Content-Length ${total} exceeds valid per-file bounds`,
        "SIZE_LIMIT",
      );
    const retainedOtherBytes = mediaBytes - partialSize;
    if (total != null && retainedOtherBytes + total > MEDIA_CAP)
      throw tagged(
        `File would exceed ${CAP}-byte open lane cap (${total} bytes)`,
        "BUDGET_LIMIT",
      );
    entry.response = {
      finalUrl: res.finalUrl,
      contentType,
      contentLength: length,
      expectedTotal: total,
      etag: res.headers.etag,
      lastModified: res.headers["last-modified"],
      httpStatus: res.statusCode,
      resumedFrom: start,
      receivedAt: now(),
    };
    entry.status = "downloading";
    entry.phase = "streaming";
    entry.partialBytes = start;
    await persist();
    handle = await fs.open(part, start ? "a" : "w");
    mediaBytes -= partialSize - start;
    let size = start,
      checkpoint = Date.now();
    for await (const chunk of res) {
      if (cancel.signal.aborted) throw cancel.signal.reason;
      if (
        size + chunk.length > MAX_FILE ||
        mediaBytes + chunk.length > MEDIA_CAP ||
        (total != null && size + chunk.length > total)
      )
        throw tagged("Stream exceeded declared or budget limit", "SIZE_LIMIT");
      let written = 0;
      while (written < chunk.length) {
        const result = await handle.write(
          chunk,
          written,
          chunk.length - written,
          null,
        );
        if (!result.bytesWritten) throw Error("No progress writing media");
        written += result.bytesWritten;
        size += result.bytesWritten;
        mediaBytes += result.bytesWritten;
      }
      entry.partialBytes = size;
      if (Date.now() - checkpoint > 15_000) {
        await persist();
        console.log(
          `[partial] ${entry.id} ${(size / 1024 ** 2).toFixed(1)} MiB`,
        );
        checkpoint = Date.now();
      }
    }
    if (!res.complete || (total != null && size !== total))
      throw tagged(`Truncated response: ${size}/${total}`, "TRUNCATED");
    await handle.sync();
    await handle.close();
    handle = null;
    clearTimeout(timer);
    entry.response.completed = true;
    await finalize(entry, part);
  } finally {
    if (timer) clearTimeout(timer);
    res?.destroy();
    if (handle) await handle.close();
  }
}
async function acquire(entry) {
  const final = await exists(entry.localPath);
  if (final) {
    try {
      await finalize(entry, entry.localPath + ".part", true);
      console.log(`[verified existing] ${entry.id}`);
    } catch (e) {
      // A journal/manifest I/O failure is not evidence that the media is corrupt.
      if (!["INVALID_MEDIA", "HASH_MISMATCH", "ENOENT"].includes(e.code))
        throw e;
      entry.status = "existing-file-invalid";
      entry.error = errorText(e);
      await persist();
    }
    return;
  }
  if (VERIFY) {
    // Preserve the useful HTTP/capacity failure when an offline audit finds no file.
    if (
      entry.status === "acquired" ||
      entry.status === "downloading" ||
      entry.status === "queued"
    ) {
      entry.status = "missing";
      entry.error = "No completed local file";
    }
    entry.partialBytes = (await exists(entry.localPath + ".part"))?.size ?? 0;
    await persist();
    return;
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (cancel.signal.aborted) return;
    entry.attempts = (entry.attempts ?? 0) + 1;
    entry.lastAttemptAt = now();
    console.log(`[download ${attempt}/${MAX_ATTEMPTS}] ${entry.id}`);
    try {
      await download(entry);
      acquiredThisRun++;
      console.log(
        `[${entry.status}] ${entry.id} ${(entry.asset.bytes / 1024 ** 2).toFixed(2)} MiB; total ${(mediaBytes / GiB).toFixed(3)} GiB; probe ${entry.asset.probe.status}`,
      );
      return;
    } catch (e) {
      entry.status =
        e.code === "BUDGET_LIMIT"
          ? "skipped-budget"
          : e.code === "SIZE_LIMIT"
            ? "skipped-size-limit"
            : cancel.signal.aborted
              ? "interrupted"
              : "failed";
      entry.error = errorText(e);
      entry.partialBytes = (await exists(entry.localPath + ".part"))?.size ?? 0;
      await persist();
      console.error(`[${entry.status}] ${entry.id}: ${entry.error}`);
      const terminal =
        /^(HTTP_4|BUDGET_LIMIT|SIZE_LIMIT|INVALID_|ENCODED_|HASH_MISMATCH)/.test(
          e.code ?? "",
        );
      if (terminal || cancel.signal.aborted) return;
      if (attempt < MAX_ATTEMPTS) await delay(3000);
    }
  }
}
let ownsLock = false;
try {
  await fs.mkdir(MEDIA, { recursive: true });
  await fs.mkdir(SNAP, { recursive: true });
  try {
    await fs.writeFile(
      LOCK,
      JSON.stringify({ pid: process.pid, startedAt: now() }),
      { flag: "wx" },
    );
    ownsLock = true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const lock = JSON.parse(await fs.readFile(LOCK, "utf8"));
    let alive = true;
    try {
      process.kill(lock.pid, 0);
    } catch (err) {
      if (err.code === "ESRCH") alive = false;
      else throw err;
    }
    if (alive)
      throw Error(
        `Collector already running (PID ${lock.pid}); no second worker started`,
      );
    await fs.unlink(LOCK);
    await fs.writeFile(
      LOCK,
      JSON.stringify({ pid: process.pid, startedAt: now() }),
      { flag: "wx" },
    );
    ownsLock = true;
  }
  state = (await exists(JOURNAL))
    ? JSON.parse(await fs.readFile(JOURNAL, "utf8"))
    : {
        version: 1,
        createdAt: now(),
        entries: {},
        sources: {},
        sourceErrors: {},
        discovery: {},
        duplicates: [],
      };
  if (state.run)
    state.previousRuns = [...(state.previousRuns ?? []), state.run].slice(-10);
  state.settings = {
    capBytes: CAP,
    mediaCapBytes: MEDIA_CAP,
    maxFileBytes: MAX_FILE,
    parallelRequests: 1,
    delayBetweenRequestsMs: 350,
    attemptsPerFilePerRun: MAX_ATTEMPTS,
    idleTimeoutMs: 30_000,
    headerDeadlineMs: 35_000,
    fileDeadlineMs: 720_000,
    credentialUse: false,
    tlsValidation: true,
    priority: [
      "NOAA",
      "USGS",
      "National Park Service",
      "waterfalls",
      "NASA SVS",
      "ESO",
      "ESA/Hubble",
      "Mantissa",
    ],
    sharedBudget: {
      totalBytes: 20_000_000_000,
      packsBytes: 9_500_000_000,
      parentProxyThumbnailReserveBytes: 1_900_000_000,
    },
    proxyOwner: "parent scripts/build-catalog.mjs",
  };
  state.run = {
    startedAt: now(),
    mode: VERIFY ? "verify-only" : PLAN ? "plan" : "acquire",
    pid: process.pid,
    status: "running",
  };
  mediaBytes = await diskBytes(MEDIA);
  if (mediaBytes > MEDIA_CAP)
    throw Error("Managed media already exceeds lane budget");
  await persist(); // Publish an empty/recovered manifest before any network access.
  await locateFFmpeg();
  state.probeTool = ffmpegVersion ?? "unavailable";
  if (!PLAN && !ffmpeg)
    throw Error(
      "ffmpeg required: do not acquire files that cannot be verified",
    );
  if (!VERIFY) {
    // Discover and acquire one official source at a time, before touching more Mantissa.
    // Long film/archival sources remain implemented above but are outside this nature-first run.
    const attempted = new Set();
    for (const key of [
      "noaa",
      "noaa-jellyfish",
      "usgs",
      "nps",
      "commons",
      "nasa-toolkit",
      "nasa-planets",
      "eso",
      "hubble",
    ]) {
      if (cancel.signal.aborted || acquiredThisRun >= LIMIT) break;
      discoveryKeys = [key];
      await discover();
      if (!PLAN)
        for (const entry of Object.values(state.entries).filter(
          (e) =>
            e.provider !== "Mantissa" &&
            discoveredIds.has(e.id) &&
            !attempted.has(e.id),
        )) {
          if (cancel.signal.aborted || acquiredThisRun >= LIMIT) break;
          attempted.add(entry.id);
          await acquire(entry);
        }
    }
    discoveryKeys = undefined;
    await discoverMantissa();
    // Published size inventory is only an ordering hint; actual response length/stream
    // limits still enforce the cap. Smaller distinct loops make better use of the remainder.
    const sizesFile = path.join(SNAP, "open-mantissa-sizes.json");
    const sizes = (await exists(sizesFile))
      ? JSON.parse(await fs.readFile(sizesFile, "utf8")).rows
      : [];
    const sizeHint = new Map(
      sizes.filter((r) => r.status === 200).map((r) => [r.id, r.bytes]),
    );
    const mantissa = Object.values(state.entries)
      .filter((e) => e.provider === "Mantissa")
      .sort(
        (a, b) =>
          (sizeHint.get(a.id) ?? Infinity) - (sizeHint.get(b.id) ?? Infinity),
      );
    if (!PLAN)
      for (const entry of mantissa) {
        if (cancel.signal.aborted || acquiredThisRun >= LIMIT) break;
        await acquire(entry);
      }
  }
  await persist();
  console.log(
    `[plan] ${Object.keys(state.entries).length} files; Mantissa ${state.discovery.mantissa?.publishedCount ?? 0}; NASA toolkit ${state.discovery.nasa14126?.uniquePublishedMp4s ?? 0}; ffmpeg ${ffmpegVersion ?? "pending"}; media cap ${(MEDIA_CAP / GiB).toFixed(3)} GiB`,
  );
  if (VERIFY)
    for (const entry of Object.values(state.entries)) {
      if (cancel.signal.aborted || acquiredThisRun >= LIMIT) break;
      await acquire(entry);
    }
  state.run.status = cancel.signal.aborted
    ? "interrupted"
    : PLAN
      ? "planned"
      : "finished";
  state.run.finishedAt = now();
  mediaBytes = await diskBytes(MEDIA);
  await persist();
  console.log(
    JSON.stringify(
      {
        summary: state.summary,
        sourceErrors: state.sourceErrors,
        missingByStatus: Object.fromEntries(
          [...new Set(state.missing.map((e) => e.status))].map((status) => [
            status,
            state.missing.filter((e) => e.status === status).length,
          ]),
        ),
        detailedMissingJournal: relative(JOURNAL),
      },
      null,
      2,
    ),
  );
  if (
    !PLAN &&
    (state.summary.missing ||
      Object.keys(state.sourceErrors).length ||
      cancel.signal.aborted)
  )
    process.exitCode = 2;
} catch (e) {
  console.error(errorText(e));
  process.exitCode = 1;
  if (state) {
    state.run = {
      ...state.run,
      status: "failed",
      error: errorText(e),
      finishedAt: now(),
    };
    await persist().catch(() => {});
  }
} finally {
  agent.destroy();
  if (ownsLock) await fs.unlink(LOCK).catch(() => {});
}
