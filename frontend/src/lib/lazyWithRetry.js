import React from "react";

// Loads whose code failed to download, each a function that arms a fresh
// attempt. Emptied by retryFailedLazyLoads().
const failed = new Set();

/**
 * Drop-in replacement for `React.lazy` that retries the dynamic import once
 * after `delayMs` if the first attempt fails (e.g. a stale chunk URL after an
 * HMR rebuild). If the retry also fails, the error propagates normally and is
 * caught by the nearest error boundary.
 *
 * React.lazy remembers a failed import for good, so after a failure every
 * render re-threw it and the boundary's "Try again" could never work (inbox
 * 6 Nov, "Failed to load panel (network error)"). A failed load is therefore
 * noted, and retryFailedLazyLoads() (the boundary's Try again) gives it a
 * fresh lazy component, so the next render downloads the code again. It is
 * not swapped automatically: React re-renders a failed subtree by itself, and
 * an automatic swap would retry forever without ever showing the error.
 *
 * Usage:
 *   const MyPanel = lazyWithRetry(() => import("@/components/MyPanel"));
 *
 * @param {() => Promise<{ default: React.ComponentType }>} factory
 * @param {number} [delayMs=500]
 */
export function lazyWithRetry(factory, delayMs = 500) {
  let current;
  const make = () => React.lazy(() =>
    factory()
      .catch(() => new Promise((resolve) => setTimeout(resolve, delayMs)).then(factory))
      .catch((err) => {
        failed.add(() => { current = make(); });
        throw err;
      }));
  current = make();
  return React.forwardRef(function LazyWithRetry(props, ref) {
    const Current = current;
    return <Current ref={ref} {...props} />;
  });
}

/** Arm every load that failed for a fresh attempt on its next render. */
export function retryFailedLazyLoads() {
  for (const arm of failed) arm();
  failed.clear();
}
