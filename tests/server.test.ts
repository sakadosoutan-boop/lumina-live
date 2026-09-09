import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  symlink,
  rm,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import type { Asset, LuminaDesktop } from "../src/types";

const require = createRequire(import.meta.url);
const serverModule = require("../desktop/server.cjs");
const {
  createLocalServer,
  assetRootsFor,
  parseOscMessage,
  startOscServer,
  validateShowJson,
  readShowFile,
  MAX_JSON_BYTES,
} = serverModule;
type LocalServer = {
  origin: string;
  port: number;
  server: http.Server;
  getAssets(): Asset[];
  registerMedia(file: string): Promise<Asset>;
  close(): Promise<void>;
  resolveShowUrls(data: string): string;
};
type Reply = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};
let fixture: string;
let local: LocalServer;
const servers: LocalServer[] = [];
const showJson = JSON.stringify({
  version: 1,
  title: "Test show",
  songs: [],
  assets: [],
  decks: [],
});

async function launch(options = {}): Promise<LocalServer> {
  const result = await createLocalServer({
    rootDir: fixture,
    assetRoots: [path.join(fixture, "assets")],
    ...options,
  });
  servers.push(result);
  return result;
}

// Pass the raw request target, avoiding fetch/URL's automatic traversal cleanup.
function request(
  target: string,
  options: {
    headers?: Record<string, string | undefined>;
    method?: string;
    server?: LocalServer;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: (options.server || local).port,
        path: target,
        method: options.method || "GET",
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(3000, () => req.destroy(new Error("HTTP test timed out")));
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "lumina-server-test-"));
  await mkdir(path.join(fixture, "dist", "assets"), { recursive: true });
  await mkdir(path.join(fixture, "assets", "media"), { recursive: true });
  await mkdir(path.join(fixture, "outside"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(fixture, "dist", "index.html"),
      "<!doctype html><title>Lumina</title>",
    ),
    writeFile(
      path.join(fixture, "dist", "assets", "app.js"),
      'console.log("offline");',
    ),
    writeFile(
      path.join(fixture, "dist", "manifest.webmanifest"),
      '{"name":"Lumina"}',
    ),
    writeFile(path.join(fixture, "assets", "media", "clip.mp4"), "0123456789"),
    writeFile(path.join(fixture, "assets", "media", "empty.mp4"), ""),
    writeFile(path.join(fixture, "assets", "media", "日本 語.png"), "image"),
    writeFile(path.join(fixture, "outside", "secret.mp4"), "PRIVATE"),
    writeFile(path.join(fixture, "outside", "secret.json"), showJson),
    writeFile(
      path.join(fixture, "assets", "catalog.json"),
      JSON.stringify([
        {
          id: "clip",
          name: "Clip",
          kind: "video",
          url: "/assets/media/clip.mp4",
          thumbnail: "/assets/media/日本 語.png",
          tags: [],
          license: "CC0",
          hue: 90,
          energy: 0.5,
          nativePath: "PRIVATE",
        },
        {
          id: "visual",
          name: "Waves",
          kind: "procedural",
          visual: "waves",
          tags: [],
          license: "CC0",
        },
        {
          id: "remote",
          name: "Remote",
          kind: "video",
          url: "https://evil.example/clip.mp4",
        },
        {
          id: "traversal",
          name: "Traversal",
          kind: "video",
          url: "/assets/media/%2e%2e/secret.json",
        },
        { id: "native", name: "Native", kind: "video", url: "C:\\secret.mp4" },
      ]),
    ),
  ]);
  local = await launch();
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
  // Only remove the uniquely created test directory, never a computed repo path.
  if (
    fixture &&
    path.dirname(fixture) === path.resolve(tmpdir()) &&
    path.basename(fixture).startsWith("lumina-server-test-")
  ) {
    await rm(fixture, { recursive: true, force: true });
  }
});

