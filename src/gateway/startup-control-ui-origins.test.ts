import { describe, expect, it, vi } from "vitest";
import { maybeSeedControlUiAllowedOriginsAtStartup } from "./startup-control-ui-origins.js";

describe("maybeSeedControlUiAllowedOriginsAtStartup", () => {
  it("seeds Railway public origin before gateway startup validation", async () => {
    const writeConfig = vi.fn(async () => {});
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await maybeSeedControlUiAllowedOriginsAtStartup({
      config: {
        gateway: {
          bind: "lan",
          auth: { mode: "token", token: "tok" },
        },
      },
      writeConfig,
      log,
      env: {
        RAILWAY_PUBLIC_DOMAIN: "openclaw-production-735b.up.railway.app",
      },
    });

    expect(result.persistedAllowedOriginsSeed).toBe(true);
    expect(result.config.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
      "https://openclaw-production-735b.up.railway.app",
    ]);
    expect(writeConfig).toHaveBeenCalledWith(result.config);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("https://openclaw-production-735b.up.railway.app"),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps the in-memory Railway origin when persisting config fails", async () => {
    const writeConfig = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await maybeSeedControlUiAllowedOriginsAtStartup({
      config: {
        gateway: {
          bind: "lan",
          auth: { mode: "token", token: "tok" },
        },
      },
      writeConfig,
      log,
      env: {
        RAILWAY_PUBLIC_DOMAIN: "openclaw-production-735b.up.railway.app",
      },
    });

    expect(result.persistedAllowedOriginsSeed).toBe(false);
    expect(result.config.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
      "https://openclaw-production-735b.up.railway.app",
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("gateway: failed to persist gateway.controlUi.allowedOrigins seed"),
    );
  });
});
