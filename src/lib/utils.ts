import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { convertFileSrc } from "@tauri-apps/api/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely converts a file system path to a Tauri asset URL.
 * Handles Windows UNC prefixes (\\?\), normalizes paths, and returns
 * existing web/data/blob/asset URLs as-is. Works across macOS, Linux, and Windows.
 */
export function safeConvertFileSrc(filePath?: string | null): string | undefined {
  if (!filePath) return undefined;

  // Already a valid web/asset/data/blob URL
  if (
    filePath.startsWith("http://") ||
    filePath.startsWith("https://") ||
    filePath.startsWith("data:") ||
    filePath.startsWith("blob:") ||
    filePath.startsWith("asset:")
  ) {
    return filePath;
  }

  // Strip Windows extended-length UNC prefix (\\?\) which breaks Tauri's asset URL mapping
  const cleaned = filePath.replace(/^\\\\\?\\/, "");

  try {
    return convertFileSrc(cleaned);
  } catch {
    return cleaned;
  }
}
