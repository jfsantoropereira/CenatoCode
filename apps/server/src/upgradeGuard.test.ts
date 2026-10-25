import { describe, expect, it } from "vitest";

import {
  DESKTOP_APP_ORIGIN,
  isAllowedUpgradeOrigin,
  isLoopbackHost,
  requiresAuthToken,
  resolveDefaultHost,
  tokensMatch,
} from "./upgradeGuard.ts";

const PORT = 3773;
const base = {
  hostHeader: `127.0.0.1:${PORT}`,
  bindHost: "127.0.0.1",
  port: PORT,
  devUrl: undefined,
  authToken: undefined,
};

describe("upgradeGuard", () => {
  it("binds loopback when no host is configured, in every mode", () => {
    expect(resolveDefaultHost(undefined)).toBe("127.0.0.1");
    expect(isLoopbackHost(resolveDefaultHost(undefined))).toBe(true);
  });

  it("keeps an explicit host", () => {
    expect(resolveDefaultHost("0.0.0.0")).toBe("0.0.0.0");
    expect(resolveDefaultHost("100.88.10.4")).toBe("100.88.10.4");
  });

  it("classifies loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "127.1.2.3"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    const remote = [undefined, "0.0.0.0", "::", "192.168.1.42", "100.88.10.4", "localhost.evil"];
    for (const host of remote) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("requires an auth token for non-loopback binds only", () => {
    expect(requiresAuthToken("0.0.0.0", undefined)).toBe(true);
    expect(requiresAuthToken("192.168.1.42", "")).toBe(true);
    expect(requiresAuthToken("0.0.0.0", "secret")).toBe(false);
    expect(requiresAuthToken("127.0.0.1", undefined)).toBe(false);
  });

  it("rejects a foreign browser Origin", () => {
    expect(isAllowedUpgradeOrigin({ ...base, origin: "https://attacker.example" })).toBe(false);
    expect(
      isAllowedUpgradeOrigin({ ...base, origin: "https://attacker.example", authToken: "secret" }),
    ).toBe(false);
    expect(isAllowedUpgradeOrigin({ ...base, origin: "null" })).toBe(false);
    expect(isAllowedUpgradeOrigin({ ...base, origin: "http://localhost:9999" })).toBe(false);
  });

  it("rejects a DNS-rebound page on a loopback bind without a token", () => {
    expect(
      isAllowedUpgradeOrigin({
        ...base,
        origin: `http://rebind.attacker.example:${PORT}`,
        hostHeader: `rebind.attacker.example:${PORT}`,
      }),
    ).toBe(false);
  });

  it("allows no-Origin clients, local UI, devUrl and desktop origins", () => {
    expect(isAllowedUpgradeOrigin({ ...base, origin: undefined })).toBe(true);
    expect(isAllowedUpgradeOrigin({ ...base, origin: `http://127.0.0.1:${PORT}` })).toBe(true);
    expect(isAllowedUpgradeOrigin({ ...base, origin: `http://localhost:${PORT}` })).toBe(true);
    expect(isAllowedUpgradeOrigin({ ...base, origin: `http://[::1]:${PORT}` })).toBe(true);
    expect(isAllowedUpgradeOrigin({ ...base, origin: DESKTOP_APP_ORIGIN })).toBe(true);
    expect(
      isAllowedUpgradeOrigin({
        ...base,
        origin: "http://localhost:5173",
        devUrl: new URL("http://localhost:5173"),
      }),
    ).toBe(true);
  });

  it("allows the served UI origin on an explicit remote bind", () => {
    expect(
      isAllowedUpgradeOrigin({
        ...base,
        bindHost: "0.0.0.0",
        authToken: "secret",
        origin: `http://192.168.1.42:${PORT}`,
        hostHeader: `192.168.1.42:${PORT}`,
      }),
    ).toBe(true);
    expect(
      isAllowedUpgradeOrigin({
        ...base,
        bindHost: "100.88.10.4",
        authToken: "secret",
        origin: `http://100.88.10.4:${PORT}`,
        hostHeader: `100.88.10.4:${PORT}`,
      }),
    ).toBe(true);
    expect(
      isAllowedUpgradeOrigin({
        ...base,
        bindHost: "0.0.0.0",
        authToken: "secret",
        origin: "https://attacker.example",
        hostHeader: `192.168.1.42:${PORT}`,
      }),
    ).toBe(false);
  });

  it("compares tokens exactly", () => {
    expect(tokensMatch("secret", "secret")).toBe(true);
    expect(tokensMatch("secreT", "secret")).toBe(false);
    expect(tokensMatch("secret-longer", "secret")).toBe(false);
    expect(tokensMatch(null, "secret")).toBe(false);
  });
});
