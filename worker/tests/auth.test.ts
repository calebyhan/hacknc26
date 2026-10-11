import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type LocalJWKSet } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authSettings, callbackCode, callbackUri, checkCallback, exchangeCode, listenForCallback, loginRequest, readAuthSettings, saveSession, validateIdToken } from "../src/auth.ts";

const settings = authSettings("fixture.auth0.com", "fixture-native-client");
const now = new Date("2026-10-10T12:00:00Z"), seconds = Math.floor(now.getTime() / 1000);
let pair: Awaited<ReturnType<typeof generateKeyPair>>, key: LocalJWKSet;
beforeAll(async () => { pair = await generateKeyPair("RS256", { extractable: true }); key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: "RS256", use: "sig", kid: "fixture" }] }); });
async function token(overrides: Record<string, unknown> = {}) { return new SignJWT({ iss: settings.issuer, aud: settings.clientId, sub: "fixture-person", iat: seconds, exp: seconds + 3600, nonce: "fixture-nonce", ...overrides }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(pair.privateKey); }
const dirs: string[] = [], close: (() => void)[] = [];
afterEach(async () => { close.splice(0).forEach(fn => fn()); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("human Auth0 CLI login (synthetic issuer/tokens; no real login)", () => {
  it("requests fresh state, nonce and S256 PKCE with only identity scopes", () => {
    const request = loginRequest(settings), params = new URL(request.url).searchParams;
    expect(params.get("redirect_uri")).toBe(callbackUri); expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid profile"); expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(request.verifier).digest("base64url"));
    expect(request.verifier.length).toBeGreaterThanOrEqual(43); expect(loginRequest(settings).state).not.toBe(request.state);
    expect(request.url).not.toContain(request.verifier);
  });
  it.each(["http://fixture.auth0.com", "https://other@fixture.auth0.com", "https://fixture.auth0.com/other", "https://fixture.auth0.com/?x=1"])("rejects unsafe issuer configuration: %s", domain => {
    expect(() => authSettings(domain, settings.clientId)).toThrow("AUTH_CONFIGURATION_INVALID");
  });
  it.each(["/callback?state=wrong&code=secret", "/callback?state=fixture&state=fixture&code=secret", "/callback?state=fixture&code=a&code=b", "//attacker.example/callback?state=fixture&code=secret", "/other?state=fixture&code=secret"])("rejects foreign or duplicated callbacks without exposing codes: %s", url => {
    expect(() => callbackCode(url, "fixture")).toThrow("CALLBACK_REJECTED");
  });
  it("accepts only a bound code and sanitizes provider errors", () => {
    expect(callbackCode("/callback?state=fixture&code=fixture-code", "fixture")).toBe("fixture-code");
    expect(() => callbackCode("/callback?state=fixture&error=access_denied&error_description=private", "fixture")).toThrow("AUTHORIZATION_DENIED");
  });
  it("keeps listening after invalid state/host and consumes the legitimate code once", async () => {
    const callback = await listenForCallback("fixture", new AbortController().signal, { port: 0 }); close.push(callback.close);
    const origin = `http://127.0.0.1:${callback.port}`;
    expect((await fetch(`${origin}/callback?state=wrong&code=bad`)).status).toBe(400);
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${origin}/callback?state=fixture&code=bad`, { headers: { Host: "attacker.example" } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end();
    });
    expect(badHostStatus).toBe(400);
    const response = await fetch(`${origin}/callback?state=fixture&code=good`);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("good"); expect(await callback.code).toBe("good");
    expect((await fetch(`${origin}/callback?state=fixture&code=second`)).status).toBe(409);
  });
  it("times out and releases the loopback listener", async () => {
    const callback = await listenForCallback("fixture", new AbortController().signal, { port: 0, timeoutMs: 25 }); close.push(callback.close);
    await expect(callback.code).rejects.toThrow("LOGIN_TIMEOUT");
    await expect(fetch(`http://127.0.0.1:${callback.port}/callback`)).rejects.toThrow();
  });
  it("cancels immediately on abort", async () => {
    const controller = new AbortController(), callback = await listenForCallback("fixture", controller.signal, { port: 0 }); close.push(callback.close);
    controller.abort(); await expect(callback.code).rejects.toThrow("LOGIN_CANCELED");
  });
  it("validates signature, issuer, audience, time and nonce", async () => {
    await expect(validateIdToken(await token(), settings, "fixture-nonce", key, now)).resolves.toBeUndefined();
    await expect(validateIdToken(await token({ aud: [settings.clientId, "other"], azp: settings.clientId }), settings, "fixture-nonce", key, now)).resolves.toBeUndefined();
  });
  it.each([
    { iss: "https://other.auth0.com/" }, { aud: "other-client" }, { nonce: "other-nonce" }, { nonce: undefined },
    { exp: seconds - 60 }, { iat: seconds + 60 }, { aud: [settings.clientId, "other"] }, { azp: "other-client" }, { sub: undefined },
  ])("rejects a correctly signed token with wrong identity claims: %j", async claims => {
    await expect(validateIdToken(await token(claims), settings, "fixture-nonce", key, now)).rejects.toThrow("ID_TOKEN_INVALID");
  });
  it("rejects tampering and an unapproved signing algorithm", async () => {
    const parts = (await token()).split("."); parts[1] = Buffer.from(JSON.stringify({ sub: "forged" })).toString("base64url");
    await expect(validateIdToken(parts.join("."), settings, "fixture-nonce", key, now)).rejects.toThrow("ID_TOKEN_INVALID");
    const symmetric = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
    await expect(validateIdToken(symmetric, settings, "fixture-nonce", key, now)).rejects.toThrow("ID_TOKEN_INVALID");
  });
  it("exchanges the code with its own verifier and ignores access/refresh tokens", async () => {
    const request = loginRequest(settings), jwt = await token();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id_token: jwt, access_token: "unused-access", refresh_token: "unused-refresh" })));
    expect(await exchangeCode(settings, request, "fixture-code", fetcher)).toBe(jwt);
    const [url, options] = fetcher.mock.calls[0]!; expect(String(url)).toBe("https://fixture.auth0.com/oauth/token");
    const body = options?.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe(request.verifier); expect(body.get("redirect_uri")).toBe(callbackUri);
    expect(body.has("client_secret")).toBe(false); expect(options?.redirect).toBe("error");
  });
  it("rejects token exchange failures and missing ID tokens", async () => {
    const request = loginRequest(settings);
    for (const response of [new Response("private provider detail", { status: 400 }), new Response(JSON.stringify({ access_token: "unused" }))]) {
      await expect(exchangeCode(settings, request, "fixture-code", vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow("TOKEN_EXCHANGE_FAILED");
    }
  });
  it("detects callback setup errors and rejects redirects to another host", async () => {
    await expect(checkCallback(settings, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/u/login?state=opaque" } })))).resolves.toBeUndefined();
    await expect(checkCallback(settings, vi.fn<typeof fetch>().mockResolvedValue(new Response("Callback URL mismatch", { status: 403 })))).rejects.toThrow("CALLBACK_NOT_ALLOWED");
    await expect(checkCallback(settings, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://attacker.example/login" } })))).rejects.toThrow("AUTHORIZATION_REQUEST_REJECTED");
  });
  it("loads public settings from the explicit dev target and saves only the ID token privately", async () => {
    const root = await mkdtemp(join(tmpdir(), "rally-auth-test-")); dirs.push(root);
    const file = join(root, ".env.local");
    await writeFile(file, "# keep comments\nCONVEX_DEPLOYMENT=dev:fixture-dev\nCONVEX_URL=https://fixture-dev.convex.cloud\nRALLY_WORKER_TOKEN=fixture-worker-secret\nRALLY_PROVIDER=codex\n", { mode: 0o600 });
    const run = vi.fn(async (args: readonly string[]) => ({ status: 0, stdout: args[2] === "AUTH0_DOMAIN" ? settings.issuer : settings.clientId }));
    expect(await readAuthSettings(root, run)).toEqual(settings);
    expect(run.mock.calls.every(([args]) => args.slice(-2).join(" ") === "--deployment fixture-dev")).toBe(true);
    const jwt = await token(); await saveSession(root, jwt, settings);
    const text = await readFile(file, "utf8"), config = parseEnv(text);
    expect(config.RALLY_AUTH0_ID_TOKEN).toBe(jwt); expect(config.RALLY_WORKER_TOKEN).toBe("fixture-worker-secret");
    expect(config.RALLY_PROVIDER).toBe("codex"); expect(text).toContain("# keep comments");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
