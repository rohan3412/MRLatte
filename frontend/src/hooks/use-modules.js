import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { fetchModules } from "@/lib/modules";
import { forgetCapabilities } from "@/lib/lesionMetrics";

// Which optional modules are installed, fetched ONCE at startup and shared by
// every gated section. See lib/modules.js for why asset URLs must never be
// probed to answer this question.

const ModuleContext = createContext(null);

const EMPTY = {
  loading: true,
  ok: null,          // null = not answered yet, false = backend unreachable
  reason: null,
  modules: [],
  capabilities: {},
  installable: false,
  moduleRoot: null,
  freeBytes: null,
};

export function ModuleProvider({ children }) {
  const [state, setState] = useState(EMPTY);
  // Module Store visibility lives here rather than in Dashboard because the
  // other thing that opens it — ModuleGate's install prompt — is rendered deep
  // inside the sidebar, several unrelated components away from the overlay.
  const [store, setStore] = useState({ open: false, focus: null });
  // Installs running, per reporter (the Module Store and the Atlas Manager each
  // keep their own jobs), so the toolbar's store icon can show that something
  // is installing even with both closed (inbox 29 Oct).
  const [installingBy, setInstallingBy] = useState({});
  const reportInstalling = useCallback((source, n) => {
    setInstallingBy((p) => (p[source] === n ? p : { ...p, [source]: n }));
  }, []);
  const installing = Object.values(installingBy).reduce((a, b) => a + b, 0);

  const refresh = useCallback(async () => {
    const res = await fetchModules();
    forgetCapabilities();
    setState({
      loading: false,
      ok: res.ok,
      reason: res.reason || null,
      modules: res.modules || [],
      capabilities: res.capabilities || {},
      installable: !!res.installable,
      moduleRoot: res.moduleRoot || null,
      freeBytes: res.freeBytes ?? null,
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openStore = useCallback((focus = null) => setStore({ open: true, focus }), []);
  const closeStore = useCallback(() => setStore({ open: false, focus: null }), []);

  const value = useMemo(
    () => ({
      ...state, refresh, storeOpen: store.open, storeFocus: store.focus, openStore, closeStore,
      installing, reportInstalling,
    }),
    [state, refresh, store, openStore, closeStore, installing, reportInstalling],
  );
  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

/** Full module state. Safe outside a provider (tests, storybook) — degrades to
 *  "unknown", which every gate treats as ungated. */
export function useModules() {
  return useContext(ModuleContext) || {
    ...EMPTY, refresh: () => {}, storeOpen: false, storeFocus: null,
    openStore: () => {}, closeStore: () => {},
    installing: 0, reportInstalling: () => {},
  };
}

/** Open/close handle for the Module Store overlay. `openStore(id)` scrolls the
 *  store to (and expands) that module. */
export function useModuleStore() {
  const { storeOpen, storeFocus, openStore, closeStore } = useModules();
  return { storeOpen, storeFocus, openStore, closeStore };
}

/**
 * Tri-state capability check.
 *   true  — installed, render the feature
 *   false — manifest says the backing module is absent, show the install prompt
 *   null  — still loading, or the backend is unreachable. NOT the same as
 *           "missing": if the backend is down we cannot know what is installed,
 *           and every panel already surfaces its own "backend unavailable"
 *           message. Showing an Install prompt there would be a lie.
 */
export function useCapability(cap) {
  const { loading, ok, capabilities } = useModules();
  if (loading || ok !== true) return null;
  return !!capabilities[cap];
}

/** lqtpy's features (quality check and Fix, the lesion measures, LQTpy
 *  Analysis): `missing` is true only once the module state says the LQTpy
 *  module (or the SciPy it needs) is absent, never while that is unknown;
 *  `install` opens the module store at it (Install there brings SciPy too). */
export function useLesionEngine() {
  const has = useCapability("lesion-qc");
  const { openStore } = useModuleStore();
  return { missing: has === false, install: () => openStore("lqtpy") };
}

/** The manifest modules whose `unlocks` include `cap`. */
export function useModulesFor(cap) {
  const { modules } = useModules();
  return useMemo(
    () => modules.filter((m) => (m.unlocks || []).includes(cap)),
    [modules, cap],
  );
}

export default ModuleContext;
