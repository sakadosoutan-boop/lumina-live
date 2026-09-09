"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  powerSaveBlocker,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const constants = require("node:fs").constants;
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  createLocalServer,
  startOscServer,
  validateShowJson,
  readShowFile,
  MEDIA_TYPES,
} = require("./server.cjs");

app.enableSandbox();
const PARTITION = "persist:lumina-live";
let localServer, osc, operator, output, outputDisplayId, outputReady;
let blockerId,
  stopping = false,
  cleanupDone = false,
  dialogBusy = false;
const gestures = new Map();

function isAppUrl(value, isOutput = false) {
  try {
    const url = new URL(value);
    return (
      url.origin === localServer?.origin &&
      url.pathname === "/" &&
      (isOutput ? url.search === "?output=1" : url.search === "")
    );
  } catch {
    return false;
  }
}

function trustedContents(contents, allowOutput = false) {
  return (
    !!contents &&
    !contents.isDestroyed() &&
    ((operator &&
      !operator.isDestroyed() &&
      contents === operator.webContents &&
      isAppUrl(contents.getURL())) ||
      (allowOutput &&
        output &&
        !output.isDestroyed() &&
        contents === output.webContents &&
        isAppUrl(contents.getURL(), true)))
  );
}

function assertSender(event, allowOutput = false) {
  if (
    !trustedContents(event.sender, allowOutput) ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isAppUrl(event.senderFrame.url, event.sender === output?.webContents)
  )
    throw new Error("Untrusted IPC sender");
}

function secureWindow(win) {
  win.setMenu(null);
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const eventName of [
    "will-navigate",
    "will-frame-navigate",
    "will-redirect",
  ]) {
    contents.on(eventName, (event) => event.preventDefault());
  }
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // A main-process gesture adds a second gate to the isolated preload's isTrusted.
  contents.on("before-mouse-event", (_event, mouse) => {
    if (mouse.type === "mouseUp" && ["left", "middle"].includes(mouse.button))
      gestures.set(contents.id, performance.now());
  });
  contents.on("before-input-event", (_event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "Enter" &&
      !input.isAutoRepeat
    )
      gestures.set(contents.id, performance.now());
    if (win === output && input.type === "keyDown" && input.key === "Escape")
      win.close();
  });
  contents.on("destroyed", () => gestures.delete(contents.id));
}

const webPreferences = {
  preload: path.join(__dirname, "preload.cjs"),
  partition: PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  backgroundThrottling: false,
};

async function createOperator() {
  operator = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: "#090b12",
    title: "Lumina Live",
    webPreferences,
  });
  secureWindow(operator);
  operator.once("ready-to-show", () => {
    if (operator && !operator.isDestroyed()) operator.show();
  });
  operator.on("closed", () => {
    operator = undefined;
    if (output && !output.isDestroyed()) output.destroy();
    app.quit();
  });
  await operator.loadURL(localServer.origin + "/");
}

async function openOutput(displayId) {
  if (displayId !== undefined && !Number.isSafeInteger(displayId))
    throw new Error("Invalid display ID");
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display =
    displayId === undefined
      ? displays.find((item) => item.id !== primary.id) || primary
      : displays.find((item) => item.id === displayId);
  if (!display) throw new Error("Display is no longer connected");
  if (output && !output.isDestroyed()) {
    if (outputDisplayId !== display.id) {
      output.setFullScreen(false);
      output.setBounds(display.bounds);
      output.setFullScreen(true);
      outputDisplayId = display.id;
    }
    await outputReady;
    if (output && !output.isDestroyed()) output.showInactive();
    return;
  }
  outputDisplayId = display.id;
  const win = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: "#000000",
    title: "Lumina Live — Output",
    webPreferences,
  });
  output = win;
  secureWindow(win);
  win.on("closed", () => {
    if (output === win) {
      output = undefined;
      outputDisplayId = undefined;
      outputReady = undefined;
    }
  });
  // Same origin AND session as the operator: the application's BroadcastChannel
  // owns synchronization; there is no independent output renderer or IPC state bus.
  outputReady = win.loadURL(localServer.origin + "/?output=1");
  try {
    await outputReady;
    if (!win.isDestroyed()) win.showInactive();
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

async function withPicker(action) {
  if (dialogBusy) throw new Error("A file picker is already open");
  dialogBusy = true;
  try {
    return await action();
  } finally {
    dialogBusy = false;
  }
}

function handle(channel, action, { allowOutput = false, maxArgs = 0 } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event, allowOutput);
    if (args.length > maxArgs) throw new Error("Invalid IPC arguments");
    // Native filesystem errors can include paths. Keep those in main only.
    try {
      return await action(...args);
    } catch (error) {
      if (error.code || error.cause)
        throw new Error("The selected file could not be accessed");
      throw new Error(error.message || "Operation failed");
    }
  });
}

