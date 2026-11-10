import { firstRunSteps } from "./FirstRun";

test("a first install sees What's New, then the preset and look questions", () => {
  expect(firstRunSteps({ done: false, seenVersion: "", version: "0.6.0" })).toEqual(["whatsNew", "preset", "look"]);
});
test("an update shows only that version's What's New, once", () => {
  expect(firstRunSteps({ done: true, seenVersion: "0.5.0", version: "0.6.0" })).toEqual(["whatsNew"]);
  expect(firstRunSteps({ done: true, seenVersion: "0.6.0", version: "0.6.0" })).toEqual([]);
});
test("without a version (a dev build) only the questionnaire can show", () => {
  expect(firstRunSteps({ done: false, seenVersion: "", version: "" })).toEqual(["preset", "look"]);
});
