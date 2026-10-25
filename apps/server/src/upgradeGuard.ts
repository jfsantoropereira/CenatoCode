/**
 * upgradeGuard - Pure bind/WebSocket-upgrade policy helpers.
 *
 * Kept free of effect/ws imports so the policy can be tested in isolation.
 *
 * @module upgradeGuard
 */
import { timingSafeEqual } from "node:crypto";

/** Bind address used when no --host / T3CODE_HOST is given, in every mode. */
export const DEFAULT_HOST = "127.0.0.1";

/** Origin sent by the packaged desktop renderer (`t3://app/index.html`). */
export const DESKTOP_APP_ORIGIN = "t3://app";

export function resolveDefaultHost(explicitHost: string | undefined): string {
  return explicitHost ?? DEFAULT_HOST;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const normalized = stripBrackets(host.trim().toLowerCase());
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized === "::ffff:127.0.0.1"
  );
}

/** A non-loopback bind without an auth token would expose the server unauthenticated. */
export function requiresAuthToken(
  host: string | undefined,
  authToken: string | undefined,
): boolean {
  return !isLoopbackHost(host) && !authToken;
}

function hostnameOfHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface UpgradeOriginPolicy {
  readonly origin: string | undefined;
  readonly hostHeader: string | undefined;
  readonly bindHost: string | undefined;
  readonly port: number;
  readonly devUrl: URL | undefined;
  readonly authToken: string | undefined;
}

/**
 * Decide whether a WebSocket upgrade's Origin is acceptable.
 *
 * - No Origin header (non-browser client): allowed; the token check still applies.
 * - Desktop app scheme, configured devUrl origin, and loopback origins on the server port: allowed.
 * - The bound host's own origin: allowed.
 * - Same-host origins (Origin hostname == Host header hostname) only when the bind is
 *   non-loopback or a token is configured, so a loopback bind without a token cannot be
 *   reached from a DNS-rebound or cross-site page.
 */
export function isAllowedUpgradeOrigin(policy: UpgradeOriginPolicy): boolean {
  const { origin, hostHeader, bindHost, port, devUrl, authToken } = policy;
  if (origin === undefined) return true;
  if (origin === DESKTOP_APP_ORIGIN) return true;
  if (devUrl && origin === devUrl.origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.origin !== origin) return false;

  const originHostname = parsed.hostname.toLowerCase();
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  const originPort = parsed.port === "" ? defaultPort : Number(parsed.port);

  if (isLoopbackHost(originHostname)) {
    return originPort === port;
  }
  if (
    bindHost !== undefined &&
    originPort === port &&
    stripBrackets(originHostname) === stripBrackets(bindHost.toLowerCase())
  ) {
    return true;
  }
  if (!isLoopbackHost(bindHost) || authToken) {
    const requestHostname = hostnameOfHostHeader(hostHeader);
    return requestHostname !== null && requestHostname === originHostname;
  }
  return false;
}

/** Constant-time token comparison. */
export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
