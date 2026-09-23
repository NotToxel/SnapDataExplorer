import { describe, it, expect, vi } from "vitest";
import { APP_VERSION, getAppVersion, useAppVersion } from "./version";
import packageJson from "../../package.json";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.0.2")),
}));

describe("version module", () => {
  it("APP_VERSION strictly matches package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("getAppVersion resolves to Tauri version when available", async () => {
    const v = await getAppVersion();
    expect(v).toBe("1.0.2");
  });

  it("useAppVersion initializes to APP_VERSION immediately", () => {
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe(packageJson.version);
  });

  it("useAppVersion updates if getVersion resolves to another version", async () => {
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => {
      expect(result.current).toBe("1.0.2");
    });
  });
});
