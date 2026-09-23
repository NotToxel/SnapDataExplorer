import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import packageJson from "../../package.json";

/**
 * Build-time application version sourced directly from package.json.
 * This guarantees the version is always in sync with package.json without any hardcoded strings.
 */
export const APP_VERSION: string = packageJson.version;

/**
 * Returns the application version string.
 * First queries Tauri's runtime getVersion() (from tauri.conf.json / Cargo.toml),
 * and falls back gracefully to package.json's version if running in mock/web mode or if Tauri fails.
 */
export async function getAppVersion(): Promise<string> {
  try {
    const v = await getVersion();
    if (v) {
      return v;
    }
  } catch {
    // Ignore runtime Tauri API failure (e.g. running in browser/web mode)
  }
  return APP_VERSION;
}

/**
 * React hook that returns the application version string.
 * Pre-initialized to APP_VERSION synchronously so there is never an empty state or layout shift,
 * and updates with the runtime Tauri version when available.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(APP_VERSION);

  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => {});
  }, []);

  return version;
}
