import { matchCommands } from "./CommandPalette";

const cmds = [
  { id: "a", title: "View: Axial", group: "Command" },
  { id: "w", title: "Save workspace…", group: "Command" },
  { id: "s", title: "Open Lesion network mapping", group: "Section" },
  { id: "p", title: "Use preset: Reading", group: "Preset" },
];

test("each typed word must start a word of the title or group", () => {
  expect(matchCommands(cmds, "ax").map((c) => c.id)).toEqual(["a"]);
  expect(matchCommands(cmds, "save work").map((c) => c.id)).toEqual(["w"]);
  expect(matchCommands(cmds, "network").map((c) => c.id)).toEqual(["s"]);
  expect(matchCommands(cmds, "preset").map((c) => c.id)).toEqual(["p"]);
  expect(matchCommands(cmds, "xial")).toEqual([]);           // not mid-word
  expect(matchCommands(cmds, "  ")).toHaveLength(4);
});

test("punctuation typed from a title still matches", () => {
  expect(matchCommands(cmds, "preset: reading").map((c) => c.id)).toEqual(["p"]);
  expect(matchCommands(cmds, "View: ax").map((c) => c.id)).toEqual(["a"]);
});
