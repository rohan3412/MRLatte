import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { lazyWithRetry, retryFailedLazyLoads } from "./lazyWithRetry";

// React.lazy keeps a failed import for good, so a panel whose code failed to
// download (inbox 6 Nov: "Failed to load panel (network error)") could never
// come back with "Try again": every render re-threw the same failure.
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>failed</p> : this.props.children; }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("after a failed load, rendering again tries the download again", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let reachable = false; // the panel's code can't be downloaded, until it can
  const Panel = () => <p>panel</p>;
  const Lazy = lazyWithRetry(() => (reachable
    ? Promise.resolve({ default: Panel })
    : Promise.reject(Object.assign(new Error("Loading chunk 7 failed."), { name: "ChunkLoadError" }))), 0);
  const el = document.createElement("div");
  const root = createRoot(el);
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const tree = (key) => <Boundary key={key}><Suspense fallback={<p>loading</p>}><Lazy /></Suspense></Boundary>;
    await act(async () => { root.render(tree(1)); });
    await act(async () => { await tick(); await tick(); });
    expect(el.textContent).toBe("failed");
    // The code is reachable again; "Try again" resets the boundary (a fresh
    // key here) and renders again.
    reachable = true;
    retryFailedLazyLoads();
    await act(async () => { root.render(tree(2)); });
    await act(async () => { await tick(); await tick(); });
    expect(el.textContent).toBe("panel");
  } finally {
    errors.mockRestore();
    await act(async () => root.unmount());
  }
});
