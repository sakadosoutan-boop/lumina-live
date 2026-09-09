'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const dgram = require('node:dgram');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const MEDIA_TYPES = Object.freeze({
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
});
const MIME_TYPES = {
  ...MEDIA_TYPES, '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Inspect the raw request target before WHATWG URL normalization removes dot segments.
function decodePath(target) {
  if (typeof target !== 'string' || target.length > 8192 || !target.startsWith('/') || target.startsWith('//') || target.includes('#')) {
    throw new HttpError(400, 'Invalid path');
  }
  const raw = target.split('?')[0];
  if (/%(?:2f|5c)/i.test(raw)) throw new HttpError(400, 'Encoded separator');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new HttpError(400, 'Invalid encoding'); }
  if (/[\\\x00-\x1f\x7f:%?#]/.test(decoded)) throw new HttpError(400, 'Invalid path');
  if (decoded === '/') return [];
  const parts = decoded.slice(1).split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || /[<>"|*]/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new HttpError(403, 'Forbidden path');
  }
  return parts;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function inspectFile(root, parts) {
  let cursor = path.resolve(root);
  const rootInfo = await fsp.lstat(cursor);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new HttpError(403, 'Forbidden file');
  const realRoot = await fsp.realpath(cursor);
  for (let i = 0; i < parts.length; i++) {
    // Callers supply only decoded URL segments or components of a native picker path.
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || /[\\/:\x00]/.test(parts[i])) throw new HttpError(403, 'Forbidden file');
    cursor = path.join(cursor, parts[i]);
    const info = await fsp.lstat(cursor);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new HttpError(403, 'Forbidden file');
  }
  const realFile = await fsp.realpath(cursor);
  if (!inside(realRoot, realFile)) throw new HttpError(403, 'Forbidden file');
  return { file: cursor, realFile, info: await fsp.lstat(cursor) };
}

async function openSafeFile(root, parts, identity) {
  const before = await inspectFile(root, parts);
  const handle = await fsp.open(before.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    const after = await inspectFile(root, parts);
    if (!stat.isFile() || stat.dev !== before.info.dev || stat.ino !== before.info.ino ||
        stat.dev !== after.info.dev || stat.ino !== after.info.ino || before.realFile !== after.realFile ||
        (identity && (identity.dev !== stat.dev || identity.ino !== stat.ino || identity.realFile !== after.realFile))) {
      throw new HttpError(403, 'File changed');
    }
    return { handle, stat, realFile: after.realFile };
  } catch (error) { await handle.close(); throw error; }
}

async function readLimited(handle, limit) {
  if ((await handle.stat()).size > limit) throw new Error('JSON file is too large');
  // Read at most limit + 1 even if the file grows after stat().
  const chunks = [];
  let length = 0;
  while (length <= limit) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, length);
    if (!bytesRead) break;
    chunks.push(buffer.subarray(0, bytesRead));
    length += bytesRead;
  }
  if (length > limit) throw new Error('JSON file is too large');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
}

function validateShowJson(data) {
  if (typeof data !== 'string' || data.length > MAX_JSON_BYTES || Buffer.byteLength(data, 'utf8') > MAX_JSON_BYTES) throw new Error('Show must be JSON of at most 10 MiB');
  let show;
  try { show = JSON.parse(data); } catch { throw new Error('Invalid show JSON'); }
  if (!show || typeof show !== 'object' || Array.isArray(show) || show.version !== 1 || typeof show.title !== 'string' ||
      !Array.isArray(show.assets) || !Array.isArray(show.songs) || !Array.isArray(show.decks)) throw new Error('Invalid Lumina show');
  return data;
}

async function readShowFile(file) {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.json') throw new Error('Select a JSON show');
  const root = path.parse(file).root;
  const opened = await openSafeFile(root, file.slice(root.length).split(path.sep));
  try { return validateShowJson(await readLimited(opened.handle, MAX_JSON_BYTES)); }
  finally { await opened.handle.close(); }
}

