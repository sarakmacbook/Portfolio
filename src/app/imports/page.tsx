import DatabaseSetup from "@/components/DatabaseSetup";
import CustomApiImport from "@/components/CustomApiImport";
import { isDatabaseConfigured } from "@/db";
import { getCustomApiImportConfig, publicCustomApiImportConfig } from "@/lib/custom-import-storage";
import { loadHoldingsFolders } from "@/lib/dashboard-order-db";
import type { CustomApiImportPublicConfig } from "@/lib/custom-import-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ImportsPage() {
  if (!isDatabaseConfigured()) return <DatabaseSetup />;

  let initialConfig: CustomApiImportPublicConfig | null = null;
  let loadError = "";
  // Root group names for the name-the-group step before an import. A failing
  // folder read must not block importing, so it only leaves the list empty.
  let existingGroups: string[] = [];
  try {
    existingGroups = (await loadHoldingsFolders())
      .filter((folder) => !folder.parentAssetId)
      .map((folder) => folder.name);
  } catch {
    existingGroups = [];
  }
  try {
    const stored = await getCustomApiImportConfig();
    initialConfig = stored ? publicCustomApiImportConfig(stored) : null;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "The saved API connection could not be loaded.";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600">Portfolio imports</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Custom API imports</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Import wallet balances from Nansen or another HTTPS JSON API. Choose the endpoint, authentication header,
            and field mapping, review the results, then name a group for the import — or skip the group and add
            the holdings as plain rows.
          </p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
          Read-only · preview first
        </span>
      </div>

      <CustomApiImport
        initialConfig={initialConfig}
        loadError={loadError}
        existingGroups={existingGroups}
      />
    </div>
  );
}
