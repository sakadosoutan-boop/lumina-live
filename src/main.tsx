import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <main className="recovery">
        <h1>描画を停止しました</h1>
        <p>{this.state.error}</p>
        <p>保存済みのセットは保持されています。</p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
