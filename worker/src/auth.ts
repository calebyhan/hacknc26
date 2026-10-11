import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { convexCommand, developmentTarget, type ConvexCommand } from "./setup.ts";

// Operator-only code; never imported by the inference worker.
export const callbackUri = "http://127.0.0.1:8765/callback";
export interface AuthSettings { issuer: string; clientId: string }
export interface LoginRequest { url: string; state: string; nonce: string; verifier: string }

export function authSettings(domain: string, clientId: string): AuthSettings {
  const url = new URL(domain.includes("://") ? domain : `https://${domain}`);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) throw new Error("AUTH_CONFIGURATION_INVALID");
  return { issuer: url.href, clientId };
}
export function loginRequest(settings: AuthSettings): LoginRequest {
  const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url");
  const url = new URL("authorize", settings.issuer);
  url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: callbackUri, response_type: "code", scope: "openid profile", state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { url: url.href, state, nonce, verifier };
}

export function callbackCode(rawUrl: string, state: string): string {
  const url = new URL(rawUrl, callbackUri);
  if (url.origin !== new URL(callbackUri).origin || url.pathname !== "/callback" || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) throw new Error("CALLBACK_REJECTED");
  if (url.searchParams.has("error")) throw new Error("AUTHORIZATION_DENIED");
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) throw new Error("CALLBACK_REJECTED");
  return code;
}

export async function listenForCallback(state: string, signal: AbortSignal, options: { port?: number; timeoutMs?: number } = {}) {
  let resolveCode!: (code: string) => void, rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Abort/open failures can arrive before the caller starts awaiting the result.
  void code.catch(() => {});
  let settled = false;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Content-Security-Policy", "default-src 'none'");
    const address = server.address();
    if (request.method !== "GET" || !address || typeof address === "string" || request.headers.host !== `127.0.0.1:${address.port}` || !request.url?.startsWith("/")) { response.writeHead(400).end("Invalid callback."); return; }
    try {
      const received = callbackCode(request.url, state);
      if (settled) { response.writeHead(409).end("Sign-in already handled."); return; }
      settled = true; resolveCode(received); response.end("Sign-in received. Return to the terminal for the validation result.");
    } catch (error) {
      response.writeHead(400).end("Sign-in callback rejected. Return to the terminal.");
      if (error instanceof Error && error.message === "AUTHORIZATION_DENIED" && !settled) { settled = true; rejectCode(new Error("AUTHORIZATION_DENIED")); }
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(options.port ?? 8765, "127.0.0.1", () => { server.removeListener("error", rejectListen); resolveListen(); }); });
  const fail = (category: string) => { if (!settled) { settled = true; rejectCode(new Error(category)); } server.closeAllConnections(); server.close(); };
  const timer = setTimeout(() => fail("LOGIN_TIMEOUT"), options.timeoutMs ?? 300_000);
  const abort = () => fail("LOGIN_CANCELED"); signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { code, port: (server.address() as { port: number } | null)?.port, close: () => { clearTimeout(timer); signal.removeEventListener("abort", abort); fail("LOGIN_CANCELED"); } };
}

