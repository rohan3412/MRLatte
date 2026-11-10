import { requiredFirst, installModule, waitForModuleJob } from "./modules";

const all = [
  { id: "python-scipy", name: "SciPy", bytes: 40e6 },
  { id: "lqtpy", name: "LQTpy", bytes: 2e6, missingRequires: ["python-scipy"] },
  { id: "top", name: "Top", missingRequires: ["python-scipy", "gone"] },
];

test("requiredFirst lists the modules to install first, in order, and skips unknown ids", () => {
  expect(requiredFirst(all[1], all).map((m) => m.id)).toEqual(["python-scipy"]);
  expect(requiredFirst(all[2], all).map((m) => m.id)).toEqual(["python-scipy"]);
  expect(requiredFirst(all[0], all)).toEqual([]);
});

afterEach(() => { delete global.fetch; });

test("a refused install surfaces the backend's sentence, not its error code", async () => {
  global.fetch = jest.fn(async () => ({
    ok: false, status: 409,
    text: async () => JSON.stringify({ detail: { error: "requires", requires: ["python-scipy"],
      message: "LQTpy needs SciPy first. Install it, then try again." } }),
  }));
  const res = await installModule("lqtpy");
  expect(res.ok).toBe(false);
  expect(res.error).toBe("LQTpy needs SciPy first. Install it, then try again.");
});

test("waitForModuleJob polls until the job is done and returns it", async () => {
  const answers = [{ stage: "downloading", done: false }, { stage: "installing", done: false }, { stage: "done", done: true }];
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(answers.shift()) }));
  const job = await waitForModuleJob("j1", { intervalMs: 1 });
  expect(job.done).toBe(true);
  expect(job.error).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test("waitForModuleJob reports an error the job ended with", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ stage: "error", done: true, error: "sha256 mismatch" }) }));
  const job = await waitForModuleJob("j2", { intervalMs: 1 });
  expect(job.error).toBe("sha256 mismatch");
});

test("waitForModuleJob gives up on an unreachable backend instead of polling for ever", async () => {
  global.fetch = jest.fn(async () => { throw new Error("offline"); });
  const job = await waitForModuleJob("j3", { intervalMs: 1, maxFailures: 3 });
  expect(job.done).toBe(true);
  expect(job.error).toMatch(/offline/);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test("toInstallFor names what is missing: the module itself, or what an installed one needs", async () => {
  const { toInstallFor } = await import("./modules");
  const scipy = { id: "python-scipy", name: "SciPy", installed: false };
  const dipy = { id: "tract-dissection-dipy", installed: true, missingRequires: ["python-scipy"] };
  const slot = { id: "tractography-whole-brain", installed: false, missingRequires: [] };
  const everything = [scipy, dipy, slot];
  expect(toInstallFor([dipy, slot], everything).map((m) => m.id)).toEqual(["python-scipy", "tractography-whole-brain"]);
  expect(toInstallFor([dipy], everything).map((m) => m.id)).toEqual(["python-scipy"]);
  expect(toInstallFor([{ ...dipy, missingRequires: [] }], everything)).toEqual([]);
  // Two candidates needing the same module name it once.
  expect(toInstallFor([dipy, { ...dipy, id: "other" }], everything).map((m) => m.id)).toEqual(["python-scipy"]);
});
