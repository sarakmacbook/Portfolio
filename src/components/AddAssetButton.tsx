"use client";

import AddAssetDialog, { type AssetFolderChoice, type CashAccount } from "./AddAssetDialog";
import { useDashboardArrange } from "./dashboard-arrange";

/**
 * The dashboard's **+ Add asset** button.
 *
 * It only exists while the dashboard is in "Arrange layout" mode — adding a
 * holding is part of curating the dashboard, so the everyday view stays free
 * of it. The other places that add a holding (the empty first-run state and a
 * holding's own page) keep their own buttons.
 */
export default function AddAssetButton({
  cashAccounts,
  folders,
}: {
  cashAccounts: CashAccount[];
  folders: AssetFolderChoice[];
}) {
  const arrange = useDashboardArrange();
  if (!arrange?.arranging) return null;
  return <AddAssetDialog cashAccounts={cashAccounts} folders={folders} />;
}
