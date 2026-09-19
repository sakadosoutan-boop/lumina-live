import type { Show } from "./types";

export function SpatialControls({
  fx,
  onChange,
  compact = false,
}: {
  fx: Show["fx"];
  onChange: (fx: Show["fx"]) => void;
  compact?: boolean;
}) {
  const depth = fx.depth ?? 0;
  const mapping = fx.mapping ?? 0;
  return (
    <section
      className={`spatial-controls${compact ? " compact" : ""}`}
      aria-label="立体・奥行きエフェクト"
    >
      <div className="spatial-heading">
        <strong>立体・奥行き</strong>
        <button
          disabled={!depth && !mapping}
          onClick={() => onChange({ ...fx, depth: 0, mapping: 0 })}
        >
          立体FX解除
        </button>
      </div>
      <div className="spatial-buttons">
        <button
          aria-pressed={depth < 0}
          onClick={() => onChange({ ...fx, depth: depth < 0 ? 0 : -0.8 })}
        >
          沈み込む
        </button>
        <button
          aria-pressed={depth > 0}
          onClick={() => onChange({ ...fx, depth: depth > 0 ? 0 : 0.8 })}
        >
          飛び出す
        </button>
        <button
          aria-pressed={mapping > 0}
          onClick={() => onChange({ ...fx, mapping: mapping > 0 ? 0 : 0.85 })}
        >
          マッピング風
        </button>
      </div>
      {!compact && (
        <>
          <p>
            「沈み込む」と「飛び出す」は方向切替。マッピング風は重ねて使えます。再生中はBPMに合わせて動き、歌詞にはかかりません。
          </p>
          <label className="spatial-range">
            奥行きの強さ <output>{Math.round(Math.abs(depth) * 100)}%</output>
            <input
              aria-label="奥行きの強さ"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={Math.abs(depth)}
              onChange={(e) =>
                onChange({
                  ...fx,
                  depth: Number(e.target.value) * (depth < 0 ? -1 : 1),
                })
              }
            />
          </label>
          <label className="spatial-range">
            壁面の立体感 <output>{Math.round(mapping * 100)}%</output>
            <input
              aria-label="壁面の立体感"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={mapping}
              onChange={(e) =>
                onChange({ ...fx, mapping: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            立体FXの周期
            <select
              aria-label="立体FXの周期"
              value={fx.motionBeats ?? 8}
              onChange={(e) =>
                onChange({ ...fx, motionBeats: Number(e.target.value) })
              }
            >
              {[2, 4, 8, 16, 32].map((n) => (
                <option value={n} key={n}>
                  {n}拍{n === 8 ? "（標準）" : ""}
                </option>
              ))}
            </select>
          </label>
          <p>
            マッピング風は平面スクリーン向けの立体表現です。実物の壁や箱への投影位置を合わせる機能ではありません。
          </p>
        </>
      )}
    </section>
  );
}
