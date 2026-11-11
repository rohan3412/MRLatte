// Drawing without a GPU. On a machine with no graphics acceleration (a virtual
// machine, a remote-desktop session, Linux without GPU drivers, GitHub's Intel
// Mac runners) WebGL falls back to a software renderer that draws on the
// processor. The 3D view's ray casting then takes seconds per frame (Apple's
// software renderer: minutes; 11 Nov, sampled on the Intel Mac runner), and
// every animated effect queues dozens of such frames, so the window stops
// answering. Detected once from WebGL's renderer name; the viewer then draws
// the 3D view with fewer samples and the effects stay off (effects.js).

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software rasterizer|software renderer|basic render driver|gdi generic/i;

// How much coarser the 3D view's ray-march steps are on a software renderer,
// also when still (interactiveQuality.js uses the same uniform while moving).
export const SOFTWARE_STEP_SCALE = 2;

/** Whether a WebGL renderer name is a software renderer. */
export function isSoftwareRendererName(name) {
  return typeof name === "string" && SOFTWARE.test(name);
}

/** The renderer's name: the unmasked one when the browser offers it. */
export function rendererName(gl) {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch (_e) {
    return "";
  }
}

let software = false;

/** Whether this window draws in software (set by noteRenderer). */
export const softwareGL = () => software;

/** Look at `gl`'s renderer once; returns { name, software }. */
export function noteRenderer(gl) {
  const name = gl ? rendererName(gl) : "";
  software = isSoftwareRendererName(name);
  return { name, software };
}
