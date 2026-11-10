import { dicomProgressView, formatMB } from "./dicomProgress";

const states = (v) => v.steps.map((s) => s.state).join(" ");

describe("DICOM import progress", () => {
  test("upload shows bytes, files and a real percentage", () => {
    const v = dicomProgressView({ stage: "upload", loaded: 78e6, total: 312e6, files: 1204 });
    expect(v.title).toBe("Uploading");
    expect(v.detail).toBe("78.0 MB of 312 MB · 1,204 files");
    expect(v.right).toBe("25%");
    expect(states(v)).toBe("active todo todo todo");
    expect(v.steps[0].fraction).toBeCloseTo(0.25);
  });

  test("conversion has no percentage, so it counts the seconds", () => {
    const v = dicomProgressView({ stage: "convert", files: 1204, since: 1000 }, 15_500);
    expect(v.title).toBe("Converting");
    expect(v.detail).toBe("dcm2niix is converting 1,204 files");
    expect(v.right).toBe("14 s");
    expect(states(v)).toBe("done active todo todo");
    expect(v.steps[1].fraction).toBeNull();
  });

  test("download without a known size shows what has arrived", () => {
    const v = dicomProgressView({ stage: "download", loaded: 4.2e6 });
    expect(v.detail).toBe("4.20 MB");
    expect(v.right).toBeNull();
    expect(v.steps[2].fraction).toBeNull();
  });

  test("opening comes last", () => {
    const v = dicomProgressView({ stage: "open", since: 0 }, 2_000);
    expect(states(v)).toBe("done done done active");
    expect(v.right).toBe("2 s");
    expect(v.step).toBe(4);
  });

  test("sizes", () => {
    expect(formatMB(1.234e6)).toBe("1.23 MB");
    expect(formatMB(12.34e6)).toBe("12.3 MB");
    expect(formatMB(512e6)).toBe("512 MB");
  });
});
