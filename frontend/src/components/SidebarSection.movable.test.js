import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { writePref } from "@/lib/preferences";
import { SidebarSection } from "@/components/SidebarSection";

jest.mock("@/hooks/use-modules", () => ({
  useCapability: () => true,
  useModulesFor: () => [],
  useModules: () => ({ modules: [] }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let mounts;
function Probe() {
  React.useEffect(() => { mounts += 1; }, []);
  return <span data-testid="probe">content</span>;
}
const draw = () => act(() => {
  root.render(<nav aria-label="Sections"><SidebarSection title="Lesion masks" testId="section-lesion"><Probe /></SidebarSection></nav>);
});

beforeEach(() => {
  localStorage.clear();
  mounts = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test("off by default: no grip, content inline", () => {
  draw();
  expect(document.querySelector('[data-testid="panel-grip-section-lesion"]')).toBeNull();
  expect(host.querySelector('[data-testid="probe"]')).not.toBeNull();
});

test("with movable panels on, the row has a grip and the content shows once", () => {
  writePref("movablePanels", true);
  draw();
  expect(document.querySelector('[data-testid="panel-grip-section-lesion"]')).not.toBeNull();
  expect(document.querySelectorAll('[data-testid="probe"]')).toHaveLength(1);
});

test("floating moves the content into a card without remounting it, and docking back returns it", () => {
  writePref("movablePanels", true);
  draw();
  expect(mounts).toBe(1);
  act(() => writePref("panelLayouts", { default: { "section-lesion": { dock: "float", x: 50, y: 80 } } }));
  const card = document.querySelector('[data-testid="floating-section-lesion"]');
  expect(card).not.toBeNull();
  expect(card.querySelector('[data-testid="probe"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="probe"]')).toBeNull();
  expect(mounts).toBe(1);
  act(() => card.querySelector('[data-testid="dock-back-section-lesion"]').click());
  expect(document.querySelector('[data-testid="floating-section-lesion"]')).toBeNull();
  expect(host.querySelector('[data-testid="probe"]')).not.toBeNull();
  expect(mounts).toBe(1);
});