// One byte range is supported. Unknown units are ignored; invalid/unsatisfiable
// byte ranges (including multipart requests) get 416, never an incorrect 206.
function parseRange(value, size) {
  if (!value || !value.startsWith('bytes=')) return null;
  const match = value.length <= 200 && /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new HttpError(416, 'Range not satisfiable');
  const total = BigInt(size);
  let start, end;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n) throw new HttpError(416, 'Range not satisfiable');
    start = suffix >= total ? 0n : total - suffix;
    end = total - 1n;
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : total - 1n;
    if (start >= total || end < start) throw new HttpError(416, 'Range not satisfiable');
    if (end >= total) end = total - 1n;
  }
  return { start: Number(start), end: Number(end) };
}

function assetRootsFor({ rootDir = path.join(__dirname, '..'), portableDir = process.env.PORTABLE_EXECUTABLE_DIR, executableDir, resourcesPath = process.resourcesPath } = {}) {
  // A portable catalog and its media stay together; fall back only when absent.
  return [...new Set([portableDir && path.join(portableDir, 'assets'), executableDir && path.join(executableDir, 'assets'), resourcesPath && path.join(resourcesPath, 'assets'), path.join(rootDir, 'assets')].filter(Boolean).map(p => path.resolve(p)))];
}

function catalogUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/assets/media/') || value.includes('?')) return undefined;
  try {
    const parts = decodePath(value);
    return '/' + parts.map(encodeURIComponent).join('/');
  } catch { return undefined; }
}

function cleanCatalog(value) {
  const entries = Array.isArray(value) ? value : value?.assets;
  if (!Array.isArray(entries) || entries.length > 100000) throw new Error('Invalid asset catalog');
  const ids = new Set();
  return entries.flatMap(entry => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || ids.has(entry.id) || !['procedural', 'image', 'video'].includes(entry.kind)) return [];
    const url = catalogUrl(entry.url);
    if (entry.kind !== 'procedural' && !url) return [];
    ids.add(entry.id);
    // Explicit fields prevent accidental native paths or unknown metadata leaking.
    const asset = {
      id: entry.id, name: entry.name, kind: entry.kind,
      tags: Array.isArray(entry.tags) ? entry.tags.filter(t => typeof t === 'string') : [],
      hue: Number.isFinite(entry.hue) ? entry.hue : 0,
      energy: Number.isFinite(entry.energy) ? entry.energy : 0.5,
      license: typeof entry.license === 'string' ? entry.license : 'Unspecified',
    };
    for (const key of ['visual', 'attribution', 'status']) if (typeof entry[key] === 'string') asset[key] = entry[key];
    for (const key of ['bpm', 'beats', 'duration', 'bytes', 'seed']) if (Number.isFinite(entry[key])) asset[key] = entry[key];
    if (typeof entry.favorite === 'boolean') asset.favorite = entry.favorite;
    if (typeof entry.source === 'string' && /^https:\/\//.test(entry.source)) asset.source = entry.source;
    if (url) asset.url = url;
    const thumbnail = catalogUrl(entry.thumbnail);
    if (thumbnail) asset.thumbnail = thumbnail;
    return [asset];
  });
}

function importedAsset(id, record, origin) {
  return { id, name: path.basename(record.file), kind: MEDIA_TYPES[record.extension].startsWith('video/') ? 'video' : 'image',
    url: `${origin}/media/${id}`, tags: ['imported'], hue: 0, energy: 0.5, license: 'User supplied', bytes: record.bytes };
}

