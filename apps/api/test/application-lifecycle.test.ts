import { describe, expect, test } from "bun:test";
import { evaluateSimulation } from "@rovaulta/simulation-core";
import { ApplicationStore, createClearanceRecordFromEvaluation } from "../src/application/index.js";
import type { ReleaseService } from "../src/release/index.js";
import { buildServer } from "../src/server.js";

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function cookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers["set-cookie"];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? (first.split(";", 1)[0] ?? "") : "";
  }
  return typeof value === "string" ? (value.split(";", 1)[0] ?? "") : "";
}

function sessionHeaders(value: string) {
  return { cookie: value, origin: "http://localhost:3000" };
}

const policy = {
  warehouseWidthMm: 1_000,
  warehouseHeightMm: 1_000,
  restrictedZone: { minXmm: 400, minYmm: 400, maxXmm: 600, maxYmm: 600 },
  maximumSpeedMmPerSecond: 1_000,
  zoneSpeedLimitMmPerSecond: 600,
  payloadThresholdGrams: 40_000,
};

async function register(app: ReturnType<typeof buildServer>, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery staple" },
  });
  expect(response.statusCode).toBe(201);
  return cookie(response);
}

describe("account-scoped product lifecycle", () => {
  test("persists a private policy and evaluates a registered build", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({
      applicationStore: store,
      evaluationExecutor: { evaluate: async (input) => evaluateSimulation(input) },
    });
    const session = await register(app, "operator@example.test");

    const siteResponse = await app.inject({
      method: "POST",
      url: "/sites",
      headers: sessionHeaders(session),
      payload: { name: "North dock", location: "Manila", policy },
    });
    expect(siteResponse.statusCode).toBe(201);
    const site = JSON.parse(siteResponse.body).site;
    expect(site).toHaveProperty("safetyEnvelopeCommitment");
    expect(JSON.stringify(site)).not.toContain("warehouseBounds");
    const account = store.accountForSession(ApplicationStore.readSessionCookie(session));
    if (account === null) throw new Error("test account session was not found");
    const operatorSecret = store.readConfidentialEvaluationSecretForOperator(account.id, site.id);
    const secretPayload = JSON.parse(operatorSecret.value) as Record<string, unknown>;
    expect(operatorSecret.selector).toMatch(
      /^ROVAULTA_CONFIDENTIAL_EVALUATION_INPUT_site_[a-z2-7]+$/,
    );
    expect(secretPayload.schemaVersion).toBe("rovaulta.cre-confidential-evaluation-input/v1");
    expect(secretPayload.protocolVersion).toBe("rovaulta.protocol/v1");
    expect(secretPayload.envelopeBlindingSecretHex).toMatch(/^[0-9a-f]{64}$/);
    expect((secretPayload.confidentialEnvelope as Record<string, unknown>).siteId).toBe(site.id);
    expect(JSON.stringify(siteResponse.body)).not.toContain(operatorSecret.value);

    const robotResponse = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/robots`,
      headers: sessionHeaders(session),
      payload: { name: "AMR-01" },
    });
    expect(robotResponse.statusCode).toBe(201);
    const robot = JSON.parse(robotResponse.body).robot;

    const buildResponse = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/builds`,
      headers: sessionHeaders(session),
      payload: {
        robotId: robot.id,
        version: "1.0.0",
        label: "Clear candidate",
        artifactDigest: `sha256:${"ab".repeat(32)}`,
        route: {
          start: { xMm: 100, yMm: 100 },
          end: { xMm: 900, yMm: 100 },
          speedMmPerSecond: 400,
        },
      },
    });
    expect(buildResponse.statusCode).toBe(201);
    const build = JSON.parse(buildResponse.body).build;

    const evaluationResponse = await app.inject({
      method: "POST",
      url: "/evaluations",
      headers: sessionHeaders(session),
      payload: { siteId: site.id, robotId: robot.id, buildId: build.id },
    });
    expect(evaluationResponse.statusCode).toBe(201);
    const evaluation = JSON.parse(evaluationResponse.body).evaluation;
    expect(evaluation.verdict).toBe("CLEAR");
    expect(evaluation.robotBuildDigest).toBe(build.robotBuildDigest);
    expect(evaluation.safetyEnvelopeCommitment).toBe(site.safetyEnvelopeCommitment);

    const releaseResponse = await app.inject({
      method: "POST",
      url: "/releases/prepare",
      headers: sessionHeaders(session),
      payload: {
        evaluationId: evaluation.evaluationId,
        signerAddress: "0x0000000000000000000000000000000000000001",
        clearance: null,
      },
    });
    expect(releaseResponse.statusCode).toBe(409);
    expect(JSON.parse(releaseResponse.body).error).toBe("CLEARANCE_NOT_AVAILABLE");
    const tamperedClearanceResponse = await app.inject({
      method: "POST",
      url: "/releases/prepare",
      headers: sessionHeaders(session),
      payload: {
        evaluationId: evaluation.evaluationId,
        signerAddress: "0x0000000000000000000000000000000000000001",
        clearance: {
          schemaVersion: "rovaulta.clearance-record/v1",
          clearanceId: "clearance:test-record",
          evaluationId: evaluation.evaluationId,
          inputs: {
            schemaVersion: "rovaulta.evaluation-inputs/v1",
            siteId: evaluation.siteId,
            robotId: evaluation.robotId,
            robotBuildId: evaluation.robotBuildId,
            robotBuildDigest: evaluation.robotBuildDigest,
            safetyEnvelopeId: evaluation.safetyEnvelopeId,
            safetyEnvelopeCommitment: `sha256:${"cd".repeat(32)}`,
            evaluatorVersion: evaluation.evaluatorVersion,
          },
          evaluationInputsDigest: evaluation.evaluationInputsDigest,
          verdict: "CLEAR",
          issuedAt: evaluation.evaluatedAt,
          expiresAt: (Number(evaluation.evaluatedAt) + 3_600).toString(),
        },
      },
    });
    expect(tamperedClearanceResponse.statusCode).toBe(409);
    expect(JSON.parse(tamperedClearanceResponse.body).error).toBe("CLEARANCE_BINDING_MISMATCH");
    await app.close();
  });

  test("isolates resources between accounts", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({
      applicationStore: store,
      evaluationExecutor: { evaluate: async (input) => evaluateSimulation(input) },
    });
    const first = await register(app, "first@example.test");
    const second = await register(app, "second@example.test");
    const siteResponse = await app.inject({
      method: "POST",
      url: "/sites",
      headers: sessionHeaders(first),
      payload: { name: "Private site", location: "Manila", policy },
    });
    const site = JSON.parse(siteResponse.body).site;

    const hidden = await app.inject({
      method: "GET",
      url: `/sites/${site.id}`,
      headers: sessionHeaders(second),
    });
    expect(hidden.statusCode).toBe(404);
    const hiddenBuild = await app.inject({
      method: "POST",
      url: "/evaluations",
      headers: sessionHeaders(second),
      payload: { siteId: site.id, robotId: "robot:missing", buildId: "robot-build:missing" },
    });
    expect(hiddenBuild.statusCode).toBe(404);
    await app.close();
  });

  test("rejects anonymous resource access and malformed account input", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({
      applicationStore: store,
      evaluationExecutor: { evaluate: async (input) => evaluateSimulation(input) },
    });
    const anonymous = await app.inject({ method: "GET", url: "/sites" });
    expect(anonymous.statusCode).toBe(401);
    const malformedCookie = await app.inject({
      method: "GET",
      url: "/sites",
      headers: { cookie: "rovaulta_session=%" },
    });
    expect(malformedCookie.statusCode).toBe(401);
    const malformed = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "operator@example.test", password: "short" },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  test("creates, restores, and revokes the authenticated session", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({ applicationStore: store });
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "session@example.test", password: "correct horse battery staple" },
    });
    expect(registration.statusCode).toBe(201);
    const registeredSession = cookie(registration);
    expect(registration.headers["set-cookie"]).toContain("HttpOnly");
    expect(registration.headers["set-cookie"]).toContain("SameSite=None");
    expect(registration.headers["set-cookie"]).toContain("Secure");
    expect(registration.headers["set-cookie"]).toContain("Max-Age=2592000");
    expect(registration.headers["cache-control"]).toBe("no-store");

    const registeredMe = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: registeredSession },
    });
    expect(registeredMe.statusCode).toBe(200);
    expect(JSON.parse(registeredMe.body).account.email).toBe("session@example.test");

    const signIn = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "session@example.test", password: "correct horse battery staple" },
    });
    expect(signIn.statusCode).toBe(200);
    const signedInSession = cookie(signIn);
    expect(signedInSession).not.toBe(registeredSession);
    const invalidSignIn = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "session@example.test", password: "wrong password" },
    });
    expect(invalidSignIn.statusCode).toBe(401);

    const signedInMe = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: signedInSession },
    });
    expect(signedInMe.statusCode).toBe(200);
    expect(JSON.parse(signedInMe.body).account.email).toBe("session@example.test");

    const signOut = await app.inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: sessionHeaders(signedInSession),
    });
    expect(signOut.statusCode).toBe(204);
    expect(signOut.headers["set-cookie"]).toContain("Max-Age=0");
    const revokedMe = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: signedInSession },
    });
    expect(revokedMe.statusCode).toBe(401);
    const revokedResources = await app.inject({
      method: "GET",
      url: "/sites",
      headers: { cookie: signedInSession },
    });
    expect(revokedResources.statusCode).toBe(401);
    await app.close();
  });

  test("binds every account resource endpoint to the authenticated owner", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({
      applicationStore: store,
      evaluationExecutor: { evaluate: async (input) => evaluateSimulation(input) },
    });
    const first = await register(app, "owner@example.test");
    const second = await register(app, "intruder@example.test");
    const firstSiteResponse = await app.inject({
      method: "POST",
      url: "/sites",
      headers: sessionHeaders(first),
      payload: { name: "Owner site", location: "Manila", policy },
    });
    const site = JSON.parse(firstSiteResponse.body).site;
    const firstRobotResponse = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/robots`,
      headers: sessionHeaders(first),
      payload: { name: "Owner robot" },
    });
    const robot = JSON.parse(firstRobotResponse.body).robot;
    const firstBuildResponse = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/builds`,
      headers: sessionHeaders(first),
      payload: {
        robotId: robot.id,
        version: "1.0.0",
        label: "Owner build",
        artifactDigest: `sha256:${"aa".repeat(32)}`,
        route: {
          start: { xMm: 100, yMm: 100 },
          end: { xMm: 900, yMm: 100 },
          speedMmPerSecond: 400,
        },
      },
    });
    const build = JSON.parse(firstBuildResponse.body).build;
    const firstEvaluationResponse = await app.inject({
      method: "POST",
      url: "/evaluations",
      headers: sessionHeaders(first),
      payload: { siteId: site.id, robotId: robot.id, buildId: build.id },
    });
    const evaluation = JSON.parse(firstEvaluationResponse.body).evaluation;

    const hiddenSite = await app.inject({
      method: "GET",
      url: `/sites/${site.id}`,
      headers: sessionHeaders(second),
    });
    expect(hiddenSite.statusCode).toBe(404);
    const hiddenRobots = await app.inject({
      method: "GET",
      url: `/sites/${site.id}/robots`,
      headers: sessionHeaders(second),
    });
    expect(hiddenRobots.statusCode).toBe(404);
    const hiddenBuilds = await app.inject({
      method: "GET",
      url: `/sites/${site.id}/builds`,
      headers: sessionHeaders(second),
    });
    expect(hiddenBuilds.statusCode).toBe(404);
    const hiddenEvaluation = await app.inject({
      method: "GET",
      url: `/evaluations/${evaluation.evaluationId}`,
      headers: sessionHeaders(second),
    });
    expect(hiddenEvaluation.statusCode).toBe(404);
    const hiddenReleases = await app.inject({
      method: "GET",
      url: "/releases",
      headers: sessionHeaders(second),
    });
    expect(hiddenReleases.statusCode).toBe(200);
    expect(JSON.parse(hiddenReleases.body).releases).toEqual([]);

    const foreignRobotMutation = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/robots`,
      headers: sessionHeaders(second),
      payload: { name: "Unauthorized robot" },
    });
    expect(foreignRobotMutation.statusCode).toBe(404);
    const foreignBuildMutation = await app.inject({
      method: "POST",
      url: `/sites/${site.id}/builds`,
      headers: sessionHeaders(second),
      payload: {
        robotId: robot.id,
        version: "9.9.9",
        label: "Unauthorized build",
        artifactDigest: `sha256:${"bb".repeat(32)}`,
        route: {
          start: { xMm: 100, yMm: 100 },
          end: { xMm: 900, yMm: 100 },
          speedMmPerSecond: 400,
        },
      },
    });
    expect(foreignBuildMutation.statusCode).toBe(404);
    const foreignReleaseMutation = await app.inject({
      method: "POST",
      url: "/releases/prepare",
      headers: sessionHeaders(second),
      payload: {
        evaluationId: evaluation.evaluationId,
        signerAddress: "0x0000000000000000000000000000000000000001",
        clearance: null,
      },
    });
    expect(foreignReleaseMutation.statusCode).toBe(404);
    await app.close();
  });

  test("binds the legacy release boundary to the authenticated owner", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const owner = store.registerAccount({
      email: "legacy-owner@example.test",
      password: "correct horse battery staple",
    });
    const intruder = store.registerAccount({
      email: "legacy-intruder@example.test",
      password: "correct horse battery staple",
    });
    const site = store.createSite(owner.account.id, {
      name: "Legacy owner site",
      location: "Manila",
      policy,
    });
    const robot = store.createRobot(owner.account.id, site.id, { name: "Legacy owner robot" });
    const build = store.createBuild(owner.account.id, site.id, {
      robotId: robot.id,
      version: "1.0.0",
      label: "Legacy owner build",
      artifactDigest: `sha256:${"cc".repeat(32)}`,
      route: {
        start: { xMm: 100, yMm: 100 },
        end: { xMm: 900, yMm: 100 },
        speedMmPerSecond: 400,
      },
    });
    const evaluation = await store.evaluateBuild(owner.account.id, {
      siteId: site.id,
      robotId: robot.id,
      buildId: build.id,
      evaluationId: "evaluation:legacy-account-bound",
      requestedAt: "1788547200",
      evaluatedAt: "1788547210",
      evaluate: async (input) => evaluateSimulation(input),
    });
    const clearance = createClearanceRecordFromEvaluation(evaluation, {
      clearanceId: "clearance:legacy-account-bound",
      issuedAt: "1788547210",
      expiresAt: "1788550800",
    });
    const preparedInputs: unknown[] = [];
    const consumedInputs: unknown[] = [];
    const releaseService = {
      prepare: async (input: unknown) => {
        preparedInputs.push(input);
        return { status: "prepared" };
      },
      consume: async (input: unknown) => {
        consumedInputs.push(input);
        return { status: "authorized" };
      },
      close: () => undefined,
    } as unknown as ReleaseService;
    const app = buildServer({ applicationStore: store, releaseService });
    const ownerSession =
      ApplicationStore.sessionCookie(owner.sessionToken, false).split(";", 1)[0] ?? "";
    const intruderSession =
      ApplicationStore.sessionCookie(intruder.sessionToken, false).split(";", 1)[0] ?? "";
    const payload = {
      siteId: site.id,
      robotId: robot.id,
      robotBuildId: evaluation.robotBuildId,
      robotBuildDigest: evaluation.robotBuildDigest,
      clearance,
      signerAddress: "0x0000000000000000000000000000000000000001",
    };

    const ownerPrepare = await app.inject({
      method: "POST",
      url: "/release/prepare",
      headers: sessionHeaders(ownerSession),
      payload,
    });
    expect(ownerPrepare.statusCode).toBe(200);
    expect(preparedInputs).toHaveLength(1);
    expect(preparedInputs[0]).toMatchObject({ accountId: owner.account.id });

    const intruderPrepare = await app.inject({
      method: "POST",
      url: "/release/prepare",
      headers: sessionHeaders(intruderSession),
      payload,
    });
    expect(intruderPrepare.statusCode).toBe(404);
    expect(preparedInputs).toHaveLength(1);

    const ownerConsume = await app.inject({
      method: "POST",
      url: "/release/consume",
      headers: sessionHeaders(ownerSession),
      payload: { intent: {}, signature: "0x00" },
    });
    expect(ownerConsume.statusCode).toBe(200);
    expect(consumedInputs).toEqual([
      { intent: {}, signature: "0x00", accountId: owner.account.id },
    ]);

    const anonymousConsume = await app.inject({
      method: "POST",
      url: "/release/consume",
      payload: { intent: {}, signature: "0x00" },
    });
    expect(anonymousConsume.statusCode).toBe(401);
    await app.close();
  });

  test("rejects cross-origin mutations and unauthenticated legacy authority routes", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const app = buildServer({
      applicationStore: store,
      evaluationExecutor: { evaluate: async (input) => evaluateSimulation(input) },
    });
    const session = await register(app, "csrf@example.test");
    const csrfResponse = await app.inject({
      method: "POST",
      url: "/sites",
      headers: { cookie: session, origin: "https://attacker.example" },
      payload: { name: "Blocked site", location: "Manila", policy },
    });
    expect(csrfResponse.statusCode).toBe(403);
    expect(JSON.parse(csrfResponse.body).error).toBe("CSRF_ORIGIN_REJECTED");
    const missingOriginResponse = await app.inject({
      method: "POST",
      url: "/sites",
      headers: { cookie: session },
      payload: { name: "Blocked site", location: "Manila", policy },
    });
    expect(missingOriginResponse.statusCode).toBe(403);

    const legacyResponse = await app.inject({
      method: "POST",
      url: "/release/consume",
      payload: { intent: {}, signature: "0x00" },
    });
    expect(legacyResponse.statusCode).toBe(401);
    expect(JSON.parse(legacyResponse.body).error).toBe("AUTH_REQUIRED");

    const authenticatedLegacyResponse = await app.inject({
      method: "POST",
      url: "/release/consume",
      headers: sessionHeaders(session),
      payload: { intent: {}, signature: "0x00" },
    });
    expect(authenticatedLegacyResponse.statusCode).toBe(503);
    await app.close();
  });

  test("does not fall back to the local evaluator when CRE is not configured", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const registered = store.registerAccount({
      email: "cre-required@example.test",
      password: "correct horse battery staple",
    });
    const site = store.createSite(registered.account.id, {
      name: "CRE required site",
      location: "Manila",
      policy,
    });
    const robot = store.createRobot(registered.account.id, site.id, { name: "AMR-CRE" });
    const build = store.createBuild(registered.account.id, site.id, {
      robotId: robot.id,
      version: "1.0.0",
      label: "CRE candidate",
      artifactDigest: `sha256:${"ef".repeat(32)}`,
      route: {
        start: { xMm: 100, yMm: 100 },
        end: { xMm: 900, yMm: 100 },
        speedMmPerSecond: 400,
      },
    });
    const app = buildServer({ applicationStore: store });
    const response = await app.inject({
      method: "POST",
      url: "/evaluations",
      headers: sessionHeaders(ApplicationStore.sessionCookie(registered.sessionToken, false)),
      payload: { siteId: site.id, robotId: robot.id, buildId: build.id },
    });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toBe("CRE_UNAVAILABLE");
    await app.close();
  });

  test("persists simulation provenance that the existing clearance path can consume", async () => {
    const store = new ApplicationStore({ dbPath: ":memory:", policyKey: KEY });
    const registered = store.registerAccount({
      email: "simulation-provenance@example.test",
      password: "correct horse battery staple",
    });
    const site = store.createSite(registered.account.id, {
      name: "Simulation site",
      location: "Manila",
      policy,
    });
    const robot = store.createRobot(registered.account.id, site.id, { name: "AMR-SIM" });
    const build = store.createBuild(registered.account.id, site.id, {
      robotId: robot.id,
      version: "1.0.0",
      label: "Simulation candidate",
      artifactDigest: `sha256:${"12".repeat(32)}`,
      route: {
        start: { xMm: 100, yMm: 100 },
        end: { xMm: 900, yMm: 100 },
        speedMmPerSecond: 400,
      },
    });
    const evaluation = await store.evaluateBuild(registered.account.id, {
      siteId: site.id,
      robotId: robot.id,
      buildId: build.id,
      evaluationId: "evaluation:simulation-provenance",
      requestedAt: "1788547200",
      evaluatedAt: "1788547210",
      evaluate: async (input) => ({
        ...(await evaluateSimulation(input)),
        executionMode: "official-cre-cli-simulation" as const,
        creCliVersion: "1.32.0",
      }),
    });

    expect(evaluation.verdict).toBe("CLEAR");
    expect(evaluation.executionMode).toBe("official-cre-cli-simulation");
    expect(evaluation.creCliVersion).toBe("1.32.0");
    expect(store.getEvaluation(registered.account.id, evaluation.evaluationId)).toMatchObject({
      executionMode: "official-cre-cli-simulation",
      creCliVersion: "1.32.0",
    });
    const clearance = createClearanceRecordFromEvaluation(evaluation, {
      clearanceId: "clearance:simulation-provenance",
      issuedAt: "1788547210",
      expiresAt: "1788548200",
    });
    expect(clearance.verdict).toBe("CLEAR");
    expect(String(clearance.evaluationId)).toBe(evaluation.evaluationId);
    store.close();
  });
});
