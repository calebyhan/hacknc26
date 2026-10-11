/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as appStatus from "../appStatus.js";
import type * as commands from "../commands.js";
import type * as commitments from "../commitments.js";
import type * as context from "../context.js";
import type * as crons from "../crons.js";
import type * as domain from "../domain.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as inbound from "../inbound.js";
import type * as invitations from "../invitations.js";
import type * as lib_appStatus from "../lib/appStatus.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_commitmentEngine from "../lib/commitmentEngine.js";
import type * as lib_decisionEngine from "../lib/decisionEngine.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_messaging from "../lib/messaging.js";
import type * as lib_messagingDelivery from "../lib/messagingDelivery.js";
import type * as lib_proposalEngine from "../lib/proposalEngine.js";
import type * as lib_publicErrors from "../lib/publicErrors.js";
import type * as lib_validators from "../lib/validators.js";
import type * as outbox from "../outbox.js";
import type * as proposals from "../proposals.js";
import type * as reasoningJobs from "../reasoningJobs.js";
import type * as seed from "../seed.js";
import type * as spectrum from "../spectrum.js";
import type * as spectrumSender from "../spectrumSender.js";
import type * as tasks from "../tasks.js";
import type * as weather from "../weather.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  appStatus: typeof appStatus;
  commands: typeof commands;
  commitments: typeof commitments;
  context: typeof context;
  crons: typeof crons;
  domain: typeof domain;
  events: typeof events;
  http: typeof http;
  identity: typeof identity;
  inbound: typeof inbound;
  invitations: typeof invitations;
  "lib/appStatus": typeof lib_appStatus;
  "lib/auth": typeof lib_auth;
  "lib/commitmentEngine": typeof lib_commitmentEngine;
  "lib/decisionEngine": typeof lib_decisionEngine;
  "lib/domain": typeof lib_domain;
  "lib/messaging": typeof lib_messaging;
  "lib/messagingDelivery": typeof lib_messagingDelivery;
  "lib/proposalEngine": typeof lib_proposalEngine;
  "lib/publicErrors": typeof lib_publicErrors;
  "lib/validators": typeof lib_validators;
  outbox: typeof outbox;
  proposals: typeof proposals;
  reasoningJobs: typeof reasoningJobs;
  seed: typeof seed;
  spectrum: typeof spectrum;
  spectrumSender: typeof spectrumSender;
  tasks: typeof tasks;
  weather: typeof weather;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  spectrum: import("@spectrum-ts/convex/_generated/component.js").ComponentApi<"spectrum">;
};
