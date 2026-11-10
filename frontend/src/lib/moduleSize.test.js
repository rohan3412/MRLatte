import { moduleSize } from "./modules";

describe("moduleSize", () => {
  test("a user-supplied slot (0 bytes) has no size, not '0 B'", () => {
    expect(moduleSize({ bytes: 0, bytesHuman: "0 B" })).toBe("unknown size");
  });
  test("prefers the server string, falls back to formatting", () => {
    expect(moduleSize({ bytes: 4365601, bytesHuman: "4.2 MB" })).toBe("4.2 MB");
    expect(moduleSize({ bytes: 2048 })).toBe("2.0 KB");
  });
});
