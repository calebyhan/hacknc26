import type { AuthConfig } from "convex/server";

const domain = process.env.AUTH0_DOMAIN, clientId = process.env.AUTH0_CLIENT_ID;
if (Boolean(domain) !== Boolean(clientId)) throw new Error("Configure both AUTH0_DOMAIN and AUTH0_CLIENT_ID");
export default {
  // No configured provider means app requests remain unauthenticated. Photon
  // transport authentication is independent and continues to work.
  providers: domain && clientId ? [{ domain, applicationID: clientId }] : [],
} satisfies AuthConfig;
