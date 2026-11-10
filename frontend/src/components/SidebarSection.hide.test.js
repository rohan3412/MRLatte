import React from "react";
import { renderToString } from "react-dom/server";
import { writePref } from "@/lib/preferences";
import { SidebarSection } from "@/components/SidebarSection";

// The module status the section sees: set per test.
let mockCapability = false;
jest.mock("@/hooks/use-modules", () => ({
  useCapability: () => mockCapability,
  useModulesFor: () => [],
  useModules: () => ({ modules: [] }),
}));

const render = (props = {}) => renderToString(
  React.createElement(SidebarSection, { title: "Lesion network mapping", testId: "section-lnm", capability: "lnm", ...props }, "body"),
);

beforeEach(() => { localStorage.clear(); mockCapability = false; writePref("hideUnavailableSections", false); });

test("a section whose module is missing is shown greyed out by default", () => {
  const html = render();
  expect(html).toContain('data-testid="section-lnm"');
  expect(html).toContain("data-unavailable");
});

test("with the preference on, that section is left out entirely", () => {
  writePref("hideUnavailableSections", true);
  expect(render()).toBe("");
});

test("with the preference on, a section whose module is installed stays", () => {
  writePref("hideUnavailableSections", true);
  mockCapability = true;
  expect(render()).toContain('data-testid="section-lnm"');
});

test("module status still unknown (null) is never hidden", () => {
  writePref("hideUnavailableSections", true);
  mockCapability = null;
  expect(render()).toContain('data-testid="section-lnm"');
});

test("a section that reports itself unavailable is hidden too", () => {
  writePref("hideUnavailableSections", true);
  expect(render({ capability: undefined, available: false, unavailableHint: "no" })).toBe("");
});