describe("loopback HTTP and catalog", () => {
  it("binds IPv4 loopback, serves dist and the same output document", async () => {
    expect(local.server.address()).toMatchObject({
      address: "127.0.0.1",
      family: "IPv4",
    });
    const index = await request("/");
    expect(index.status).toBe(200);
    expect((await request("/?output=1")).body).toEqual(index.body);
    expect((await request("/assets/app.js")).headers["content-type"]).toContain(
      "javascript",
    );
    expect(
      (await request("/manifest.webmanifest")).headers["content-type"],
    ).toBe("application/manifest+json");
    expect(index.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(index.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(index.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request("/missing.mp4")).status).toBe(404);
  });

  it("returns safe relative catalog URLs and usable absolute desktop URLs", async () => {
    const reply = await request("/assets/catalog.json");
    const catalog: Asset[] = JSON.parse(reply.body.toString());
    expect(catalog.map((a) => a.id)).toEqual(["clip", "visual"]);
    expect(catalog[0].url).toBe("/assets/media/clip.mp4");
    expect(reply.body.toString()).not.toContain("PRIVATE");
    expect((await request(catalog[0].thumbnail!)).body.toString()).toBe(
      "image",
    );
    const desktop = local.getAssets();
    expect(desktop[0].url).toBe(local.origin + catalog[0].url);
    desktop[0].tags.push("mutated");
    expect(local.getAssets()[0].tags).toEqual([]);
    expect(
      (await request(new URL(desktop[0].url!).pathname)).body.toString(),
    ).toBe("0123456789");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "rejects %s without writing assets",
    async (method) => {
      const reply = await request("/assets/catalog.json", { method });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe("GET, HEAD");
      expect((await request("/assets/catalog.json")).status).toBe(200);
    },
  );

  it.each([
    { Origin: "https://evil.example" },
    { Origin: "null" },
    { Origin: "http://127.0.0.1:1" },
    { Host: "evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { Referer: "https://evil.example/" },
    { Referer: "not-a-url" },
  ])("rejects foreign host/origin/referrer metadata: %j", async (headers) => {
    expect((await request("/assets/media/clip.mp4", { headers })).status).toBe(
      403,
    );
  });

  it("accepts same-origin fetches and direct local navigation", async () => {
    expect(
      (
        await request("/", {
          headers: {
            Origin: local.origin,
            Referer: local.origin + "/",
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/", { headers: { "Sec-Fetch-Site": "none" } })).status,
    ).toBe(200);
  });

  it("falls back to a dynamic port only when requested", async () => {
    await expect(
      createLocalServer({ rootDir: fixture, port: local.port, assetRoots: [] }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    const other = await launch({ port: local.port, retryPort: true });
    expect(other.port).not.toBe(local.port);
    expect((await request("/", { server: other })).status).toBe(200);
  });

  it("chooses portable, resources, then repo catalogs without mixing media roots", async () => {
    const portableDir = path.join(fixture, "portable");
    const resourcesPath = path.join(fixture, "resources");
    const roots = assetRootsFor({
      rootDir: fixture,
      portableDir,
      resourcesPath,
    });
    expect(roots).toEqual([
      path.join(portableDir, "assets"),
      path.join(resourcesPath, "assets"),
      path.join(fixture, "assets"),
    ]);
    for (const [root, label] of [
      [roots[0], "portable"],
      [roots[1], "resources"],
    ]) {
      await mkdir(path.join(root, "media"), { recursive: true });
      await writeFile(
        path.join(root, "catalog.json"),
        JSON.stringify({
          assets: [
            {
              id: label,
              name: label,
              kind: "video",
              url: "/assets/media/clip.mp4",
            },
          ],
        }),
      );
      await writeFile(path.join(root, "media", "clip.mp4"), label);
    }
    const portable = await launch({ assetRoots: roots });
    expect(portable.getAssets()[0].id).toBe("portable");
    expect(
      (
        await request("/assets/media/clip.mp4", { server: portable })
      ).body.toString(),
    ).toBe("portable");
    const resources = await launch({ assetRoots: roots.slice(1) });
    expect(resources.getAssets()[0].id).toBe("resources");
    expect(
      (await request("/assets/media/empty.mp4", { server: resources })).status,
    ).toBe(404);
    const fallback = await launch({
      assetRoots: [path.join(fixture, "absent"), roots[2]],
    });
    expect(fallback.getAssets()[0].id).toBe("clip");
  });

  it("supports assets adjacent to an unpacked EXE and honors the portable launcher directory first", async () => {
    const portableDir = path.join(fixture, "portable");
    const executableDir = path.join(fixture, "unpacked");
    const resourcesPath = path.join(executableDir, "resources");
    const rootDir = path.join(resourcesPath, "app.asar");
    const roots = assetRootsFor({
      rootDir,
      portableDir,
      executableDir,
      resourcesPath,
    });
    expect(roots).toEqual([
      path.join(portableDir, "assets"),
      path.join(executableDir, "assets"),
      path.join(resourcesPath, "assets"),
      path.join(rootDir, "assets"),
    ]);
    await mkdir(path.join(executableDir, "assets", "media"), {
      recursive: true,
    });
    await writeFile(
      path.join(executableDir, "assets", "catalog.json"),
      JSON.stringify([
        {
          id: "adjacent",
          name: "Adjacent",
          kind: "video",
          url: "/assets/media/clip.mp4",
        },
      ]),
    );
    await writeFile(
      path.join(executableDir, "assets", "media", "clip.mp4"),
      "ADJACENT",
    );
    const adjacent = await launch({ assetRoots: roots.slice(1) });
    expect(adjacent.getAssets()[0].id).toBe("adjacent");
    expect(
      (
        await request("/assets/media/clip.mp4", {
          server: adjacent,
          headers: { Range: "bytes=2-4" },
        })
      ).body.toString(),
    ).toBe("JAC");
    const portable = await launch({ assetRoots: roots });
    expect(portable.getAssets()[0].id).toBe("portable");
    const noAssets = await launch({
      assetRoots: [path.join(fixture, "no-external-assets")],
    });
    expect(noAssets.getAssets()).toEqual([]);
    expect((await request("/", { server: noAssets })).status).toBe(200);
  });
});

describe("path and import security", () => {
  it.each([
    "/../outside/secret.mp4",
    "/assets/media/../../../outside/secret.mp4",
    "/assets/media/%2e%2e/%2e%2e/outside/secret.mp4",
    "/assets/media/%252e%252e/secret.mp4",
    "/assets/media/..%2f..%2fsecret.mp4",
    "/assets/media/..%5csecret.mp4",
    "/assets/media/..\\secret.mp4",
    "/assets/media/%00clip.mp4",
    "/assets/media/%zz",
    "//outside/secret.mp4",
    "/C:/outside/secret.mp4",
    "/assets/media/clip.mp4:secret",
    "/assets/media/clip.mp4%3a%24DATA",
    "/assets/media/clip.mp4.",
    "/assets/media/clip.mp4%20",
    "/assets/media/CON",
    "/assets/media/.hidden",
    "/assets//media/clip.mp4",
    "/desktop/main.cjs/../../../outside/secret.mp4",
    "/assets/media/%252fsecret.mp4",
    "/assets/media/NUL.mp4",
    "/assets/media/clip.mp4%3fsecret",
  ])("rejects raw traversal or Windows path alias %s", async (target) => {
    const reply = await request(target);
    expect([400, 403]).toContain(reply.status);
    expect(reply.body.toString()).not.toContain("PRIVATE");
    expect(reply.body.toString()).not.toContain(fixture);
  });

  it("rejects directory symlinks/junctions in dist, asset media and imports", async () => {
    const secret = path.join(fixture, "outside");
    const distLink = path.join(fixture, "dist", "linked");
    const assetLink = path.join(fixture, "assets", "media", "linked");
    await symlink(
      secret,
      distLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      secret,
      assetLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await request("/linked/secret.mp4")).status).toBe(403);
    expect((await request("/assets/media/linked/secret.mp4")).status).toBe(403);
    await expect(
      local.registerMedia(path.join(assetLink, "secret.mp4")),
    ).rejects.toThrow();
    const linkedRoot = await launch({ distDir: distLink });
    expect((await request("/secret.mp4", { server: linkedRoot })).status).toBe(
      403,
    );
  });

  it("registers only selected media under opaque IDs, with no HTTP registration or filesystem URLs", async () => {
    const asset = await local.registerMedia(
      path.join(fixture, "outside", "secret.mp4"),
    );
    expect(asset.url).toMatch(
      new RegExp(`^${local.origin}/media/[0-9a-f-]{36}$`),
    );
    expect(JSON.stringify(asset)).not.toContain(fixture);
    const target = new URL(asset.url!).pathname;
    expect((await request(target)).body.toString()).toBe("PRIVATE");
    expect(
      (
        await request(target, { headers: { Range: "bytes=1-3" } })
      ).body.toString(),
    ).toBe("RIV");
    expect(
      (await request(target, { headers: { Origin: "https://evil.example" } }))
        .status,
    ).toBe(403);
    expect((await request(target)).headers["cache-control"]).toBe("no-store");
    expect((await request("/media/secret.mp4")).status).toBe(404);
    expect(
      (await request("/media/register?path=" + encodeURIComponent(fixture)))
        .status,
    ).toBe(404);
    expect((await request("/media/register", { method: "POST" })).status).toBe(
      405,
    );
    await expect(local.registerMedia("relative.mp4")).rejects.toThrow();
    await expect(
      local.registerMedia(path.join(fixture, "outside", "secret.json")),
    ).rejects.toThrow();
  });

  it("rejects a replaced registered file and a directory replaced by a junction", async () => {
    const folder = path.join(fixture, "selected");
    await mkdir(folder);
    const selected = path.join(folder, "secret.mp4");
    await writeFile(selected, "selected");
    const asset = await local.registerMedia(selected);
    await rename(selected, path.join(folder, "original.mp4"));
    await writeFile(selected, "replacement");
    expect((await request(new URL(asset.url!).pathname)).status).toBe(403);
    const second = await local.registerMedia(selected);
    await rename(folder, folder + "-old");
    await symlink(
      path.join(fixture, "outside"),
      folder,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await request(new URL(second.url!).pathname)).status).toBe(403);
  });
});

describe("HTTP byte streaming", () => {
  it.each([
    ["bytes=0-0", "0", "bytes 0-0/10"],
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=-999", "0123456789", "bytes 0-9/10"],
    ["bytes=8-9999999999999999999999999", "89", "bytes 8-9/10"],
    ["bytes=-9999999999999999999999999", "0123456789", "bytes 0-9/10"],
  ])(
    "streams exact content and lengths for %s",
    async (range, body, contentRange) => {
      const reply = await request("/assets/media/clip.mp4", {
        headers: { Range: range },
      });
      expect(reply.status).toBe(206);
      expect(reply.body.toString()).toBe(body);
      expect(reply.headers["content-length"]).toBe(
        String(Buffer.byteLength(body)),
      );
      expect(reply.headers["content-range"]).toBe(contentRange);
      expect(reply.headers["content-type"]).toBe("video/mp4");
    },
  );

  it.each([
    "bytes=10-",
    "bytes=4-2",
    "bytes=-0",
    "bytes=-",
    "bytes=abc",
    "bytes=0-1,3-4",
    "bytes=99999999999999999999-",
  ])("returns 416 for %s", async (range) => {
    const reply = await request("/assets/media/clip.mp4", {
      headers: { Range: range },
    });
    expect(reply.status).toBe(416);
    expect(reply.headers["content-range"]).toBe("bytes */10");
  });

  it("handles full responses, empty media, HEAD and unknown range units", async () => {
    const full = await request("/assets/media/clip.mp4");
    expect(full.status).toBe(200);
    expect(full.headers["content-length"]).toBe("10");
    const head = await request("/assets/media/clip.mp4", {
      method: "HEAD",
      headers: { Range: "bytes=0-1" },
    });
    expect(head.status).toBe(200);
    expect(head.headers["content-length"]).toBe("10");
    expect(head.body.length).toBe(0);
    expect(
      (await request("/assets/media/empty.mp4")).headers["content-length"],
    ).toBe("0");
    const emptyRange = await request("/assets/media/empty.mp4", {
      headers: { Range: "bytes=0-" },
    });
    expect(emptyRange.status).toBe(416);
    expect(emptyRange.headers["content-range"]).toBe("bytes */0");
    expect(
      (
        await request("/assets/media/clip.mp4", {
          headers: { Range: "items=0-1" },
        })
      ).status,
    ).toBe(200);
  });

  it("supports offsets beyond 4 GiB without allocating a giant fixture", () => {
    const offset = 2 ** 32 + 9;
    expect(serverModule.parseRange(`bytes=${offset}-`, offset + 4)).toEqual({
      start: offset,
      end: offset + 3,
    });
    expect(serverModule.parseRange("bytes=-4", offset + 4)).toEqual({
      start: offset,
      end: offset + 3,
    });
  });

  it("honors cache validators and If-Range without returning stale partial content", async () => {
    const first = await request("/assets/media/clip.mp4");
    const etag = first.headers.etag!;
    const cached = await request("/assets/media/clip.mp4", {
      headers: { "If-None-Match": `W/${etag}` },
    });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);
    for (const validator of [etag, first.headers["last-modified"]!]) {
      expect(
        (
          await request("/assets/media/clip.mp4", {
            headers: { Range: "bytes=1-2", "If-Range": validator },
          })
        ).status,
      ).toBe(206);
    }
    for (const validator of [
      '"stale"',
      `W/${etag}`,
      "Thu, 01 Jan 1970 00:00:00 GMT",
    ]) {
      const reply = await request("/assets/media/clip.mp4", {
        headers: { Range: "bytes=1-2", "If-Range": validator },
      });
      expect(reply.status).toBe(200);
      expect(reply.body.length).toBe(10);
    }
  });
});

function oscString(value: string) {
  const buffer = Buffer.alloc(
    Math.ceil((Buffer.byteLength(value) + 1) / 4) * 4,
  );
  buffer.write(value);
  return buffer;
}
function oscMessage(address: string, types = ",", values: number[] = []) {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, i) =>
    types[i + 1] === "i"
      ? data.writeInt32BE(value, i * 4)
      : data.writeFloatBE(value, i * 4),
  );
  return Buffer.concat([oscString(address), oscString(types), data]);
}

describe("bounded OSC 1.0 parser and optional UDP transport", () => {
  it.each(["play", "stop", "next", "prev", "tap", "blackout"])(
    "accepts /lumina/%s triggers",
    (action) => {
      expect(parseOscMessage(oscMessage("/lumina/" + action))).toEqual({
        address: "/lumina/" + action,
        args: [],
      });
      expect(
        parseOscMessage(oscMessage("/lumina/" + action, ",i", [1]))?.args,
      ).toEqual([1]);
    },
  );

  it("decodes big-endian floats and bounded zero-based clip indices", () => {
    expect(
      parseOscMessage(oscMessage("/lumina/crossfade", ",f", [0.25])),
    ).toEqual({ address: "/lumina/crossfade", args: [0.25] });
    expect(
      parseOscMessage(oscMessage("/lumina/master", ",i", [0]))?.args,
    ).toEqual([0]);
    expect(
      parseOscMessage(oscMessage("/lumina/clip", ",i", [99999]))?.args,
    ).toEqual([99999]);
    expect(
      parseOscMessage(oscMessage("/lumina/clip", ",i", [0]))?.args,
    ).toEqual([0]);
  });

  it.each([
    ["/lumina/master", ",f", [NaN]],
    ["/lumina/master", ",f", [Infinity]],
    ["/lumina/master", ",f", [-0.1]],
    ["/lumina/crossfade", ",f", [1.01]],
    ["/lumina/master", ",", []],
    ["/lumina/blackout", ",f", [0.5]],
    ["/lumina/clip", ",i", [-1]],
    ["/lumina/clip", ",i", [100000]],
    ["/lumina/clip", ",f", [1]],
    ["/lumina/clip", ",", []],
    ["/lumina/play", ",ii", [1, 2]],
    ["/lumina/play", ",s", [1]],
    ["/lumina/*", ",", []],
    ["/stop", ",", []],
    ["/lumina/unknown", ",", []],
  ] as [string, string, number[]][])(
    "rejects malformed or out-of-bounds message %s %s %j",
    (address, types, args) => {
      expect(parseOscMessage(oscMessage(address, types, args))).toBeNull();
    },
  );

  it("rejects truncated data, bad padding, bundles, trailing bytes and oversized packets without throwing", () => {
    const valid = oscMessage("/lumina/master", ",f", [0.5]);
    for (let length = 0; length < valid.length; length++)
      expect(parseOscMessage(valid.subarray(0, length))).toBeNull();
    const badPadding = Buffer.from(valid);
    badPadding[15] = 1;
    for (const packet of [
      badPadding,
      Buffer.concat([valid, Buffer.alloc(4)]),
      Buffer.alloc(260),
      Buffer.from("#bundle\0"),
      Buffer.alloc(16, 255),
      "not a buffer",
    ]) {
      expect(parseOscMessage(packet)).toBeNull();
    }
  });

  it("does not open a socket when disabled; sends only valid loopback messages and closes cleanly", async () => {
    const disabled = await startOscServer({ enabled: false });
    expect(disabled.port).toBeNull();
    await disabled.close();
    const received = vi.fn();
    const listener = await startOscServer({ port: 0, onMessage: received });
    const sender = dgram.createSocket("udp4");
    try {
      sender.send(Buffer.from("invalid"), listener.port, "127.0.0.1");
      sender.send(
        oscMessage("/lumina/master", ",f", [0.5]),
        listener.port,
        "127.0.0.1",
      );
      await vi.waitFor(() =>
        expect(received).toHaveBeenCalledExactlyOnceWith({
          address: "/lumina/master",
          args: [0.5],
        }),
      );
      await expect(
        startOscServer({ port: listener.port }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      sender.close();
      await listener.close();
      await listener.close();
    }
  });
});

describe("show picker payload limits", () => {
  it("validates JSON before save and enforces UTF-8 byte limits", () => {
    expect(validateShowJson(showJson)).toBe(showJson);
    for (const data of [
      null,
      "{}",
      "[]",
      "{",
      '{"version":2}',
      "x".repeat(MAX_JSON_BYTES + 1),
    ])
      expect(() => validateShowJson(data)).toThrow();
    const unicode = JSON.stringify({
      version: 1,
      title: "語".repeat(Math.ceil(MAX_JSON_BYTES / 3)),
      songs: [],
      assets: [],
      decks: [],
    });
    expect(unicode.length).toBeLessThan(MAX_JSON_BYTES);
    expect(() => validateShowJson(unicode)).toThrow(/10 MiB/);
  });

  it("reads selected JSON, rejects oversized files, malformed UTF-8 and linked folders", async () => {
    expect(
      await readShowFile(path.join(fixture, "outside", "secret.json")),
    ).toBe(showJson);
    const large = path.join(fixture, "large.json");
    const handle = await open(large, "w");
    await handle.truncate(MAX_JSON_BYTES + 1);
    await handle.close();
    await expect(readShowFile(large)).rejects.toThrow(/too large/);
    const malformed = path.join(fixture, "malformed.json");
    await writeFile(malformed, Buffer.from([0xff, 0xfe]));
    await expect(readShowFile(malformed)).rejects.toThrow();
    await expect(
      readShowFile(path.join(fixture, "dist", "linked", "secret.json")),
    ).rejects.toThrow();
  });
});

describe("persistent picker authorization", () => {
  it("retains IDs across restart, serializes concurrent imports and fixes old show origins", async () => {
    const registryPath = path.join(fixture, "userData", "imported-media.json");
    const original = await launch({ registryPath });
    const selected = path.join(fixture, "outside", "secret.mp4");
    const [asset, duplicate] = await Promise.all([
      original.registerMedia(selected),
      original.registerMedia(selected),
    ]);
    expect(asset.id).toBe(duplicate.id);
    const priorShow = JSON.stringify({
      ...JSON.parse(showJson),
      assets: [
        asset,
        {
          id: "unknown",
          url: "http://127.0.0.1:1/media/00000000-0000-0000-0000-000000000000",
        },
      ],
    });
    await original.close();
    // The second server is deliberately on a new origin, as when 4173 is busy.
    const restarted = await launch({ registryPath });
    expect(restarted.origin).not.toBe(original.origin);
    expect(restarted.getAssets().find((a) => a.id === asset.id)?.url).toBe(
      `${restarted.origin}/media/${asset.id}`,
    );
    const restored = JSON.parse(restarted.resolveShowUrls(priorShow));
    expect(restored.assets[0].url).toBe(
      `${restarted.origin}/media/${asset.id}`,
    );
    expect(restored.assets[1].url).toBe(JSON.parse(priorShow).assets[1].url);
    expect(
      (
        await request(new URL(restored.assets[0].url).pathname, {
          server: restarted,
        })
      ).body.toString(),
    ).toBe("PRIVATE");
    expect(JSON.stringify(restarted.getAssets())).not.toContain(fixture);
    expect(JSON.parse(await readFile(registryPath, "utf8")).media).toHaveLength(
      1,
    );
  });

  it("does not reauthorize a changed file on restart", async () => {
    const registryPath = path.join(
      fixture,
      "userData",
      "changed-registry.json",
    );
    const media = path.join(fixture, "changing.mp4");
    await writeFile(media, "original");
    const original = await launch({ registryPath });
    const asset = await original.registerMedia(media);
    await original.close();
    await rename(media, media + ".old");
    await writeFile(media, "replacement");
    const restarted = await launch({ registryPath });
    expect(
      (await request(`/media/${asset.id}`, { server: restarted })).status,
    ).toBe(403);
  });
});

describe("isolated preload API", () => {
  async function preload() {
    let api!: LuminaDesktop;
    const ipc = Object.assign(new EventEmitter(), {
      invoke: vi.fn(async (..._args: unknown[]) => undefined),
      send: vi.fn(),
    });
    const events = new Map<string, (event: unknown) => void>();
    class Anchor {
      constructor(public href: string) {}
      hasAttribute() {
        return false;
      }
    }
    vm.runInNewContext(
      await readFile(
        new URL("../desktop/preload.cjs", import.meta.url),
        "utf8",
      ),
      {
        require: () => ({
          contextBridge: {
            exposeInMainWorld: (name: string, value: LuminaDesktop) => {
              expect(name).toBe("lumina");
              api = value;
            },
          },
          ipcRenderer: ipc,
        }),
        window: {
          addEventListener: (name: string, fn: (event: unknown) => void) =>
            events.set(name, fn),
        },
        URL,
        HTMLAnchorElement: Anchor,
      },
    );
    return { api, ipc, events, Anchor };
  }

  it("matches LuminaDesktop exactly and never forwards renderer-supplied picker paths", async () => {
    const { api, ipc } = await preload();
    expect(Object.keys(api).sort()).toEqual(
      [
        "getAssets",
        "importMedia",
        "getDisplays",
        "openOutput",
        "saveShow",
        "loadShow",
        "onRemote",
      ].sort(),
    );
    await Reflect.apply(api.importMedia, null, ["C:\\private.mp4"]);
    expect(ipc.invoke).toHaveBeenLastCalledWith("lumina:import-media");
    await api.getAssets();
    await api.getDisplays();
    await api.openOutput(2);
    await api.saveShow(showJson);
    await api.loadShow();
    expect(ipc.invoke.mock.calls.map((call) => call[0])).toEqual([
      "lumina:import-media",
      "lumina:get-assets",
      "lumina:get-displays",
      "lumina:open-output",
      "lumina:save-show",
      "lumina:load-show",
    ]);
    await expect(api.openOutput(NaN)).rejects.toThrow();
  });

  it("strips IPC event objects, copies numeric payloads and unsubscribes only its own listener", async () => {
    const { api, ipc } = await preload();
    const first = vi.fn(),
      second = vi.fn();
    const unsubscribe = api.onRemote(first);
    api.onRemote(second);
    const message = { address: "/lumina/play", args: [1] };
    ipc.emit("lumina:remote", { secret: true }, message);
    expect(first).toHaveBeenCalledExactlyOnceWith(message);
    expect(first.mock.calls[0][0]).not.toBe(message);
    unsubscribe();
    unsubscribe();
    ipc.emit("lumina:remote", {}, message);
    ipc.emit("lumina:remote", {}, { address: "/unknown", args: [] });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("sends private external-link requests only for trusted HTTPS anchor clicks", async () => {
    const { ipc, events, Anchor } = await preload();
    const click = (href: string, isTrusted: boolean) =>
      events.get("click")!({
        type: "click",
        isTrusted,
        composedPath: () => [new Anchor(href)],
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      });
    click("https://example.com/license", false);
    click("file:///C:/private", true);
    click("http://example.com", true);
    click("https://user:password@example.com", true);
    expect(ipc.send).not.toHaveBeenCalled();
    click("https://example.com/license", true);
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith(
      "lumina:external-click",
      "https://example.com/license",
    );
  });
});

// Execute the real main module with Electron's OS boundary replaced. This tests
// IPC authorization, lifecycle and native dialog configuration without opening
// windows, touching userData or requiring an attached HDMI display in CI.
async function desktopHarness(packaged = false) {
  const windows: any[] = [];
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const mainIpc = Object.assign(new EventEmitter(), {
    handle: (name: string, fn: (...args: any[]) => Promise<any>) =>
      handlers.set(name, fn),
  });
  class Window extends EventEmitter {
    webContents: any;
    destroyed = false;
    focused = true;
    show = vi.fn();
    showInactive = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    setMenu = vi.fn();
    setBounds = vi.fn();
    setFullScreen = vi.fn();
    constructor(public options: any) {
      super();
      windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        id: windows.length,
        mainFrame: { url: "" },
        getURL: () => this.webContents.mainFrame.url,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler: vi.fn(),
        send: vi.fn(),
      });
    }
    isDestroyed() {
      return this.destroyed;
    }
    isFocused() {
      return this.focused;
    }
    isMinimized() {
      return false;
    }
    async loadURL(url: string) {
      this.webContents.mainFrame.url = url;
      this.emit("ready-to-show");
    }
    close() {
      this.destroy();
    }
    destroy() {
      this.destroyed = true;
      this.webContents.emit("destroyed");
      this.emit("closed");
    }
  }
  const displays = [
    {
      id: 1,
      label: "Primary",
      bounds: { x: 0, y: 0, width: 1600, height: 1000 },
      size: { width: 1600, height: 1000 },
    },
    {
      id: 2,
      label: "HDMI",
      bounds: { x: 1600, y: 0, width: 1920, height: 1080 },
      size: { width: 1920, height: 1080 },
    },
  ];
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
  });
  const ses = Object.assign(new EventEmitter(), {
    webRequest: { onBeforeRequest: vi.fn() },
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  });
  const app = Object.assign(new EventEmitter(), {
    enableSandbox: vi.fn(),
    requestSingleInstanceLock: () => true,
    isPackaged: packaged,
    whenReady: () => Promise.resolve(),
    getAppPath: () => fixture,
    getPath: (name: string) =>
      name === "exe"
        ? path.join(fixture, "unpacked", "Lumina Live.exe")
        : path.join(fixture, "harness-userData"),
    quit: vi.fn(),
  });
  const dialog = {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showErrorBox: vi.fn(),
  };
  const shell = { openExternal: vi.fn(async () => {}) };
  const powerSaveBlocker = {
    start: vi.fn(() => 7),
    isStarted: () => true,
    stop: vi.fn(),
  };
  const runtime = { ...local, close: vi.fn(async () => {}) };
  const oscClose = vi.fn(async () => {});
  const startOsc = vi.fn(async (_options: any) => ({ close: oscClose }));
  const createServer = vi.fn(async (_options: any) => runtime);
  const electron = {
    app,
    BrowserWindow: Window,
    dialog,
    ipcMain: mainIpc,
    screen,
    shell,
    powerSaveBlocker,
    session: { fromPartition: () => ses },
  };
  vm.runInNewContext(
    await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8"),
    {
      require: (name: string) =>
        name === "electron"
          ? electron
          : name === "./server.cjs"
            ? {
                ...serverModule,
                createLocalServer: createServer,
                startOscServer: startOsc,
              }
            : require(name),
      __dirname: path.resolve("desktop"),
      process: {
        argv: ["electron", ".", "--no-osc"],
        env: {},
        resourcesPath: path.join(fixture, "resources"),
      },
      performance,
      URL,
      Buffer,
      console,
    },
  );
  await vi.waitFor(() => expect(startOsc).toHaveBeenCalled());
  const sender = (win = windows[0]) => ({
    sender: win.webContents,
    senderFrame: win.webContents.mainFrame,
  });
  return {
    windows,
    handlers,
    ipc: mainIpc,
    screen,
    ses,
    app,
    dialog,
    shell,
    powerSaveBlocker,
    runtime,
    startOsc,
    oscClose,
    createServer,
    sender,
  };
}

describe("Electron main security and lifecycle", () => {
  it("serves the unpacked renderer in production and discovers adjacent media without embedding it", async () => {
    const h = await desktopHarness(true);
    expect(h.createServer.mock.calls[0][0]).toMatchObject({
      distDir: path.join(fixture, "resources", "app.asar.unpacked", "dist"),
      executableDir: path.join(fixture, "unpacked"),
    });
  });
  it("uses the secure 1600×1000 operator and a shared-origin fullscreen secondary output", async () => {
    const h = await desktopHarness();
    const operator = h.windows[0];
    expect(operator.options).toMatchObject({
      width: 1600,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    expect(h.app.enableSandbox).toHaveBeenCalledOnce();
    expect(h.createServer.mock.calls[0][0].registryPath).toBe(
      path.join(fixture, "harness-userData", "imported-media.json"),
    );
    expect(h.startOsc.mock.calls[0][0].enabled).toBe(false);
    expect(h.powerSaveBlocker.start).toHaveBeenCalledWith(
      "prevent-display-sleep",
    );
    await h.handlers.get("lumina:open-output")!(h.sender());
    const output = h.windows[1];
    expect(output.options).toMatchObject({
      x: 1600,
      y: 0,
      width: 1920,
      height: 1080,
      fullscreen: true,
      frame: false,
    });
    expect(output.webContents.getURL()).toBe(local.origin + "/?output=1");
    expect(output.options.webPreferences.partition).toBe(
      operator.options.webPreferences.partition,
    );
    await h.handlers.get("lumina:open-output")!(h.sender(), 2);
    expect(h.windows).toHaveLength(2);
    await expect(
      h.handlers.get("lumina:open-output")!(h.sender(), 999),
    ).rejects.toThrow(/Display/);
    expect(
      await h.handlers.get("lumina:get-assets")!(h.sender(output)),
    ).toEqual(local.getAssets());
    await expect(
      h.handlers.get("lumina:save-show")!(h.sender(output), showJson),
    ).rejects.toThrow(/Untrusted/);
    const remote = { address: "/lumina/master", args: [0.5] };
    h.startOsc.mock.calls[0][0].onMessage(remote);
    expect(operator.webContents.send).toHaveBeenCalledWith(
      "lumina:remote",
      remote,
    );
    expect(output.webContents.send).not.toHaveBeenCalled();
    h.screen.emit("display-removed", {}, { id: 2 });
    expect(output.destroyed).toBe(true);
    h.app.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(h.runtime.close).toHaveBeenCalledOnce());
    expect(h.oscClose).toHaveBeenCalledOnce();
    expect(h.powerSaveBlocker.stop).toHaveBeenCalledWith(7);
  });

  it("rejects subframes, other webContents and extra picker/path arguments before opening dialogs", async () => {
    const h = await desktopHarness();
    const event = h.sender();
    await expect(
      h.handlers.get("lumina:import-media")!({
        ...event,
        senderFrame: { url: local.origin + "/" },
      }),
    ).rejects.toThrow(/Untrusted/);
    await expect(
      h.handlers.get("lumina:import-media")!({
        sender: { isDestroyed: () => false },
        senderFrame: {},
      }),
    ).rejects.toThrow(/Untrusted/);
    await expect(
      h.handlers.get("lumina:import-media")!(event, "C:\\private.mp4"),
    ).rejects.toThrow(/arguments/);
    await expect(
      h.handlers.get("lumina:load-show")!(event, "C:\\private.json"),
    ).rejects.toThrow(/arguments/);
    expect(h.dialog.showOpenDialog).not.toHaveBeenCalled();
    h.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    expect(await h.handlers.get("lumina:import-media")!(event)).toEqual([]);
    h.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    expect(await h.handlers.get("lumina:load-show")!(event)).toBeNull();
    h.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await h.handlers.get("lumina:save-show")!(event, showJson)).toBe(
      false,
    );
    await expect(
      h.handlers.get("lumina:save-show")!(event, "{}"),
    ).rejects.toThrow(/show/);
    const destination = path.join(fixture, "saved-by-picker.json");
    await writeFile(destination, showJson + " ".repeat(100));
    h.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: destination,
    });
    expect(await h.handlers.get("lumina:save-show")!(event, showJson)).toBe(
      true,
    );
    expect(await readFile(destination, "utf8")).toBe(showJson);
  });

  it("blocks all navigations and requires a native gesture for HTTPS shell links", async () => {
    const h = await desktopHarness();
    const contents = h.windows[0].webContents;
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "will-attach-webview",
    ]) {
      const preventDefault = vi.fn();
      contents.emit(name, { preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    }
    expect(
      contents.setWindowOpenHandler.mock.calls[0][0]({
        url: "https://example.com",
      }),
    ).toEqual({ action: "deny" });
    h.ipc.emit("lumina:external-click", h.sender(), "https://example.com/");
    expect(h.shell.openExternal).not.toHaveBeenCalled();
    const gesture = () =>
      contents.emit(
        "before-mouse-event",
        {},
        { type: "mouseUp", button: "left" },
      );
    gesture();
    h.ipc.emit("lumina:external-click", h.sender(), "file:///C:/private");
    expect(h.shell.openExternal).not.toHaveBeenCalled();
    gesture();
    h.ipc.emit("lumina:external-click", h.sender(), "https://example.com/");
    expect(h.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/",
    );
    h.ipc.emit("lumina:external-click", h.sender(), "https://other.example/");
    expect(h.shell.openExternal).toHaveBeenCalledOnce();
  });

  it("allows only operator-origin recording, JSON and lyric blobs through a native save dialog", async () => {
    const h = await desktopHarness();
    const download = (
      urls: string[],
      mime = "video/webm",
      filename = "Lumina-recording.webm",
      contents = h.windows[0].webContents,
    ) => {
      const preventDefault = vi.fn();
      const item = {
        getURLChain: () => urls,
        getMimeType: () => mime,
        getFilename: () => filename,
        setSaveDialogOptions: vi.fn(),
        setSavePath: vi.fn(),
      };
      h.ses.emit("will-download", { preventDefault }, item, contents);
      return { preventDefault, item };
    };
    const recording = download([`blob:${local.origin}/recording-id`]);
    expect(recording.preventDefault).not.toHaveBeenCalled();
    expect(recording.item.setSaveDialogOptions).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Lumina-recording.webm" }),
    );
    expect(recording.item.setSavePath).not.toHaveBeenCalled();
    for (const urls of [
      ["https://evil.example/recording.webm"],
      ["blob:https://evil.example/id"],
      [`${local.origin}/assets/media/clip.mp4`],
      [],
    ]) {
      expect(download(urls).preventDefault).toHaveBeenCalled();
    }
    expect(
      download([`blob:${local.origin}/id`], "application/x-msdownload")
        .preventDefault,
    ).toHaveBeenCalled();
    for (const [mime, filename] of [
      ["application/json; charset=utf-8", "Show.json"],
      ["text/plain", "日本語.lrc"],
      ["text/plain;charset=utf-8", "Song.srt"],
      ["video/mp4", "Recording.mp4"],
    ]) {
      const result = download([`blob:${local.origin}/id`], mime, filename);
      expect(result.preventDefault).not.toHaveBeenCalled();
      expect(result.item.setSaveDialogOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: filename,
          properties: ["showOverwriteConfirmation"],
        }),
      );
      expect(result.item.setSavePath).not.toHaveBeenCalled();
    }
    const traversal = download(
      [`blob:${local.origin}/id`],
      "application/json",
      "C:\\private\\payload.exe.json",
    );
    expect(traversal.item.setSaveDialogOptions).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "payload_exe.json" }),
    );
    const reserved = download(
      [`blob:${local.origin}/id`],
      "application/json",
      "CON.json",
    );
    expect(reserved.item.setSaveDialogOptions).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Lumina-show.json" }),
    );
    for (const [mime, filename] of [
      ["text/plain", "payload.cmd"],
      ["text/html", "song.lrc"],
      ["application/octet-stream", "Show.json"],
    ]) {
      expect(
        download([`blob:${local.origin}/id`], mime, filename).preventDefault,
      ).toHaveBeenCalled();
    }
    await h.handlers.get("lumina:open-output")!(h.sender());
    expect(
      download(
        [`blob:${local.origin}/id`],
        "video/webm",
        "Recording.webm",
        h.windows[1].webContents,
      ).preventDefault,
    ).toHaveBeenCalled();
    const permissions = h.ses.setPermissionCheckHandler.mock.calls[0][0];
    expect(
      permissions(h.windows[0].webContents, "media", local.origin, {
        isMainFrame: true,
        mediaType: "audio",
      }),
    ).toBe(true);
    expect(
      permissions(h.windows[0].webContents, "media", local.origin, {
        isMainFrame: true,
        mediaType: "video",
      }),
    ).toBe(false);
    const network = h.ses.webRequest.onBeforeRequest.mock.calls[0][0];
    const callback = vi.fn();
    network({ url: "https://evil.example/" }, callback);
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });
});
