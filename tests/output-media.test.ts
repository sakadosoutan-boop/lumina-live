import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputMediaBridge } from "../src/output-media";
import type { Asset } from "../src/types";
const clip = (id: string, url: string): Asset => ({
  id,
  url,
  name: id,
  kind: "video",
  tags: [],
  hue: 0,
  energy: 0.5,
  license: "local",
});
afterEach(() => vi.restoreAllMocks());
describe("standalone output media", () => {
  it("shares local blob contents without repeatedly reading a large file", async () => {
    const data = new Blob(["local video"]);
    const read = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(data));
    const bridge = new OutputMediaBridge(),
      assets = [clip("a", "blob:null/a")];
    const first = await bridge.package(assets),
      second = await bridge.package(assets);
    expect(await first.blobs.a.text()).toBe("local video");
    expect(second.blobs.a).toBe(first.blobs.a);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("creates and replaces output-owned URLs and revokes them on disposal", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:output/1")
      .mockReturnValueOnce("blob:output/2");
    const revoke = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => {}),
      bridge = new OutputMediaBridge(),
      data = { a: new Blob(["a"]) };
    expect(bridge.restore([clip("a", "blob:null/a")], data)[0].url).toBe(
      "blob:output/1",
    );
    bridge.restore([clip("a", "blob:null/a")], data);
    expect(create).toHaveBeenCalledTimes(1);
    expect(bridge.restore([clip("a", "blob:null/b")], data)[0].url).toBe(
      "blob:output/2",
    );
    expect(revoke).toHaveBeenCalledWith("blob:output/1");
    bridge.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:output/2");
  });
  it("does not fetch external catalog or procedural assets", async () => {
    const read = vi.spyOn(globalThis, "fetch");
    const bridge = new OutputMediaBridge();
    expect(
      (await bridge.package([clip("v", "/assets/media/v.mp4")])).blobs,
    ).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });
  it("allows a missing blob to be relinked and retried", async () => {
    const read = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(Error("expired"))
      .mockResolvedValueOnce(new Response("video"));
    const bridge = new OutputMediaBridge(),
      assets = [clip("a", "blob:null/a")];
    expect((await bridge.package(assets)).blobs).toEqual({});
    expect(await (await bridge.package(assets)).blobs.a.text()).toBe("video");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest show cached when an older package finishes after a show switch", async () => {
    let finishOld!: (response: Response) => void;
    const read = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response("new show"))
      .mockRejectedValue(Error("source URL already revoked"));
    const bridge = new OutputMediaBridge();
    const old = bridge.package([clip("old", "blob:null/old")]);
    const currentAssets = [clip("current", "blob:null/current")];
    const current = await bridge.package(currentAssets);
    finishOld(new Response("old show"));
    await old;
    const republished = await bridge.package(currentAssets);
    expect(republished.blobs.current).toBe(current.blobs.current);
    expect(read).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it("does not let an old failed request evict a new request for the same URL", async () => {
    let failOld!: (error: Error) => void;
    const read = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failOld = reject;
          }),
      )
      .mockResolvedValueOnce(new Response("new read"))
      .mockRejectedValue(Error("source expired"));
    const bridge = new OutputMediaBridge(),
      assets = [clip("clip", "blob:null/clip")];
    const old = bridge.package(assets);
    await bridge.package([]);
    const current = await bridge.package(assets);
    failOld(Error("old read failed"));
    await old;
    expect((await bridge.package(assets)).blobs.clip).toBe(current.blobs.clip);
    expect(read).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it("continues playing an already transferred source when a later packet omits its blob", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:output/cached");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const bridge = new OutputMediaBridge(),
      assets = [clip("clip", "blob:null/clip")];
    bridge.restore(assets, { clip: new Blob(["video"]) });
    const updated = bridge.restore([{ ...assets[0], favorite: true }], {});
    expect(updated[0]).toMatchObject({
      url: "blob:output/cached",
      favorite: true,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it.each(["/media/relinked", undefined])(
    "releases an output-owned blob when the same ID changes to %s",
    (url) => {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:output/old");
      const revoke = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => {});
      const bridge = new OutputMediaBridge();
      bridge.restore([clip("clip", "blob:null/old")], {
        clip: new Blob(["old"]),
      });
      const replacement = { ...clip("clip", ""), url };
      expect(bridge.restore([replacement])[0]).toBe(replacement);
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:output/old");
      bridge.dispose();
      expect(revoke).toHaveBeenCalledOnce();
    },
  );

  it("ignores inherited payload keys and malformed blobs without aborting an asset update", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const bridge = new OutputMediaBridge();
    const assets = [
      clip("constructor", "blob:null/a"),
      clip("toString", "blob:null/b"),
      clip("broken", "blob:null/c"),
    ];
    let restored: Asset[] = [];
    expect(() => {
      restored = bridge.restore(assets, { broken: {} as Blob });
    }).not.toThrow();
    expect(restored).toEqual(assets);
    expect(create).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("transfers valid prototype-like asset IDs through a structured-cloned message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("video"),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:output/safe");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const sender = new OutputMediaBridge(),
      receiver = new OutputMediaBridge();
    const message = structuredClone(
      await sender.package([clip("__proto__", "blob:null/a")]),
    );
    expect(Object.hasOwn(message.blobs, "__proto__")).toBe(true);
    expect(receiver.restore(message.assets, message.blobs)[0].url).toBe(
      "blob:output/safe",
    );
    sender.dispose();
    receiver.dispose();
  });

  it("contains output URL allocation errors and permits a later retry", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementationOnce(() => {
        throw Error("allocation failed");
      })
      .mockReturnValue("blob:output/retry");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const bridge = new OutputMediaBridge(),
      assets = [clip("clip", "blob:null/a")],
      blobs = { clip: new Blob(["video"]) };
    expect(() => bridge.restore(assets, blobs)).not.toThrow();
    expect(bridge.restore(assets, blobs)[0].url).toBe("blob:output/retry");
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).not.toHaveBeenCalled();
    bridge.dispose();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:output/retry");
  });
});
