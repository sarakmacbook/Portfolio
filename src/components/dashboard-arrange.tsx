"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the dashboard is in "Arrange layout" mode.
 *
 * The flag lives in a context above the whole dashboard — not inside
 * `DashboardLayout` — so the page header can react to it as well: the
 * **+ Add asset** button only exists while arranging. The layout itself still
 * owns everything that is being arranged (the card order, the stat cards, the
 * category tabs, the holdings and the folders); this is only the on/off switch.
 */
export type DashboardArrangeState = {
  /** True while the dashboard is in "Arrange layout" mode. */
  arranging: boolean;
  /** Enters or leaves "Arrange layout" mode. */
  setArranging: (arranging: boolean) => void;
};

const DashboardArrangeContext = createContext<DashboardArrangeState | null>(null);

export function DashboardArrangeProvider({ children }: { children: ReactNode }) {
  const [arranging, setArranging] = useState(false);
  const value = useMemo(() => ({ arranging, setArranging }), [arranging]);
  return <DashboardArrangeContext.Provider value={value}>{children}</DashboardArrangeContext.Provider>;
}

/** `null` outside the dashboard, where there is no layout to arrange. */
export function useDashboardArrange(): DashboardArrangeState | null {
  return useContext(DashboardArrangeContext);
}
