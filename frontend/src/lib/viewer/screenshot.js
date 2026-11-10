import { getPref } from "@/lib/preferences";
/**
 * Save a PNG of the scene.
 *
 * Backs the saveScreenshot entry of NiivueViewer's imperative handle. Method
 * name, signature and behaviour are unchanged — this is a relocation.
 *
 * @param {object} ctx  viewer context (see lib/viewer/context.js); uses
 *                      nvRef, canvasRef.
 * @param {function} [ensureStill]  ends any reduced-quality 3D interaction so
 *                      the capture is full quality; called before every readback.
 */
export function createScreenshotApi(ctx, ensureStill) {
  const { nvRef, canvasRef } = ctx;

  return {
    // Save a PNG of the scene. The GL canvas already contains the colorbar and
    // orientation labels (they're drawn into it), so those come for free. When
    // a `caption` is given, composite the canvas onto a slightly taller 2D
    // canvas with a caption bar (scan label + timestamp) for report/slide use;
    // otherwise fall back to NiiVue's native saveScene.
    // A small JPEG of the view, for the home screen's recent scans.
    getThumbnail: (width = 200) => {
      const nv = nvRef.current;
      const src = canvasRef.current;
      if (!nv || !src?.width) return null;
      try {
        ensureStill?.();
        nv.drawScene();
        const out = document.createElement("canvas");
        out.width = width;
        out.height = Math.round((src.height / src.width) * width);
        out.getContext("2d").drawImage(src, 0, 0, out.width, out.height);
        return out.toDataURL("image/jpeg", 0.72);
      } catch (_e) {
        return null;
      }
    },

    saveScreenshot: (opts = {}) => {
      const nv = nvRef.current;
      if (!nv) return;
      ensureStill?.();
      const caption = opts.caption;
      if (!caption) { nv.saveScene("mrlatte-scene.png"); return; }
      try {
        nv.drawScene(); // ensure the backing buffer is current for readback
        const src = canvasRef.current;
        if (!src) { nv.saveScene("mrlatte-scene.png"); return; }
        const capH = Math.max(30, Math.round(src.height * 0.05));
        const out = document.createElement("canvas");
        out.width = src.width;
        out.height = src.height + capH;
        const ctx = out.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(src, 0, 0);            // GL canvas (same synchronous frame)
        ctx.fillStyle = "#111";
        ctx.fillRect(0, src.height, out.width, capH);
        const fontPx = Math.round(capH * 0.42);
        ctx.font = `${fontPx}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#e5e5e5";
        ctx.textAlign = "left";
        ctx.fillText(String(caption).slice(0, 80), 14, src.height + capH / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#a1a1a1";
        ctx.fillText(new Date().toLocaleString(), out.width - 14, src.height + capH / 2);
        // The corner thumbnail (opts.onSaved): a small copy, as a data URL so
        // there is no object URL to revoke when the toast goes.
        const tw = 240;
        const th = Math.round((out.height / out.width) * tw);
        const small = document.createElement("canvas");
        small.width = tw;
        small.height = th;
        small.getContext("2d").drawImage(out, 0, 0, tw, th);
        const thumb = small.toDataURL("image/png");
        out.toBlob(async (blob) => {
          if (!blob) { nv.saveScene("mrlatte-scene.png"); return; }
          // Desktop app: straight to Pictures/MRLatte, no dialog (electron.js),
          // unless Preferences ▸ General says to ask where.
          if (window.mrlatte?.saveScreenshot) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(",")[1]);
                r.onerror = reject;
                r.readAsDataURL(blob);
              });
              if (getPref("screenshotAsk") && window.mrlatte.saveFile) {
                const r = await window.mrlatte.saveFile("mrlatte-scene.png", "image/png", b64);
                if (!r?.canceled) opts.onSaved?.({ thumb, filePath: null, savedAs: r.filePath });
                return;
              }
              const { filePath } = await window.mrlatte.saveScreenshot(b64);
              opts.onSaved?.({ thumb, filePath });
              return;
            } catch (_e) { /* fall back to the download below */ }
          }
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement("a");
            a.href = url;
            a.download = "mrlatte-scene.png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } finally {
            URL.revokeObjectURL(url);
          }
          opts.onSaved?.({ thumb, filePath: null });
        }, "image/png");
      } catch (_e) {
        nv.saveScene("mrlatte-scene.png");
      }
    },
  };
}
