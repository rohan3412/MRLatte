import { createContext } from "react";

// The inspector panel (Preferences ▸ Sidebar, on by default for now; owner,
// 5 Nov): { enabled, selectedId, select(id|null), target } from Dashboard.
// LayerControlAdvanced reads it: with it enabled the sidebar shows one line per
// layer and the selected layer's full card is portalled into `target`, the
// panel on the right. Null outside a provider = the inline cards as before.
export const InspectorContext = createContext(null);
