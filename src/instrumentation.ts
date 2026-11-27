/**
 * Runs once per server process (next start, dev, and each serverless instance).
 *
 * The only job here is installing the outbound proxy from Settings → Proxy at
 * boot, so a cold-started deployment starts proxying before the first price
 * refresh instead of after someone opens the Settings page. A failure — no
 * database yet, settings unreadable — leaves the app on a direct connection.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { applySavedProxy } = await import("@/lib/outbound");
    await applySavedProxy();
  } catch {
    // Nothing to do: requests simply go out directly.
  }
}
