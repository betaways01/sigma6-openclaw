import { describe, expect, it } from "vitest";
import {
  ensureControlUiAllowedOriginsForNonLoopbackBind,
  resolveControlUiAllowedOriginsFromEnv,
} from "./gateway-control-ui-origins.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("resolveControlUiAllowedOriginsFromEnv", () => {
  it("merges explicit env allowlists with Railway public domain", () => {
    expect(
      resolveControlUiAllowedOriginsFromEnv({
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS: '["https://chat.example.com"]',
        OPENCLAW_GATEWAY_ALLOWED_ORIGINS:
          "https://control.example.com, https://chat.example.com\nhttps://ops.example.com",
        RAILWAY_PUBLIC_DOMAIN: "openclaw-production-735b.up.railway.app",
      }),
    ).toEqual([
      "https://chat.example.com",
      "https://control.example.com",
      "https://ops.example.com",
      "https://openclaw-production-735b.up.railway.app",
    ]);
  });

  it("ignores invalid values", () => {
    expect(
      resolveControlUiAllowedOriginsFromEnv({
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS: "not-a-url, https://chat.example.com",
        RAILWAY_PUBLIC_DOMAIN: "   ",
      }),
    ).toEqual(["https://chat.example.com"]);
  });
});

describe("ensureControlUiAllowedOriginsForNonLoopbackBind", () => {
  it("adds deployment origins to the default non-loopback seed", () => {
    const result = ensureControlUiAllowedOriginsForNonLoopbackBind(
      {
        gateway: {
          auth: { mode: "token", token: "tok" },
        },
      } satisfies OpenClawConfig,
      {
        extraAllowedOrigins: ["https://openclaw-production-735b.up.railway.app"],
        isContainerEnvironment: () => true,
      },
    );

    expect(result.bind).toBe("auto");
    expect(result.seededOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
      "https://openclaw-production-735b.up.railway.app",
    ]);
  });

  it("merges deployment origins into an existing allowlist", () => {
    const result = ensureControlUiAllowedOriginsForNonLoopbackBind(
      {
        gateway: {
          bind: "lan",
          auth: { mode: "token", token: "tok" },
          controlUi: {
            allowedOrigins: ["https://control.example.com"],
          },
        },
      } satisfies OpenClawConfig,
      {
        extraAllowedOrigins: ["https://openclaw-production-735b.up.railway.app"],
      },
    );

    expect(result.bind).toBe("lan");
    expect(result.seededOrigins).toEqual([
      "https://control.example.com",
      "https://openclaw-production-735b.up.railway.app",
    ]);
  });

  it("keeps existing allowlists unchanged when they already include deployment origins", () => {
    const result = ensureControlUiAllowedOriginsForNonLoopbackBind(
      {
        gateway: {
          bind: "lan",
          auth: { mode: "token", token: "tok" },
          controlUi: {
            allowedOrigins: [
              "https://control.example.com",
              "https://openclaw-production-735b.up.railway.app",
            ],
          },
        },
      } satisfies OpenClawConfig,
      {
        extraAllowedOrigins: ["https://openclaw-production-735b.up.railway.app"],
      },
    );

    expect(result.seededOrigins).toBeNull();
    expect(result.config).toEqual({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
        controlUi: {
          allowedOrigins: [
            "https://control.example.com",
            "https://openclaw-production-735b.up.railway.app",
          ],
        },
      },
    });
  });

  it("persists explicit deployment origins even when host-header fallback was previously enabled", () => {
    const result = ensureControlUiAllowedOriginsForNonLoopbackBind(
      {
        gateway: {
          auth: { mode: "token", token: "tok" },
          controlUi: {
            dangerouslyAllowHostHeaderOriginFallback: true,
          },
        },
      } satisfies OpenClawConfig,
      {
        extraAllowedOrigins: ["https://openclaw-production-735b.up.railway.app"],
        isContainerEnvironment: () => true,
      },
    );

    expect(result.bind).toBe("auto");
    expect(result.seededOrigins).toEqual(["https://openclaw-production-735b.up.railway.app"]);
    expect(result.config.gateway?.controlUi).toEqual({
      dangerouslyAllowHostHeaderOriginFallback: true,
      allowedOrigins: ["https://openclaw-production-735b.up.railway.app"],
    });
  });
});
