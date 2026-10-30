import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SongSceneEditor } from "../src/SongSceneEditor";
import { createCollectionSongScenes } from "../src/song-scenes";
import { validateAssetCatalog, validateShow } from "../src/storage";
import type { Show, Song } from "../src/types";

function fixture() {
  const show = validateShow(
    readFileSync(
      new URL("../examples/Demo-Session.lumina.json", import.meta.url),
      "utf8",
    ),
  );
  const catalog = validateAssetCatalog(
    JSON.parse(
      readFileSync(
        new URL("../docs/assets/catalog.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  show.assets = [
    ...new Map([...show.assets, ...catalog].map((a) => [a.id, a])).values(),
  ];
  let serial = 0;
  const song = {
    ...show.songs[0],
    title: "ミュージック",
    scenes: createCollectionSongScenes(
      show,
      "music",
      () => `scene-${++serial}`,
    ),
  };
  return { show, song };
}
function render(show: Show, song: Song, currentSongId = song.id) {
  return renderToStaticMarkup(
    <SongSceneEditor
      song={song}
      show={show}
      currentSongId={currentSongId}
      activeSceneId=""
      thumbnails={new Map()}
      createId={() => "new-id"}
      onChange={vi.fn()}
      onRecall={vi.fn()}
      onNotice={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe("song scene editor with the shipped material catalog", () => {
  it("renders all four saved song sections and a separate material selector for each", () => {
    const { show, song } = fixture();
    const html = render(show, song);
    expect(song.scenes).toHaveLength(4);
    for (let i = 1; i <= 4; i++) {
      expect(html).toContain(`aria-label="${i}番目のシーンのメイン素材"`);
      expect(html).toContain(`aria-label="${i}番目のシーン名"`);
    }
    expect(html).toContain('value="music" selected=""');
    expect(html).toContain("セット全体を保存");
  });
  it("keeps an unavailable saved reference visible for relinking and disables its recall", () => {
    const { show, song } = fixture();
    song.scenes![0].decks[0].assetId = "missing-upload";
    const html = render(show, song);
    expect(html).toContain("未接続：missing-upload");
    expect(html).toContain("未接続の素材があります");
    expect(html).toMatch(
      /<button disabled="" title="映像のみを即時に切り替えます">呼び出す（即時）/,
    );
  });
  it("allows preparing another song without enabling accidental recall over the current song", () => {
    const { show, song } = fixture();
    const html = render(show, song, "different-live-song");
    expect(
      html.match(
        /<button disabled="" title="この曲をロードしてから呼び出せます">/g,
      ),
    ).toHaveLength(4);
  });
});