function installIpc() {
  handle("lumina:get-assets", () => localServer.getAssets(), {
    allowOutput: true,
  });
  handle("lumina:get-displays", () =>
    screen
      .getAllDisplays()
      .map((display) => ({
        id: display.id,
        label: display.label || `Display ${display.id}`,
        width: display.size.width,
        height: display.size.height,
      })),
  );
  handle("lumina:open-output", openOutput, { maxArgs: 1 });
  handle("lumina:import-media", () =>
    withPicker(async () => {
      const selection = await dialog.showOpenDialog(operator, {
        title: "Import media",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Video and images",
            extensions: Object.keys(MEDIA_TYPES).map((ext) => ext.slice(1)),
          },
        ],
      });
      if (selection.canceled) return [];
      if (selection.filePaths.length > 128)
        throw new Error("Select at most 128 files at a time");
      const assets = [];
      for (const file of selection.filePaths)
        assets.push(await localServer.registerMedia(file));
      return assets;
    }),
  );
  handle(
    "lumina:save-show",
    (data) => {
      validateShowJson(data);
      return withPicker(async () => {
        const selection = await dialog.showSaveDialog(operator, {
          title: "Save show",
          defaultPath: "Lumina-show.json",
          filters: [{ name: "Lumina show", extensions: ["json"] }],
          properties: ["showOverwriteConfirmation"],
        });
        if (selection.canceled || !selection.filePath) return false;
        const file = selection.filePath;
        if (path.extname(file).toLowerCase() !== ".json")
          throw new Error("Use a .json show filename");
        // Resolve the native picker's parent before writing; reject link targets and
        // hardlinked existing files so a save cannot overwrite an unrelated file.
        const parent = path.dirname(file);
        if (
          path.resolve(await fs.realpath(parent)).toLowerCase() !==
          path.resolve(parent).toLowerCase()
        )
          throw new Error("Select a folder without symbolic links");
        let info;
        try {
          info = await fs.lstat(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink > 1))
          throw new Error("Select a regular JSON file");
        const temp = path.join(parent, `.lumina-show-${randomUUID()}.tmp`);
        const handle = await fs.open(
          temp,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW || 0),
          0o600,
        );
        try {
          try {
            await handle.writeFile(data, "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          let current;
          try {
            current = await fs.lstat(file);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (
            (info &&
              (!current ||
                current.isSymbolicLink() ||
                current.nlink > 1 ||
                current.ino !== info.ino ||
                current.dev !== info.dev)) ||
            (!info && current)
          )
            throw new Error("Selected file changed");
          // Keep the previous show intact until the complete new JSON is on disk.
          await fs.rename(temp, file);
        } finally {
          await fs.unlink(temp).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
        return true;
      });
    },
    { maxArgs: 1 },
  );
  handle("lumina:load-show", () =>
    withPicker(async () => {
      const selection = await dialog.showOpenDialog(operator, {
        title: "Load show",
        properties: ["openFile"],
        filters: [{ name: "Lumina show", extensions: ["json"] }],
      });
      if (selection.canceled || selection.filePaths.length !== 1) return null;
      return localServer.resolveShowUrls(
        await readShowFile(selection.filePaths[0]),
      );
    }),
  );
  ipcMain.on("lumina:external-click", (event, value) => {
    try {
      assertSender(event);
      const gesture = gestures.get(event.sender.id);
      gestures.delete(event.sender.id);
      if (
        gesture === undefined ||
        performance.now() - gesture > 1000 ||
        !operator.isFocused() ||
        typeof value !== "string" ||
        value.length > 4096
      )
        return;
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return;
      void shell.openExternal(url.href).catch(() => {});
    } catch {
      /* Ignore untrusted events without exposing main-process details. */
    }
  });
}

function secureSession() {
  const ses = session.fromPartition(PARTITION);
  // Keep the VJ runtime offline even if show metadata contains remote URLs.
  ses.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      allowed =
        url.origin === localServer.origin ||
        ["blob:", "data:"].includes(url.protocol);
    } catch {
      /* deny */
    }
    callback({ cancel: !allowed });
  });
  ses.on("will-download", (event, item, contents) => {
    // Only app-owned blobs can be exported. Renderer filenames are suggestions,
    // never paths; Electron always presents the native Save dialog.
    let allowed = false;
    let extension, label, filename;
    try {
      const chain = item.getURLChain();
      const mime = item.getMimeType().split(";")[0].trim().toLowerCase();
      const suggested = item.getFilename();
      const requestedExtension = path.extname(suggested).slice(1).toLowerCase();
      if (mime === "video/webm" || mime === "video/mp4") {
        extension = mime === "video/mp4" ? "mp4" : "webm";
        label = "Recording";
      } else if (mime === "application/json") {
        extension = "json";
        label = "Show";
      } else if (
        mime === "text/plain" &&
        ["lrc", "srt"].includes(requestedExtension)
      ) {
        extension = requestedExtension;
        label = "Lyrics";
      }
      allowed =
        trustedContents(contents) &&
        chain.length > 0 &&
        chain.every((value) => {
          const url = new URL(value);
          return url.protocol === "blob:" && url.origin === localServer.origin;
        }) &&
        !!extension;
      // Discard path components, Windows aliases, controls (including bidi),
      // and executable/double extensions from a renderer-controlled name.
      const stem = path.win32
        .basename(suggested)
        .replace(/\.[^.]*$/, "")
        .replace(/[<>:"/\\|?*.\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_")
        .trim()
        .slice(0, 100);
      const safeStem =
        stem && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)
          ? stem
          : `Lumina-${label?.toLowerCase()}`;
      filename = `${safeStem}.${extension}`;
    } catch {
      /* deny */
    }
    if (!allowed) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      title: `Save ${label.toLowerCase()}`,
      defaultPath: filename,
      filters: [{ name: label, extensions: [extension] }],
      properties: ["showOverwriteConfirmation"],
    });
  });
  ses.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      trustedContents(contents) &&
      requestingOrigin === localServer.origin &&
      details?.isMainFrame !== false &&
      (permission === "midi" ||
        (permission === "media" && details?.mediaType === "audio")),
  );
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed =
      trustedContents(contents) &&
      details?.isMainFrame !== false &&
      isAppUrl(details?.requestingUrl || contents.getURL());
    // Audio analysis and ordinary MIDI are local app features; no camera/SysEx.
    callback(
      !!allowed &&
        (permission === "midi" ||
          (permission === "media" &&
            details.mediaTypes?.length > 0 &&
            details.mediaTypes.every((type) => type === "audio"))),
    );
  });
}

