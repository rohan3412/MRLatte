import { DEFAULT_PREFS, readPrefs, writePref, getPref, subscribePrefs } from "./preferences";

beforeEach(() => { localStorage.clear(); readPrefs(); });

test("defaults when nothing is stored", () => {
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
  expect(getPref("hideUnavailableSections")).toBe(false);
});

test("a stored value is read back and unknown keys are ignored", () => {
  localStorage.setItem("mrlatte-prefs", JSON.stringify({ hideUnavailableSections: true, bogus: 1 }));
  expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, hideUnavailableSections: true });
});

test("corrupt or wrongly typed storage falls back to the defaults", () => {
  localStorage.setItem("mrlatte-prefs", "{not json");
  expect(readPrefs()).toEqual(DEFAULT_PREFS);
  localStorage.setItem("mrlatte-prefs", JSON.stringify({ hideUnavailableSections: "yes" }));
  expect(getPref("hideUnavailableSections")).toBe(false);
});

test("writePref persists and notifies subscribers", () => {
  const seen = [];
  const off = subscribePrefs(() => seen.push(getPref("hideUnavailableSections")));
  writePref("hideUnavailableSections", true);
  expect(JSON.parse(localStorage.getItem("mrlatte-prefs"))).toEqual({ hideUnavailableSections: true });
  expect(seen).toEqual([true]);
  off();
  writePref("hideUnavailableSections", false);
  expect(seen).toEqual([true]);
});

test("writePref ignores a key that is not a preference", () => {
  writePref("bogus", true);
  expect(localStorage.getItem("mrlatte-prefs")).toBeNull();
});

test("start-up preferences have the app's own defaults", () => {
  expect(readPrefs()).toMatchObject({
    startRadiological: true, startLayout: "multiplanar", startWhiteBackground: false,
    startCrosshair: true, crosshairColor: "white", crosshairWidth: 1,
    idleQc: true, idleQcSeconds: 30,
  });
});

test("a choice outside its list, or a number outside its range, falls back to the default", () => {
  localStorage.setItem("mrlatte-prefs", JSON.stringify({
    startLayout: "hologram", crosshairColor: "plaid", crosshairWidth: 9, idleQcSeconds: 2,
  }));
  expect(readPrefs()).toMatchObject({ startLayout: "multiplanar", crosshairColor: "white", crosshairWidth: 1, idleQcSeconds: 30 });
  localStorage.setItem("mrlatte-prefs", JSON.stringify({ startLayout: "mosaic", crosshairColor: "cyan", crosshairWidth: 3, idleQcSeconds: 120 }));
  expect(readPrefs()).toMatchObject({ startLayout: "mosaic", crosshairColor: "cyan", crosshairWidth: 3, idleQcSeconds: 120 });
});

test("writePref refuses a value its choices or range don't allow", () => {
  writePref("startLayout", "hologram");
  writePref("crosshairWidth", 0);
  writePref("crosshairWidth", 2.5);
  expect(getPref("startLayout")).toBe("multiplanar");
  expect(getPref("crosshairWidth")).toBe(1);
});
