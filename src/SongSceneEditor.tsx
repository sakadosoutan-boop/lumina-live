import { memo, useState } from "react";
import type { Show, Song, SongScene } from "./types";
import { setlistSceneSongs } from "./setlist-scenes";
import {
  MAX_SONG_SCENES,
  assignSceneMainAsset,
  captureSongScene,
  createCollectionSongScenes,
  missingSceneAssetIds,
} from "./song-scenes";

const typicalNames = [
  "イントロ",
  "Aメロ",
  "Bメロ",
  "サビ",
  "間奏",
  "Cメロ",
  "アウトロ",
];
const normalized = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function SongSceneEditorView({
  song,
  show,
  currentSongId,
  activeSceneId,
  thumbnails,
  createId,
  onChange,
  onRecall,
  onNotice,
  onSave,
}: {
  song: Song;
  show: Show;
  currentSongId: string;
  activeSceneId: string;
  thumbnails: Map<string, string>;
  createId: () => string;
  onChange: (scenes: SongScene[]) => void;
  onRecall: (id: string) => void;
  onNotice: (message: string) => void;
  onSave: () => void;
}) {
  const scenes = song.scenes ?? [];
  const [newName, setNewName] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [collection, setCollection] = useState(
    () =>
      setlistSceneSongs.find((s) =>
        normalized(song.title).includes(normalized(s.name)),
      )?.slug ?? "",
  );
  const full = scenes.length >= MAX_SONG_SCENES;
  const roomStoryAssets = show.assets.filter((asset) =>
    asset.tags.includes("wasurete-room-story"),
  );
  const hasRoomStory = ["main", "a", "b", "c"].every((section) =>
    roomStoryAssets.some((asset) => asset.tags.includes(`section:${section}`)),
  );
  const candidates = show.assets.filter((a) =>
    `${a.name} ${a.tags.join(" ")}`
      .toLowerCase()
      .includes(assetSearch.toLowerCase()),
  );
  const changeScene = (id: string, next: SongScene) =>
    onChange(scenes.map((s) => (s.id === id ? next : s)));
  const move = (index: number, direction: number) => {
    const next = [...scenes];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  };
  const addCurrent = () => {
    if (full) return;
    onChange([
      ...scenes,
      captureSongScene(
        show,
        newName.trim() ||
          typicalNames[scenes.length] ||
          `シーン${scenes.length + 1}`,
        createId(),
      ),
    ]);
    setNewName("");
    onNotice(
      "現在の素材・レイヤー・エフェクトを曲のシーンに保存しました。セット保存で持ち出せます。",
    );
  };
  const appendScenes = (added: SongScene[]) => {
    if (!added.length) {
      onNotice(
        "この曲の素材が見つかりません。素材ライブラリを読み込んでください。",
      );
      return;
    }
    if (scenes.length + added.length > MAX_SONG_SCENES) {
      onNotice(`シーンは1曲につき${MAX_SONG_SCENES}件まで保存できます。`);
      return;
    }
    onChange([...scenes, ...added]);
    onNotice(
      `${added.length}件を追加しました。シーン名や素材を編集して使えます。`,
    );
  };
  const addCollection = () => {
    if (!collection) return;
    appendScenes(createCollectionSongScenes(show, collection, createId));
  };
  const addRoomStory = () => {
    if (!hasRoomStory) return;
    const names = [
      "家の外観",
      "生活のある部屋",
      "物が消えていく部屋",
      "何もなくなった部屋",
    ];
    appendScenes(
      createCollectionSongScenes(
        { ...show, assets: roomStoryAssets },
        "wasurete-kudasai",
        createId,
      ).map((scene, index) => ({ ...scene, name: names[index] })),
    );
  };
  return (
    <section
      className="song-scene-editor"
      aria-label={`${song.title} のシーン設定`}
    >
      <div className="song-scene-heading">
        <div>
          <h3>{song.title} — シーン設定</h3>
          <p>
            素材の割り当てを準備し、「呼び出す」で切り替えます。曲と歌詞の再生は続きます。
          </p>
        </div>
        <span>
          {scenes.length} / {MAX_SONG_SCENES}
        </span>
      </div>
      <div className="song-scene-tools">
        <label>
          曲別素材から作成
          <select
            aria-label="シーン作成に使う曲別素材"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">素材の曲を選択</option>
            {setlistSceneSongs.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!collection || full} onClick={addCollection}>
          基本・A・B・Cを追加
        </button>
        {collection === "wasurete-kudasai" && hasRoomStory && (
          <button disabled={full} onClick={addRoomStory}>
            家の外観→空室の4シーンを追加
          </button>
        )}
      </div>
      <div className="song-scene-tools">
        <label>
          新しいシーン名
          <input
            aria-label="新しいシーン名"
            maxLength={160}
            value={newName}
            placeholder={
              typicalNames[scenes.length] || `シーン${scenes.length + 1}`
            }
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <button disabled={full} onClick={addCurrent}>
          現在の映像を追加保存
        </button>
      </div>
      <label className="song-scene-search">
        割り当てる素材を検索
        <input
          aria-label="シーンに割り当てる素材を検索"
          value={assetSearch}
          placeholder="素材名・タグ"
          onChange={(e) => setAssetSearch(e.target.value)}
        />
      </label>
      {!scenes.length && (
        <p className="song-scene-empty">
          まだシーンがありません。曲別素材から作るか、ミキサーで映像を作って「現在の映像を追加保存」を押してください。
        </p>
      )}
      <ol className="song-scene-list">
        {scenes.map((scene, index) => {
          const main = show.assets.find((a) => a.id === scene.decks[0].assetId);
          const options =
            main && !candidates.some((a) => a.id === main.id)
              ? [main, ...candidates]
              : candidates;
          const missing = missingSceneAssetIds(scene, show.assets);
          const thumb = main?.thumbnail || (main && thumbnails.get(main.id));
          return (
            <li
              key={scene.id}
              className={
                activeSceneId === scene.id && currentSongId === song.id
                  ? "song-scene-row active"
                  : "song-scene-row"
              }
            >
              <div className="song-scene-preview">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" />
                ) : (
                  <span>SCENE {index + 1}</span>
                )}
              </div>
              <div className="song-scene-fields">
                <label>
                  {index + 1}. シーン名
                  <input
                    aria-label={`${index + 1}番目のシーン名`}
                    defaultValue={scene.name}
                    maxLength={160}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim() || scene.name;
                      e.currentTarget.value = name;
                      if (name !== scene.name)
                        changeScene(scene.id, { ...scene, name });
                    }}
                  />
                </label>
                <label>
                  メイン素材（単独表示）
                  <select
                    aria-label={`${index + 1}番目のシーンのメイン素材`}
                    value={scene.decks[0].assetId}
                    onChange={(e) => {
                      const chosen = show.assets.find(
                        (a) => a.id === e.target.value,
                      );
                      if (chosen)
                        changeScene(
                          scene.id,
                          assignSceneMainAsset(scene, chosen),
                        );
                    }}
                  >
                    {!main && (
                      <option value={scene.decks[0].assetId}>
                        未接続：{scene.decks[0].assetId}
                      </option>
                    )}
                    {options.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="song-scene-layers">
                  {scene.decks
                    .map(
                      (d, slot) =>
                        `${["A", "B", "C"][slot]}: ${show.assets.find((a) => a.id === d.assetId)?.name ?? "未接続"} (${Math.round(d.opacity * 100)}%)`,
                    )
                    .join(" / ")}
                </p>
                {!!missing.length && (
                  <p className="song-scene-missing" role="status">
                    未接続の素材があります。素材を接続するか、現在の映像で更新してください。
                  </p>
                )}
              </div>
              <div className="song-scene-actions">
                <button
                  disabled={currentSongId !== song.id || !!missing.length}
                  title={
                    currentSongId !== song.id
                      ? "この曲をロードしてから呼び出せます"
                      : "映像のみを即時に切り替えます"
                  }
                  onClick={() => onRecall(scene.id)}
                >
                  呼び出す（即時）
                </button>
                <button
                  onClick={() => {
                    changeScene(
                      scene.id,
                      captureSongScene(show, scene.name, scene.id),
                    );
                    onNotice("保存シーンを現在の映像で更新しました。");
                  }}
                >
                  現在の映像で更新
                </button>
                <button
                  disabled={full}
                  onClick={() => {
                    const copy = {
                      ...scene,
                      id: createId(),
                      name: `${scene.name.slice(0, 150)}（コピー）`,
                      decks: scene.decks.map((d) => ({ ...d })),
                      fx: { ...scene.fx },
                    };
                    onChange([
                      ...scenes.slice(0, index + 1),
                      copy,
                      ...scenes.slice(index + 1),
                    ]);
                  }}
                >
                  複製
                </button>
                <button
                  aria-label={`${index + 1}番目のシーンを上へ`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`${index + 1}番目のシーンを下へ`}
                  disabled={index === scenes.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  aria-label={`${index + 1}番目のシーンを削除`}
                  onClick={() =>
                    onChange(scenes.filter((s) => s.id !== scene.id))
                  }
                >
                  削除
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="song-scene-footnote">
        「現在の映像で更新」はA/B/Cの重ね方・速度・エフェクトも保存します。呼び出すと自動VJと予約切替を解除します。登録後は上部の「セット保存」で書き出してください。
      </p>
      <button onClick={onSave}>セット全体を保存</button>
    </section>
  );
}

// Playback time updates need not rebuild hundreds of material options. The
// callbacks refer to the same editor song/show and stable live-state refs.
export const SongSceneEditor = memo(
  SongSceneEditorView,
  (a, b) =>
    a.show === b.show &&
    a.song === b.song &&
    a.currentSongId === b.currentSongId &&
    a.activeSceneId === b.activeSceneId &&
    a.thumbnails === b.thumbnails &&
    a.createId === b.createId,
);
