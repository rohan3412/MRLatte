import { isSoftwareRendererName, noteRenderer, softwareGL } from "./softwareGL";

test("software renderers are recognised, as Chromium names them", () => {
  for (const name of [
    "ANGLE (Apple, Apple Software Renderer, OpenGL 4.1)",
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)",
    "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
    "Mesa softpipe",
  ]) expect(isSoftwareRendererName(name)).toBe(true);
});

test("real GPUs are not", () => {
  for (const name of [
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)",
    "",
  ]) expect(isSoftwareRendererName(name)).toBe(false);
  expect(isSoftwareRendererName(undefined)).toBe(false);
});

test("noteRenderer reads the unmasked name and remembers the answer", () => {
  const gl = (name) => ({
    RENDERER: 1,
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }),
    getParameter: (p) => (p === 2 ? name : "WebKit WebGL"),
  });
  expect(noteRenderer(gl("ANGLE (Apple, Apple Software Renderer, OpenGL 4.1)"))).toEqual({
    name: "ANGLE (Apple, Apple Software Renderer, OpenGL 4.1)", software: true,
  });
  expect(softwareGL()).toBe(true);
  expect(noteRenderer(gl("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)")).software).toBe(false);
  expect(softwareGL()).toBe(false);
});
