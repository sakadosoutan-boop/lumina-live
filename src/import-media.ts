import type { Asset } from "./types";
import { storeMedia } from "./storage";

const extensions: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
export const MEDIA_ACCEPT =
  "video/*,image/*," +
  Object.keys(extensions)
    .map((ext) => "." + ext)
    .join(",");
export function mediaType(
  file: Pick<File, "name" | "type">,
): string | undefined {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (/^(video|image)\//.test(mime)) return mime;
  return extensions[file.name.split(".").at(-1)!.toLowerCase()];
}

export async function prepareImportedMedia(
  file: File,
  existing?: Asset,
  persist = storeMedia,
): Promise<{ asset: Asset; saved: boolean }> {
  const mime = mediaType(file);
  if (!mime)
    throw new Error("未対応形式です。MP4・WebMなどの動画を選んでください。");
  if (!file.size) throw new Error("空のファイルです。");
  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    throw new Error(
      "ファイルを読めません。Googleドライブの動画は「ダウンロード」に保存してから選び直してください。",
    );
  }
  const blob = file.type === mime ? file : file.slice(0, file.size, mime);
  // A failed replacement is marked session-only; restoration must never read
  // the previous cached bytes for that identity.
  const id = existing?.id ?? crypto.randomUUID();
  const url = URL.createObjectURL(blob);
  let saved = true;
  try {
    await persist(id, blob);
  } catch {
    saved = false;
  }
  return {
    saved,
    asset: {
      ...existing,
      id,
      name: file.name,
      kind: mime.startsWith("video/") ? "video" : "image",
      url,
      thumbnail: undefined,
      duration: undefined,
      tags: ["imported", ...(saved ? [] : ["session-only"])],
      hue: existing?.hue ?? 210,
      energy: existing?.energy ?? 0.5,
      license: existing?.license ?? "利用条件を確認してください",
      bytes: file.size,
      status: saved ? "local" : "今回のみ利用（次回は再選択）",
    },
  };
}
