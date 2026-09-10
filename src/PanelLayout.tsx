import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  bounds,
  defaultLayout,
  fitSidePanels,
  layoutKey,
  limit,
  parseLayout,
  type PanelLayout,
} from "./layout";

function usePanelSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      };
      setSize((old) =>
        old.width === next.width && old.height === next.height ? old : next,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

export function usePanelLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return parseLayout(localStorage.getItem(layoutKey));
    } catch {
      return { ...defaultLayout };
    }
  });
  const workspace = usePanelSize();
  const main = usePanelSize();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(layoutKey, JSON.stringify(layout));
      } catch {
        /* Storage can be unavailable in private/restricted browsers. */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [layout]);
  const sides = fitSidePanels(workspace.width || window.innerWidth, layout);
  const height = main.height || 480;
  const width = main.width || 700;
  const preview = limit(height * layout.preview, 140, height - 210);
  const monitor = limit((width - 12) * layout.monitor, 190, width - 12 - 210);
  const set = (key: keyof PanelLayout, value: number) => {
    if (Number.isFinite(value))
      setLayout((old) => ({ ...old, [key]: limit(value, ...bounds[key]) }));
  };
  const style = {
    "--sidebar-size": `${sides.sidebar}px`,
    "--lyrics-size": `${sides.lyrics}px`,
    "--preview-size": `${preview}px`,
    "--monitor-size": `${monitor}px`,
    "--timeline-size": `${layout.timeline}px`,
    "--thumbnail-size": `${layout.thumbnail}px`,
  } as CSSProperties;
  return {
    layout,
    set,
    reset: () => setLayout({ ...defaultLayout }),
    style,
    workspace,
    main,
    sides,
    preview,
    monitor,
  };
}

export function PanelDivider({
  name,
  controls,
  axis,
  value,
  min,
  max,
  onChange,
  onReset,
  reverse = false,
  className = "",
}: {
  name: string;
  controls: string;
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  reverse?: boolean;
  className?: string;
}) {
  const drag = useRef<{ id: number; start: number; value: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const cursor = document.body.style.cursor;
    const select = document.body.style.userSelect;
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const stop = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("blur", stop);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = select;
      window.removeEventListener("blur", stop);
    };
  }, [axis, dragging]);
  const apply = (next: number) => onChange(limit(next, min, max));
  return (
    <div
      className={`panel-divider divider-${axis} ${dragging ? "dragging" : ""} ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={name}
      aria-controls={controls}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}ピクセル`}
      title={`${name}：ドラッグまたは矢印キーで調節。ダブルクリックで元に戻す`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !e.isPrimary) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          id: e.pointerId,
          start: axis === "x" ? e.clientX : e.clientY,
          value,
        };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (!start || start.id !== e.pointerId) return;
        apply(
          start.value +
            ((axis === "x" ? e.clientX : e.clientY) - start.start) *
              (reverse ? -1 : 1),
        );
      }}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return;
        drag.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        e.stopPropagation();
        const negative = axis === "x" ? "ArrowLeft" : "ArrowUp";
        const positive = axis === "x" ? "ArrowRight" : "ArrowDown";
        if (![negative, positive, "Home", "End", "Enter"].includes(e.key))
          return;
        e.preventDefault();
        if (e.key === "Enter") onReset();
        else if (e.key === "Home") apply(min);
        else if (e.key === "End") apply(max);
        else
          apply(
            value +
              (e.key === positive ? 1 : -1) *
                (reverse ? -1 : 1) *
                (e.shiftKey ? 40 : 10),
          );
      }}
    >
      <span />
    </div>
  );
}