async function saveRegistry(file, records) {
  const parent = path.dirname(file);
  await fsp.mkdir(parent, { recursive: true });
  const realParent = await fsp.realpath(parent);
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(realParent) !== normalize(parent)) throw new Error('Registry folder must not be a symbolic link');
  const data = JSON.stringify({ version: 1, media: [...records].map(([id, record]) => ({
    id, file: record.file, realFile: record.realFile, dev: record.dev, ino: record.ino, bytes: record.bytes,
  })) });
  if (Buffer.byteLength(data) > MAX_JSON_BYTES) throw new Error('Imported media registry is full');
  const temp = path.join(parent, `.lumina-registry-${randomUUID()}.tmp`);
  const handle = await fsp.open(temp, 'wx', 0o600);
  try {
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fsp.rename(temp, file);
  } finally { await fsp.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function loadRegistry(file, records) {
  const root = path.parse(file).root;
  let opened;
  try { opened = await openSafeFile(root, file.slice(root.length).split(path.sep)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  try {
    const value = JSON.parse(await readLimited(opened.handle, MAX_JSON_BYTES));
    if (value?.version !== 1 || !Array.isArray(value.media) || value.media.length > 4096) throw new Error('Invalid imported media registry');
    for (const entry of value.media) {
      if (!entry || typeof entry.id !== 'string' || !/^[0-9a-f-]{36}$/.test(entry.id) || records.has(entry.id) ||
          typeof entry.file !== 'string' || !path.isAbsolute(entry.file) || typeof entry.realFile !== 'string' || !path.isAbsolute(entry.realFile) ||
          ![entry.dev, entry.ino, entry.bytes].every(number => Number.isFinite(number) && number >= 0)) throw new Error('Invalid imported media registry');
      const extension = path.extname(entry.file).toLowerCase();
      if (!Object.hasOwn(MEDIA_TYPES, extension)) throw new Error('Invalid imported media registry');
      const entryRoot = path.parse(entry.file).root;
      records.set(entry.id, { file: entry.file, realFile: entry.realFile, dev: entry.dev, ino: entry.ino, bytes: entry.bytes,
        extension, root: entryRoot, parts: entry.file.slice(entryRoot.length).split(path.sep) });
    }
  } finally { await opened.handle.close(); }
}

async function createLocalServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const distDir = path.resolve(options.distDir || path.join(rootDir, 'dist'));
  const assetRoots = options.assetRoots || assetRootsFor({ ...options, rootDir });
  const requestedPort = options.port ?? 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid HTTP port');
  const registered = new Map();
  // This path is supplied only by main from app.getPath('userData'), never IPC.
  const registryPath = options.registryPath ? path.resolve(options.registryPath) : null;
  if (registryPath) await loadRegistry(registryPath, registered);
  let registryQueue = Promise.resolve();
  let origin, activeAssetRoot = null, catalog = [];
  for (const root of assetRoots) {
    let opened;
    try {
      opened = await openSafeFile(root, ['catalog.json']);
      catalog = cleanCatalog(JSON.parse(await readLimited(opened.handle, MAX_CATALOG_BYTES)));
      activeAssetRoot = path.resolve(root);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read asset catalog', { cause: error });
    } finally { if (opened) await opened.handle.close(); }
  }

  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    void respond(req, res).catch(error => {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 403 : 500);
      send(req, res, status, status === 404 ? 'Not found' : status === 500 ? 'Server error' : 'Request rejected');
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });

  function send(req, res, status, data, headers = {}) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function respond(req, res) {
    if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) throw new HttpError(403, 'Invalid origin');
    if (req.headers.referer) {
      try { if (new URL(req.headers.referer).origin !== origin) throw new Error(); }
      catch { throw new HttpError(403, 'Invalid referrer'); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const parts = decodePath(req.url);
    const route = '/' + parts.join('/');
    if (route === '/assets/catalog.json') {
      send(req, res, 200, JSON.stringify(catalog), { 'Content-Type': MIME_TYPES['.json'] });
      return;
    }
    let opened, extension, imported = false;
    if (parts[0] === 'media') {
      const record = parts.length === 2 && registered.get(parts[1]);
      if (!record) throw new HttpError(404, 'Unknown media');
      opened = await openSafeFile(record.root, record.parts, record);
      extension = record.extension;
      imported = true;
    } else if (parts[0] === 'assets' && parts[1] === 'media') {
      if (!activeAssetRoot || parts.length < 3) throw new HttpError(404, 'No media');
      opened = await openSafeFile(activeAssetRoot, parts.slice(1));
      extension = path.extname(parts.at(-1)).toLowerCase();
    } else {
      const fileParts = parts.length ? parts : ['index.html'];
      opened = await openSafeFile(distDir, fileParts);
      extension = path.extname(fileParts.at(-1)).toLowerCase();
    }
    const { handle, stat } = opened;
    try {
      const etag = `"${stat.ino.toString(16)}-${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      const modified = stat.mtime.toUTCString();
      const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': modified };
      if (imported) headers['Cache-Control'] = 'no-store';
      if (req.headers['if-none-match']?.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag) ||
          (!req.headers['if-none-match'] && req.headers['if-modified-since'] && Date.parse(modified) <= Date.parse(req.headers['if-modified-since']))) {
        res.writeHead(304, headers); res.end(); return;
      }
      let range = null;
      const ifRange = req.headers['if-range'];
      if (req.method === 'GET' && (!ifRange || ifRange === etag || (!ifRange.startsWith('W/') && Date.parse(ifRange) >= Date.parse(modified)))) {
        try { range = parseRange(req.headers.range, stat.size); }
        catch (error) {
          if (error.status !== 416) throw error;
          send(req, res, 416, 'Range not satisfiable', { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
          return;
        }
      }
      headers['Content-Length'] = range ? range.end - range.start + 1 : stat.size;
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
      await pipeline(handle.createReadStream({ ...(range || {}), autoClose: false }), res);
    } finally { await handle.close(); }
  }

  async function listen(port) {
    await new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => {
        server.off('error', failed);
        origin = `http://127.0.0.1:${server.address().port}`;
        resolve();
      };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen({ host: '127.0.0.1', port, exclusive: true });
    });
  }
  try { await listen(requestedPort); }
  catch (error) {
    if (!options.retryPort || requestedPort === 0 || error.code !== 'EADDRINUSE') throw error;
    await listen(0);
  }
  let closed = false;
  return {
    server, origin, port: server.address().port,
    getAssets() {
      return structuredClone(catalog).map(asset => ({ ...asset,
        ...(asset.url ? { url: origin + asset.url } : {}),
        ...(asset.thumbnail ? { thumbnail: origin + asset.thumbnail } : {}),
      })).concat([...registered].map(([id, record]) => importedAsset(id, record, origin)));
    },
    // Rewrite only known, picker-authorized IDs. A show file cannot authorize a
    // path, create a registration, or turn an arbitrary old URL into file access.
    resolveShowUrls(data) {
      const show = JSON.parse(validateShowJson(data));
      for (const asset of show.assets) {
        if (!asset || typeof asset !== 'object') continue;
        for (const field of ['url', 'thumbnail']) {
          if (typeof asset[field] !== 'string') continue;
          try {
            const url = new URL(asset[field], origin);
            if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) continue;
            const match = /^\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
            if (match && registered.has(match[1])) asset[field] = `${origin}/media/${match[1]}`;
            else if (url.pathname.startsWith('/assets/media/') && catalogUrl(url.pathname)) asset[field] = origin + catalogUrl(url.pathname);
          } catch { /* Leave application-level validation to the show loader. */ }
        }
      }
      return JSON.stringify(show);
    },
    // Only the main process calls this, with paths returned by the native picker.
    // There is deliberately no registration HTTP route or renderer path argument.
    async registerMedia(file) {
      const registration = registryQueue.then(async () => {
      if (closed || typeof file !== 'string' || !path.isAbsolute(file) || registered.size >= 4096) throw new Error('Cannot import media');
      const extension = path.extname(file).toLowerCase();
      if (!Object.hasOwn(MEDIA_TYPES, extension)) throw new Error('Unsupported media type');
      const root = path.parse(file).root;
      const parts = file.slice(root.length).split(path.sep);
      const opened = await openSafeFile(root, parts);
      try {
        if (closed) throw new Error('Server closed');
        for (const [id, record] of registered) {
          if (record.realFile === opened.realFile && record.dev === opened.stat.dev && record.ino === opened.stat.ino) return importedAsset(id, record, origin);
        }
        const id = randomUUID();
        const record = { root, parts, file, extension, dev: opened.stat.dev, ino: opened.stat.ino, realFile: opened.realFile, bytes: opened.stat.size };
        const next = new Map(registered).set(id, record);
        if (registryPath) await saveRegistry(registryPath, next);
        registered.set(id, record);
        return importedAsset(id, record, origin);
      } finally { await opened.handle.close(); }
      });
      registryQueue = registration.catch(() => {});
      return registration;
    },
    async close() {
      if (closed) return;
      closed = true;
      await registryQueue;
      registered.clear();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

// OSC 1.0 messages only (no bundles, strings, timetags, patterns or coercion).
// Triggers accept no args or a 0..1 gate; blackout accepts a 0/1 state or toggle;
// faders take one 0..1 value; clip takes a zero-based integer index 0..99999.
function parseOscMessage(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 8 || packet.length > 256 || packet.length % 4 !== 0) return null;
  let offset = 0;
  function string() {
    const end = packet.indexOf(0, offset);
    if (end < 0) throw new Error();
    for (let i = offset; i < end; i++) if (packet[i] < 0x20 || packet[i] > 0x7e) throw new Error();
    const value = packet.toString('ascii', offset, end);
    const next = (end + 4) & ~3;
    if (next > packet.length) throw new Error();
    for (let i = end; i < next; i++) if (packet[i] !== 0) throw new Error();
    offset = next;
    return value;
  }
  try {
    const address = string();
    if (!/^\/lumina\/(play|stop|next|prev|tap|blackout|crossfade|master|clip)$/.test(address)) return null;
    const types = string();
    if (!/^,[if]?$/.test(types) || offset + (types.length - 1) * 4 !== packet.length) return null;
    const args = types.length === 1 ? [] : [types[1] === 'i' ? packet.readInt32BE(offset) : packet.readFloatBE(offset)];
    if (args.some(value => !Number.isFinite(value))) return null;
    const action = address.slice(8);
    if (action === 'clip') {
      if (args.length !== 1 || types !== ',i' || args[0] < 0 || args[0] > 99999) return null;
    } else if (action === 'crossfade' || action === 'master') {
      if (args.length !== 1 || args[0] < 0 || args[0] > 1) return null;
    } else if (args.length && (args[0] < 0 || args[0] > 1 || (action === 'blackout' && args[0] !== 0 && args[0] !== 1))) return null;
    return { address, args };
  } catch { return null; }
}

async function startOscServer({ port = 9000, enabled = true, onMessage = () => {}, onError = () => {} } = {}) {
  if (!enabled) return { port: null, close: async () => {} };
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid OSC port');
  const socket = dgram.createSocket('udp4');
  let closed = false, allowance = 120, lastRefill = performance.now();
  socket.on('message', (packet, remote) => {
    if (remote.address !== '127.0.0.1') return;
    const now = performance.now();
    allowance = Math.min(120, allowance + (now - lastRefill) * 0.12);
    lastRefill = now;
    if (allowance < 1) return;
    allowance--;
    const message = parseOscMessage(packet);
    if (message) { try { onMessage(message); } catch (error) { onError(error); } }
  });
  await new Promise((resolve, reject) => {
    const failed = error => { socket.off('listening', ready); socket.close(); reject(error); };
    const ready = () => { socket.off('error', failed); socket.on('error', onError); resolve(); };
    socket.once('error', failed);
    socket.once('listening', ready);
    socket.bind({ address: '127.0.0.1', port, exclusive: true });
  });
  return {
    port: socket.address().port,
    async close() { if (!closed) { closed = true; await new Promise(resolve => socket.close(resolve)); } },
  };
}

module.exports = { createLocalServer, assetRootsFor, parseRange, parseOscMessage, startOscServer, validateShowJson, readShowFile, MAX_JSON_BYTES, MEDIA_TYPES };
