import { useEffect, useState } from "react";
import { getCapabilities, hasFeature } from "@/lib/lesionMetrics";

/**
 * Whether the installed lqtpy lists `name` in its capabilities (lqtpy 0.8.0+:
 * "qc.fix_plan", "compare", ...). False until known, and on an older lqtpy.
 * Capabilities are cached; `refreshKey` changing asks again (a module install).
 */
export function useLqtpyFeature(name, refreshKey) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    getCapabilities().then((caps) => { if (live) setOk(hasFeature(caps, name)); }).catch(() => {});
    return () => { live = false; };
  }, [name, refreshKey]);
  return ok;
}
