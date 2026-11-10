import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ModuleProvider, useModules } from "./use-modules";
import { useModuleActions } from "@/components/ModuleStore";
import { fetchModules } from "@/lib/modules";

jest.mock("@/lib/modules", () => ({
  ...jest.requireActual("@/lib/modules"),
  fetchModules: jest.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The toolbar's store icon turns while a module installs (inbox 29 Oct). Each
// useModuleActions instance (the store, the Atlas Manager) reports its running
// installs; the provider adds them up.
describe("installing count", () => {
  let root;
  let store;
  let manager;
  let installing;
  function Probe() {
    store = useModuleActions();
    manager = useModuleActions();
    installing = useModules().installing;
    return null;
  }
  beforeEach(async () => {
    fetchModules.mockResolvedValue({ ok: true, modules: [], capabilities: {} });
    root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<ModuleProvider><Probe /></ModuleProvider>); });
  });
  afterEach(() => act(() => root.unmount()));

  test("counts running installs from every reporter, and only installs", async () => {
    expect(installing).toBe(0);
    await act(async () => { store.setJob("aal", { phase: "install", done: false }); });
    expect(installing).toBe(1);
    await act(async () => { manager.setJob("benson", { phase: "repair", done: false }); });
    expect(installing).toBe(2);
    await act(async () => { store.setJob("dipy", { phase: "verify", done: false }); });
    await act(async () => { store.setJob("simpleitk", { phase: "uninstall", done: false }); });
    expect(installing).toBe(2);
  });

  test("a finished or cleared install stops counting", async () => {
    await act(async () => { store.setJob("aal", { phase: "sideload", done: false }); });
    expect(installing).toBe(1);
    await act(async () => { store.setJob("aal", { done: true }); });
    expect(installing).toBe(0);
    await act(async () => { manager.setJob("benson", { phase: "copy", done: false }); });
    await act(async () => { manager.clearJob("benson"); });
    expect(installing).toBe(0);
  });
});