export async function validateIdToken(token: string, settings: AuthSettings, nonce: string, key?: JWTVerifyGetKey, now = new Date()): Promise<void> {
  if (token.length > 32_768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("ID_TOKEN_INVALID");
  try {
    const resolver = key ?? createRemoteJWKSet(new URL(".well-known/jwks.json", settings.issuer), { timeoutDuration: 10_000 });
    const { payload } = await jwtVerify(token, resolver, { issuer: settings.issuer, audience: settings.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp", "nonce"], maxTokenAge: "10m", clockTolerance: 5, currentDate: now });
    if (payload.nonce !== nonce || !payload.sub || payload.azp !== undefined && payload.azp !== settings.clientId || Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== settings.clientId) throw new Error();
  } catch { throw new Error("ID_TOKEN_INVALID"); }
}

export async function exchangeCode(settings: AuthSettings, request: LoginRequest, code: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(new URL("oauth/token", settings.issuer), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: settings.clientId, code, code_verifier: request.verifier, redirect_uri: callbackUri }), redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
  const text = await response.text(); if (text.length > 65_536) throw new Error("TOKEN_EXCHANGE_FAILED");
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== "object" || !("id_token" in result) || typeof result.id_token !== "string") throw new Error("TOKEN_EXCHANGE_FAILED");
  return result.id_token;
}

export async function saveSession(root: string, token: string, settings: AuthSettings): Promise<void> {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("ID_TOKEN_INVALID");
  const file = join(root, ".env.local"); if (!(await lstat(file)).isFile()) throw new Error("LOCAL_CONFIG_REQUIRED");
  // Reread after browser login to preserve concurrent operator configuration.
  const original = await readFile(file, "utf8"), keys = ["RALLY_AUTH0_ID_TOKEN", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID"];
  const lines = original.split(/\r?\n/).filter(line => !keys.some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
  const next = `${lines.join("\n").trimEnd()}\nAUTH0_DOMAIN=${settings.issuer}\nAUTH0_CLIENT_ID=${settings.clientId}\nRALLY_AUTH0_ID_TOKEN=${token}\n`;
  const dir = await mkdtemp(join(root, ".worker-setup-"));
  try { const replacement = join(dir, "session.env"); await writeFile(replacement, next, { mode: 0o600, flag: "wx" }); await rename(replacement, file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

export async function readAuthSettings(root: string, run: ConvexCommand): Promise<AuthSettings> {
  const config = parseEnv(await readFile(join(root, ".env.local"), "utf8")), deployment = developmentTarget(config);
  const values: string[] = [];
  for (const name of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID"]) {
    const result = await run(["env", "get", name, "--deployment", deployment]);
    if (result.status !== 0 || !result.stdout.trim()) throw new Error("AUTH_CONFIGURATION_REQUIRED");
    values.push(result.stdout.trim());
  }
  return authSettings(values[0]!, values[1]!);
}

export async function checkCallback(settings: AuthSettings, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(loginRequest(settings).url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const redirect = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && redirect) {
    const location = new URL(redirect, settings.issuer);
    if (location.origin === settings.issuer.slice(0, -1) && !location.searchParams.has("error")) return;
  }
  const text = await response.text();
  if (/callback\s+url\s+mismatch|redirect_uri.*(?:not|invalid|mismatch)/iu.test(text)) throw new Error("CALLBACK_NOT_ALLOWED");
  throw new Error("AUTHORIZATION_REQUEST_REJECTED");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url)), controller = new AbortController();
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
  try {
    const settings = await readAuthSettings(root, convexCommand(root));
    await checkCallback(settings);
    if (process.argv.includes("--check")) console.info("Auth0 CLI callback is accepted. User sign-in is still required.");
    else {
      const request = loginRequest(settings), callback = await listenForCallback(request.state, controller.signal);
      try {
        console.info("Opening Rally's Auth0 sign-in. Credentials stay in the browser; the ID token will be saved privately.");
        if (spawnSync("/usr/bin/open", [request.url], { encoding: "utf8", timeout: 5000 }).status !== 0) throw new Error("BROWSER_OPEN_FAILED");
        const token = await exchangeCode(settings, request, await callback.code);
        await validateIdToken(token, settings, request.nonce);
        await saveSession(root, token, settings);
        console.info("Auth0 ID token validated and saved to private .env.local (0600). Use npm run domain:setup; no token values were logged.");
      } finally { callback.close(); }
    }
  } catch (error) {
    const known = new Set(["AUTH_CONFIGURATION_INVALID", "AUTH_CONFIGURATION_REQUIRED", "DEVELOPMENT_TARGET_REQUIRED", "CALLBACK_NOT_ALLOWED", "AUTHORIZATION_REQUEST_REJECTED", "AUTHORIZATION_DENIED", "LOGIN_TIMEOUT", "LOGIN_CANCELED", "ID_TOKEN_INVALID", "TOKEN_EXCHANGE_FAILED", "BROWSER_OPEN_FAILED"]);
    const category = error instanceof Error && known.has(error.message) ? error.message : "LOGIN_FAILED";
    console.error(`Rally sign-in failed: ${category}. No credentials were logged.`);
    if (category === "CALLBACK_NOT_ALLOWED") console.error(`In the existing Auth0 Native application's Settings, append ${callbackUri} to Allowed Callback URLs, preserve the iOS entry, save, then rerun npm run auth:login.`);
    process.exitCode = 1;
  }
}
