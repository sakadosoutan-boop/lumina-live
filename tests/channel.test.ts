import { afterEach, expect, it, vi } from "vitest";
import { createProgramChannel } from "../src/channel";

afterEach(() => vi.unstubAllGlobals());
it("uses the browser channel when it is available", () => {
  const send = vi.fn();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage = null;
      postMessage = send;
      close = vi.fn();
      constructor(public name: string) {}
    },
  );
  const channel = createProgramChannel();
  channel.postMessage({ type: "hello" });
  expect(send).toHaveBeenCalledWith({ type: "hello" });
});
it("keeps the file/opener fallback alive when the origin is rejected", () => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new DOMException("Opaque origin", "SecurityError");
      }
    },
  );
  const channel = createProgramChannel();
  expect(() => {
    channel.postMessage({ type: "hello" });
    channel.close();
  }).not.toThrow();
});
it("keeps the renderer usable without the optional channel API", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  expect(() => createProgramChannel()).not.toThrow();
});
