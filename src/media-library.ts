import type { Asset } from "./types";

/** A connected/cached local file takes priority over its online lightweight copy. */
export function mergeAssetCatalog(
  current: Asset[],
  incoming: Asset[],
  preferIncomingLocal = false,
): Asset[] {
  const byId = new Map(incoming.map((a) => [a.id, a]));
  const merged = current.map((a) => {
    const newer = byId.get(a.id);
    if (!newer) return a;
    if (a.url?.startsWith("blob:") && !preferIncomingLocal)
      return { ...newer, ...a, tags: [...new Set([...newer.tags, ...a.tags])] };
    if (newer.url?.startsWith("blob:"))
      return {
        ...a,
        ...newer,
        favorite: a.favorite,
        tags: [...new Set([...a.tags, ...newer.tags])],
      };
    return { ...a, ...newer, favorite: a.favorite };
  });
  const existing = new Set(current.map((a) => a.id));
  return [...merged, ...incoming.filter((a) => !existing.has(a.id))];
}

export async function downloadMediaBlob(
  url: string,
  signal: AbortSignal,
  maxBytes = 64 * 1024 * 1024,
): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body)
    throw new Error("素材をダウンロードできませんでした");
  const mime =
    response.headers.get("content-type")?.split(";")[0] || "video/mp4";
  if (mime.includes("text/html"))
    throw new Error("動画ファイルが見つかりません");
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("この素材はブラウザー内保存の上限を超えています");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error("この素材はブラウザー内保存の上限を超えています");
      chunks.push(new Uint8Array(value));
    }
    if (!bytes) throw new Error("動画ファイルが空です");
    return new Blob(chunks, { type: mime });
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
