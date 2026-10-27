import { useEffect, useRef, useState } from "react";

export function parseBpmInput(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 20 && value <= 400
    ? Math.round(value * 10) / 10
    : null;
}

export function BpmInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelled = useRef(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  return (
    <>
      <input
        aria-label="BPM"
        type="text"
        inputMode="decimal"
        title="20〜400。Enter または欄の外をクリックして確定。Escで取消。"
        aria-invalid={invalid}
        value={draft}
        onFocus={() => {
          editing.current = true;
          cancelled.current = false;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          editing.current = false;
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          const next = parseBpmInput(draft);
          setDraft(String(next ?? value));
          setInvalid(next === null);
          if (next !== null) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelled.current = true;
            setDraft(String(value));
            setInvalid(false);
            e.currentTarget.blur();
          }
        }}
      />
      {invalid && <small role="status">20〜400で入力</small>}
    </>
  );
}
