/**
 * Files already-created holdings into a group from the shared group dialog.
 *
 * Used by the API import (rows created moments earlier) and the exchange sync
 * (holdings that already existed) so both flows create, reuse and file the same
 * way: a root group matched by name, a fresh one otherwise, and every chosen
 * asset filed into it in a single write.
 */
import {
  loadHoldingFolderAssignments,
  loadHoldingsFolders,
  saveHoldingFolderAssignments,
  saveHoldingsFolders,
} from "@/lib/dashboard-order-db";
import { groupRoomNote, type RequestedGroup } from "@/lib/holdings-group";
import { folderForImport } from "@/lib/holdings-folders";

export type FiledGroup = { id: string; name: string; filed: number };

export type FileGroupOutcome =
  | { group: FiledGroup; note?: undefined }
  | { group?: undefined; note: string };

/**
 * Creates or reuses the named group and files `assetIds` into it.
 *
 * `note` explains why nothing was filed — no rows, or no room for another group
 * (`MAX_FOLDERS`) — instead of failing the import or sync that already
 * succeeded.
 */
export async function fileHoldingsIntoGroup(
  request: Pick<RequestedGroup, "name" | "icon">,
  assetIds: readonly number[],
): Promise<FileGroupOutcome> {
  const ids = [...new Set(assetIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) {
    return { note: " No holdings were ticked for the group, so they were left ungrouped." };
  }

  const folders = await loadHoldingsFolders();
  const result = folderForImport(folders, request.name, {
    rootOnly: true,
    ...(request.icon ?? {}),
  });
  if (!result.folder) return { note: groupRoomNote(folders.length) };

  if (result.folders.length !== folders.length) await saveHoldingsFolders(result.folders);
  const current = await loadHoldingFolderAssignments(result.folders);
  const next = { ...current };
  for (const id of ids) next[id] = result.folder.id;
  await saveHoldingFolderAssignments(next, result.folders);

  return { group: { id: result.folder.id, name: result.folder.name, filed: ids.length } };
}
