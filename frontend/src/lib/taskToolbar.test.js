import { suggestedTask, resolveToolMode, nextChoice } from "./taskToolbar";

describe("suggestedTask", () => {
  test("drawing wins, then a selected lesion or activation layer", () => {
    expect(suggestedTask({ drawingActive: true, inspectedKind: "lesion" })).toBe("tracing");
    expect(suggestedTask({ drawingActive: false, inspectedKind: "lesion" })).toBe("analysing");
    expect(suggestedTask({ drawingActive: false, inspectedKind: "activation" })).toBe("analysing");
    expect(suggestedTask({ drawingActive: false, inspectedKind: "atlas" })).toBeNull();
    expect(suggestedTask({})).toBeNull();
  });
});

describe("resolveToolMode", () => {
  test("off means Viewing, whatever else is set", () => {
    expect(resolveToolMode({ enabled: false, chosen: "tracing", auto: "tracing", suggested: "tracing" })).toBe("viewing");
  });
  test("an automatic task holds while it applies, and ends with it", () => {
    expect(resolveToolMode({ enabled: true, chosen: "viewing", auto: "tracing", suggested: "tracing" })).toBe("tracing");
    expect(resolveToolMode({ enabled: true, chosen: "viewing", auto: "tracing", suggested: null })).toBe("viewing");
  });
  test("Viewing chosen stays Viewing; a task chosen needs its task", () => {
    expect(resolveToolMode({ enabled: true, chosen: "viewing", auto: null, suggested: "analysing" })).toBe("viewing");
    expect(resolveToolMode({ enabled: true, chosen: "analysing", auto: null, suggested: "analysing" })).toBe("analysing");
    expect(resolveToolMode({ enabled: true, chosen: "analysing", auto: null, suggested: null })).toBe("viewing");
  });
});

describe("nextChoice", () => {
  test("toggles between Viewing and the task that applies", () => {
    expect(nextChoice("viewing", "tracing")).toEqual({ chosen: "tracing", auto: null });
    expect(nextChoice("viewing", null)).toBeNull();
    expect(nextChoice("tracing", "tracing")).toEqual({ chosen: "viewing", auto: null });
  });
});
