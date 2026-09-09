import type { Asset } from "./types";

const blobSource = (asset: Asset): string | undefined =>
  asset.kind !== "procedural" && asset.url?.startsWith("blob:")
    ? asset.url
    : undefined;

/** file:// windows have opaque origins. Give the output its own blob URLs. */
export class OutputMediaBridge {
  private outgoing = new Map<string, Promise<Blob>>();
  private incoming = new Map<string, { source: string; url: string }>();

  async package(assets: Asset[]) {
    // Prune at invocation time: a slow, older show must never evict the latest
    // show's cache when its asynchronous reads eventually finish.
    const sources = new Set(assets.map(blobSource));
    for (const source of this.outgoing.keys())
      if (!sources.has(source)) this.outgoing.delete(source);
    const blobs: Record<string, Blob> = Object.create(null);
    await Promise.all(
      assets.map(async (asset) => {
        const source = blobSource(asset);
        if (!source) return;
        let blob = this.outgoing.get(source);
        try {
          if (!blob) {
            blob = fetch(source).then((response) => {
              if (!response.ok) throw new Error("Media unavailable");
              return response.blob();
            });
            this.outgoing.set(source, blob);
          }
          blobs[asset.id] = await blob;
        } catch {
          // A removed source may already have a newer read in progress.
          if (blob && this.outgoing.get(source) === blob)
            this.outgoing.delete(source);
        }
      }),
    );
    return { type: "assets", assets, blobs };
  }

  restore(assets: Asset[], blobs?: Record<string, Blob>): Asset[] {
    const sources = new Map(
      assets.map((asset) => [asset.id, blobSource(asset)]),
    );
    for (const [id, value] of this.incoming) {
      if (sources.get(id) !== value.source) {
        URL.revokeObjectURL(value.url);
        this.incoming.delete(id);
      }
    }
    return assets.map((asset) => {
      const source = blobSource(asset);
      if (!source) return asset;
      let current = this.incoming.get(asset.id);
      if (!current) {
        const blob =
          blobs && Object.hasOwn(blobs, asset.id) ? blobs[asset.id] : undefined;
        if (!(blob instanceof Blob)) return asset;
        try {
          current = { source, url: URL.createObjectURL(blob) };
          this.incoming.set(asset.id, current);
        } catch {
          // Leave this source retryable without preventing unrelated asset updates.
          return asset;
        }
      }
      // Metadata updates or failed retransmissions must keep an already-local URL.
      return { ...asset, url: current.url };
    });
  }

  dispose() {
    for (const value of this.incoming.values()) URL.revokeObjectURL(value.url);
    this.incoming.clear();
    this.outgoing.clear();
  }
}
