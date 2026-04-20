import { normalizeOptionalString } from "../shared/string-coerce.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";
import type { OpenClawConfig } from "./types.openclaw.js";

export type GatewayNonLoopbackBindMode = "lan" | "tailnet" | "custom" | "auto";

const CONTROL_UI_ALLOWED_ORIGINS_ENV_KEYS = [
  "OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS",
  "OPENCLAW_GATEWAY_ALLOWED_ORIGINS",
] as const;

export function isGatewayNonLoopbackBindMode(bind: unknown): bind is GatewayNonLoopbackBindMode {
  return bind === "lan" || bind === "tailnet" || bind === "custom" || bind === "auto";
}

export function hasConfiguredControlUiAllowedOrigins(params: {
  allowedOrigins: unknown;
  dangerouslyAllowHostHeaderOriginFallback: unknown;
}): boolean {
  if (params.dangerouslyAllowHostHeaderOriginFallback === true) {
    return true;
  }
  return (
    Array.isArray(params.allowedOrigins) &&
    params.allowedOrigins.some((origin) => typeof origin === "string" && origin.trim().length > 0)
  );
}

export function resolveGatewayPortWithDefault(
  port: unknown,
  fallback = DEFAULT_GATEWAY_PORT,
): number {
  return typeof port === "number" && port > 0 ? port : fallback;
}

export function buildDefaultControlUiAllowedOrigins(params: {
  port: number;
  bind: unknown;
  customBindHost?: string;
}): string[] {
  const origins = new Set<string>([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
  ]);
  const customBindHost = params.customBindHost?.trim();
  if (params.bind === "custom" && customBindHost) {
    origins.add(`http://${customBindHost}:${params.port}`);
  }
  return [...origins];
}

function normalizeControlUiOrigin(origin: unknown): string | undefined {
  const normalized = normalizeOptionalString(origin);
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (!url.origin || url.origin === "null") {
      return undefined;
    }
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function appendNormalizedControlUiOrigins(
  target: string[],
  seen: Set<string>,
  origins: Iterable<unknown>,
): void {
  for (const origin of origins) {
    const normalized = normalizeControlUiOrigin(origin);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    target.push(normalized);
  }
}

function normalizeConfiguredControlUiOrigins(origins: unknown): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(origins)) {
    return normalized;
  }
  appendNormalizedControlUiOrigins(normalized, seen, origins);
  return normalized;
}

function parseAllowedOriginsEnvValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const parsedArray =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? (() => {
          try {
            return JSON.parse(trimmed);
          } catch {
            return null;
          }
        })()
      : null;
  if (Array.isArray(parsedArray)) {
    return normalizeConfiguredControlUiOrigins(parsedArray);
  }

  return normalizeConfiguredControlUiOrigins(trimmed.split(/[\n,]/));
}

function mergeControlUiOrigins(...lists: ReadonlyArray<unknown[]>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    appendNormalizedControlUiOrigins(merged, seen, list);
  }
  return merged;
}

export function resolveControlUiAllowedOriginsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const envOrigins = CONTROL_UI_ALLOWED_ORIGINS_ENV_KEYS.flatMap((key) =>
    parseAllowedOriginsEnvValue(env[key] ?? ""),
  );

  const railwayPublicDomain = normalizeOptionalString(env.RAILWAY_PUBLIC_DOMAIN);
  const railwayOrigin = railwayPublicDomain
    ? normalizeControlUiOrigin(
        railwayPublicDomain.includes("://")
          ? railwayPublicDomain
          : `https://${railwayPublicDomain}`,
      )
    : undefined;

  return mergeControlUiOrigins(envOrigins, railwayOrigin ? [railwayOrigin] : []);
}

export function ensureControlUiAllowedOriginsForNonLoopbackBind(
  config: OpenClawConfig,
  opts?: {
    defaultPort?: number;
    requireControlUiEnabled?: boolean;
    extraAllowedOrigins?: string[];
    /** Optional container-detection callback.  When provided and `gateway.bind`
     *  is unset, the function is called to determine whether the runtime will
     *  default to `"auto"` (container) so that origins can be seeded
     *  proactively.  Keeping this as an injected callback avoids a hard
     *  dependency from the config layer on the gateway runtime layer. */
    isContainerEnvironment?: () => boolean;
  },
): {
  config: OpenClawConfig;
  seededOrigins: string[] | null;
  bind: GatewayNonLoopbackBindMode | null;
} {
  const bind = config.gateway?.bind;
  // When bind is unset (undefined) and we are inside a container, the runtime
  // will default to "auto" → 0.0.0.0 via defaultGatewayBindMode().  We must
  // seed origins *before* resolveGatewayRuntimeConfig runs, otherwise the
  // non-loopback Control UI origin check will hard-fail on startup.
  const effectiveBind: typeof bind =
    bind ?? (opts?.isContainerEnvironment?.() ? "auto" : undefined);
  if (!isGatewayNonLoopbackBindMode(effectiveBind)) {
    return { config, seededOrigins: null, bind: null };
  }
  if (opts?.requireControlUiEnabled && config.gateway?.controlUi?.enabled === false) {
    return { config, seededOrigins: null, bind: effectiveBind };
  }
  const currentAllowedOrigins = normalizeConfiguredControlUiOrigins(
    config.gateway?.controlUi?.allowedOrigins,
  );
  const extraAllowedOrigins = normalizeConfiguredControlUiOrigins(opts?.extraAllowedOrigins);
  const hasConfiguredOriginPolicy = hasConfiguredControlUiAllowedOrigins({
    allowedOrigins: config.gateway?.controlUi?.allowedOrigins,
    dangerouslyAllowHostHeaderOriginFallback:
      config.gateway?.controlUi?.dangerouslyAllowHostHeaderOriginFallback,
  });

  if (
    hasConfiguredOriginPolicy &&
    extraAllowedOrigins.every((origin) => currentAllowedOrigins.includes(origin))
  ) {
    return { config, seededOrigins: null, bind: effectiveBind };
  }

  const port = resolveGatewayPortWithDefault(config.gateway?.port, opts?.defaultPort);
  const seededOrigins =
    currentAllowedOrigins.length > 0
      ? mergeControlUiOrigins(currentAllowedOrigins, extraAllowedOrigins)
      : hasConfiguredOriginPolicy
        ? extraAllowedOrigins
        : mergeControlUiOrigins(
            buildDefaultControlUiAllowedOrigins({
              port,
              bind: effectiveBind,
              customBindHost: config.gateway?.customBindHost,
            }),
            extraAllowedOrigins,
          );
  return {
    config: {
      ...config,
      gateway: {
        ...config.gateway,
        controlUi: {
          ...config.gateway?.controlUi,
          allowedOrigins: seededOrigins,
        },
      },
    },
    seededOrigins,
    bind: effectiveBind,
  };
}