async function cleanup() {
  if (blockerId !== undefined && powerSaveBlocker.isStarted(blockerId))
    powerSaveBlocker.stop(blockerId);
  await Promise.allSettled([osc?.close(), localServer?.close()]);
}

app.on("before-quit", (event) => {
  if (cleanupDone) return;
  event.preventDefault();
  if (stopping) return;
  stopping = true;
  void cleanup().finally(() => {
    cleanupDone = true;
    app.quit();
  });
});
app.on("window-all-closed", () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (operator && !operator.isDestroyed()) {
      if (operator.isMinimized()) operator.restore();
      operator.show();
      operator.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      localServer = await createLocalServer({
        rootDir: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        distDir: app.isPackaged
          ? path.join(process.resourcesPath, "app.asar.unpacked", "dist")
          : undefined,
        executableDir: app.isPackaged
          ? path.dirname(app.getPath("exe"))
          : undefined,
        registryPath: path.join(app.getPath("userData"), "imported-media.json"),
        port: 4173,
        retryPort: true,
      });
      if (stopping) {
        await localServer.close();
        return;
      }
      blockerId = powerSaveBlocker.start("prevent-display-sleep");
      secureSession();
      installIpc();
      screen.on("display-removed", (_event, display) => {
        if (display.id === outputDisplayId && output && !output.isDestroyed())
          output.close();
      });
      screen.on("display-metrics-changed", (_event, display) => {
        if (display.id === outputDisplayId && output && !output.isDestroyed())
          output.setBounds(display.bounds);
      });
      await createOperator();
      if (stopping) return;
      try {
        // No LAN binding or firewall changes. Disable the UDP listener entirely with
        // --no-osc or LUMINA_OSC=0 (HTTP loopback is still needed by the renderer).
        osc = await startOscServer({
          enabled:
            !process.argv.includes("--no-osc") &&
            process.env.LUMINA_OSC !== "0",
          onMessage: (message) => {
            if (
              operator &&
              !operator.isDestroyed() &&
              trustedContents(operator.webContents)
            )
              operator.webContents.send("lumina:remote", message);
          },
          onError: () => console.warn("OSC listener encountered an error"),
        });
        if (stopping) await osc.close();
      } catch {
        console.warn(
          "OSC unavailable on 127.0.0.1:9000; the app will continue without OSC.",
        );
      }
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Lumina Live could not start",
        error.code === "ENOENT"
          ? "Build the app before starting it (npm run build)."
          : "The local app could not be loaded. Check the build and asset catalog.",
      );
      app.quit();
    });
}
