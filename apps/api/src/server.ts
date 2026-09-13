import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ReleaseGateError } from "@rovaulta/chain-client";
import {
  parseEvaluationResultCallback,
  serializeEvaluationResultCallback,
} from "@rovaulta/chainlink-cre/protocol";
import { parseClearanceRecord } from "@rovaulta/domain";
import Fastify, { type FastifyReply } from "fastify";
import { type DeploymentAgent, DeploymentAgentError } from "./agent/index.js";
import { ApplicationError, ApplicationStore, type PublicEvaluation } from "./application/index.js";
import { type BuildRunner, BuildRunnerError } from "./build-integrity/index.js";
import { readEnvironment } from "./environment.js";
import { type ConfidentialEvaluationExecutor, CreEvaluationError } from "./evaluation/index.js";
import type { ReleaseService } from "./release/index.js";

function rejectMalformed(reply: FastifyReply) {
  return reply.code(400).send({ error: "MALFORMED_REQUEST", message: "Request body is malformed" });
}

function callbackSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function validCallbackSignature(secret: string, body: string, header: unknown): boolean {
  if (typeof header !== "string" || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(callbackSignature(secret, body), "utf8");
  const actual = Buffer.from(header, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function expectBody(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (keys.some((key) => !Object.hasOwn(record, key))) return null;
  return record;
}

function clearanceMatchesEvaluation(
  input: unknown,
  evaluation: {
    readonly evaluationId: string;
    readonly siteId: string;
    readonly robotId: string;
    readonly robotBuildId: string;
    readonly robotBuildDigest: string;
    readonly safetyEnvelopeId: string;
    readonly safetyEnvelopeCommitment: string;
    readonly evaluatorVersion: string;
    readonly evaluationInputsDigest: string;
  },
): { readonly ok: true } | { readonly ok: false; readonly code: "MALFORMED" | "MISMATCH" } {
  let clearance: ReturnType<typeof parseClearanceRecord>;
  try {
    clearance = parseClearanceRecord(input);
  } catch {
    return { ok: false, code: "MALFORMED" };
  }
  const matches =
    clearance.evaluationId === evaluation.evaluationId &&
    clearance.inputs.siteId === evaluation.siteId &&
    clearance.inputs.robotId === evaluation.robotId &&
    clearance.inputs.robotBuildId === evaluation.robotBuildId &&
    clearance.inputs.robotBuildDigest === evaluation.robotBuildDigest &&
    clearance.inputs.safetyEnvelopeId === evaluation.safetyEnvelopeId &&
    clearance.inputs.safetyEnvelopeCommitment === evaluation.safetyEnvelopeCommitment &&
    clearance.inputs.evaluatorVersion === evaluation.evaluatorVersion &&
    clearance.evaluationInputsDigest === evaluation.evaluationInputsDigest;
  return matches ? { ok: true } : { ok: false, code: "MISMATCH" };
}

export function buildServer(
  options: {
    releaseService?: ReleaseService;
    deploymentAgent?: DeploymentAgent;
    applicationStore?: ApplicationStore;
    evaluationExecutor?: ConfidentialEvaluationExecutor;
    buildRunner?: BuildRunner;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const app = Fastify({
    logger: {
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });
  const releaseService = options.releaseService;
  const deploymentAgent = options.deploymentAgent;
  const applicationStore = options.applicationStore;
  const buildRunner = options.buildRunner;
  // P2 is never an application fallback. Tests may inject it explicitly; the production entrypoint
  // always supplies the CRE transport. Missing CRE configuration therefore fails closed.
  const evaluationExecutor: ConfidentialEvaluationExecutor = options.evaluationExecutor ?? {
    evaluate: async () => {
      throw new CreEvaluationError("CRE_UNAVAILABLE", "Confidential evaluation is not configured");
    },
  };
  const environment = options.environment ?? process.env;
  const creCallbackSecret = readEnvironment(
    environment,
    "ROVAULTA_CRE_RESULT_CALLBACK_SECRET",
  )?.trim();
  const allowedOrigins = new Set(
    [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      readEnvironment(environment, "ROVAULTA_WEB_ORIGIN"),
      environment.WEB_ORIGIN,
    ].filter((origin): origin is string => typeof origin === "string" && origin.length > 0),
  );
  function isAllowedOrigin(origin: string): boolean {
    if (allowedOrigins.has(origin)) return true;
    try {
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
      if (
        url.hostname.endsWith(".vercel.app") &&
        (url.protocol === "https:" || url.protocol === "http:")
      ) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  function isTrustedMutationOrigin(request: {
    readonly headers: {
      readonly origin?: string | undefined;
      readonly referer?: string | undefined;
      readonly cookie?: string | undefined;
      readonly authorization?: string | undefined;
    };
  }): boolean {
    const origin = request.headers.origin;
    if (origin !== undefined) return isAllowedOrigin(origin);
    const referer = request.headers.referer;
    if (referer !== undefined) {
      try {
        return isAllowedOrigin(new URL(referer).origin);
      } catch {
        return false;
      }
    }
    return request.headers.cookie === undefined && request.headers.authorization === undefined;
  }
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST" || isTrustedMutationOrigin(request)) return;
    return reply
      .code(403)
      .send({ error: "CSRF_ORIGIN_REJECTED", message: "Request origin is not allowed" });
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const origin = request.headers.origin;
    if (origin !== undefined && isAllowedOrigin(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "content-type, authorization");
      reply.header("Vary", "Origin");
    }
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.options("/*", async (request, reply) => {
    if (request.headers.origin !== undefined && isAllowedOrigin(request.headers.origin)) {
      reply.header("Access-Control-Allow-Origin", request.headers.origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "content-type, authorization");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    return reply.code(204).send();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ReleaseGateError) {
      const status =
        error.code === "REPLAY_REJECTED"
          ? 409
          : error.code === "MALFORMED_REQUEST"
            ? 400
            : error.code === "REGISTRY_UNAVAILABLE" || error.code === "PERSISTENCE_UNAVAILABLE"
              ? 503
              : 403;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    if (error instanceof DeploymentAgentError) {
      const status =
        error.code === "PROVIDER_UNAVAILABLE" || error.code === "GRAPH_UNAVAILABLE" ? 503 : 400;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    if (error instanceof CreEvaluationError) {
      return reply.code(503).send({ error: error.code, message: error.message });
    }
    if (error instanceof ApplicationError) {
      const status =
        error.code === "AUTH_REQUIRED" || error.code === "INVALID_CREDENTIALS"
          ? 401
          : error.code === "DUPLICATE_ACCOUNT" ||
              error.code === "CONFLICT" ||
              error.code === "BUILD_NOT_READY" ||
              error.code === "BUILD_FAILED"
            ? 409
            : error.code === "NOT_FOUND"
              ? 404
              : error.code === "FORBIDDEN"
                ? 403
                : error.code === "POLICY_UNAVAILABLE" ||
                    error.code === "EVALUATION_UNAVAILABLE" ||
                    error.code === "PERSISTENCE_UNAVAILABLE"
                  ? 503
                  : 400;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    return reply.code(400).send({ error: "MALFORMED_REQUEST", message: "Request failed closed" });
  });
  app.get("/health", async () => ({
    status: "ok",
    phase: "p5.2-ai-deployment-agent",
    releaseGateConfigured: releaseService !== undefined,
    deploymentAgentConfigured: deploymentAgent !== undefined,
  }));

  function requireStore(): ApplicationStore {
    if (applicationStore === undefined) {
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Application persistence is not configured",
      );
    }
    return applicationStore;
  }

  function demoRoutesEnabled(): boolean {
    return (
      environment.NODE_ENV !== "production" &&
      readEnvironment(environment, "ROVAULTA_ENABLE_DEMO_ROUTES") === "true"
    );
  }

  function extractSessionToken(request: {
    readonly headers: {
      readonly cookie?: string | undefined;
      readonly authorization?: string | undefined;
    };
  }): string | null {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token.length >= 16) return token;
    }
    return ApplicationStore.readSessionCookie(request.headers.cookie);
  }

  function requireAccount(
    request: { headers: { cookie?: string | undefined; authorization?: string | undefined } },
    reply: FastifyReply,
  ): string | null {
    const store = requireStore();
    const token = extractSessionToken(request);
    const account = store.accountForSession(token);
    if (account === null) {
      reply.code(401).send({ error: "AUTH_REQUIRED", message: "Sign in to continue" });
      return null;
    }
    return account.id;
  }

  function requireLegacyAccess(
    request: {
      readonly headers: {
        readonly cookie?: string | undefined;
        readonly authorization?: string | undefined;
      };
    },
    reply: FastifyReply,
  ): boolean {
    if (demoRoutesEnabled()) return true;
    if (applicationStore === undefined) {
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Authenticated application persistence is required for this route",
      );
    }
    return requireAccount(request, reply) !== null;
  }

  app.post("/auth/register", async (request, reply) => {
    const store = requireStore();
    const body = expectBody(request.body, ["email", "password"]);
    if (body === null) return rejectMalformed(reply);
    const result = store.registerAccount({ email: body.email, password: body.password });
    reply.header(
      "Set-Cookie",
      ApplicationStore.sessionCookie(result.sessionToken, environment.NODE_ENV === "production"),
    );
    return reply.code(201).send({ account: result.account, sessionToken: result.sessionToken });
  });

  app.post("/auth/sign-in", async (request, reply) => {
    const store = requireStore();
    const body = expectBody(request.body, ["email", "password"]);
    if (body === null) return rejectMalformed(reply);
    const result = store.signIn({ email: body.email, password: body.password });
    reply.header(
      "Set-Cookie",
      ApplicationStore.sessionCookie(result.sessionToken, environment.NODE_ENV === "production"),
    );
    return reply.send({ account: result.account, sessionToken: result.sessionToken });
  });

  app.post("/auth/sign-out", async (request, reply) => {
    const store = requireStore();
    store.revokeSession(extractSessionToken(request));
    reply.header(
      "Set-Cookie",
      ApplicationStore.clearSessionCookie(environment.NODE_ENV === "production"),
    );
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const store = requireStore();
    const account = store.accountForSession(extractSessionToken(request));
    if (account === null)
      return reply.code(401).send({ error: "AUTH_REQUIRED", message: "Sign in to continue" });
    return reply.send({ account });
  });

  app.get("/sites", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    return accountId === null ? undefined : { sites: requireStore().listSites(accountId) };
  });

  app.post("/sites", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const body = expectBody(request.body, ["name", "location", "policy"]);
    if (body === null) return rejectMalformed(reply);
    const site = requireStore().createSite(accountId, {
      name: body.name,
      location: body.location,
      policy: body.policy,
    });
    return reply.code(201).send({ site });
  });

  app.get("/sites/:siteId", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    return { site: requireStore().getSite(accountId, params.siteId) };
  });

  app.get("/sites/:siteId/robots", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    return { robots: requireStore().listRobots(accountId, params.siteId) };
  });

  app.post("/sites/:siteId/robots", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    const body = expectBody(request.body, ["name"]);
    if (body === null) return rejectMalformed(reply);
    return reply
      .code(201)
      .send({ robot: requireStore().createRobot(accountId, params.siteId, { name: body.name }) });
  });

  app.get("/sites/:siteId/builds", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    return { builds: requireStore().listBuilds(accountId, params.siteId) };
  });

  app.post("/sites/:siteId/builds", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    const body = expectBody(request.body, [
      "robotId",
      "version",
      "label",
      "artifactDigest",
      "route",
    ]);
    if (body === null) return rejectMalformed(reply);
    return reply.code(201).send({
      build: requireStore().createBuild(accountId, params.siteId, {
        robotId: body.robotId,
        version: body.version,
        label: body.label,
        artifactDigest: body.artifactDigest,
        route: body.route,
      }),
    });
  });

  app.post("/sites/:siteId/source-builds", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { siteId?: unknown };
    if (typeof params.siteId !== "string") return rejectMalformed(reply);
    const body = expectBody(request.body, [
      "robotId",
      "version",
      "label",
      "sourceRepository",
      "sourceRevision",
      "buildCommand",
      "runtime",
      "route",
    ]);
    if (body === null) return rejectMalformed(reply);
    const store = requireStore();
    const build = store.createSourceBuild(accountId, params.siteId, {
      robotId: body.robotId,
      version: body.version,
      label: body.label,
      sourceRepository: body.sourceRepository,
      sourceRevision: body.sourceRevision,
      buildCommand: body.buildCommand,
      runtime: body.runtime,
      route: body.route,
    });
    if (buildRunner === undefined) {
      return reply.code(202).send({
        build: store.failSourceBuild(
          accountId,
          build.id,
          "BUILD_RUNNER_UNAVAILABLE",
          "The source build runner is not configured",
        ),
      });
    }
    void (async () => {
      try {
        const result = await buildRunner.run({
          buildId: build.id,
          sourceRepository: body.sourceRepository as string,
          sourceRevision: body.sourceRevision as string,
          buildCommand: body.buildCommand as string,
          runtime: body.runtime as "bun" | "node",
        });
        await store.completeSourceBuild(accountId, build.id, result);
      } catch (error) {
        const code =
          error instanceof BuildRunnerError
            ? error.code
            : error instanceof ApplicationError && error.code === "BUILD_FAILED"
              ? error.code
              : "SANDBOX_FAILED";
        const message =
          error instanceof BuildRunnerError || error instanceof ApplicationError
            ? error.message
            : "Source build failed";
        try {
          store.failSourceBuild(accountId, build.id, code, message);
        } catch {
          // The build record is already immutable from the caller's perspective; do not leak
          // asynchronous persistence details into the request response.
        }
      }
    })();
    return reply.code(202).send({ build });
  });

  app.get("/evaluations", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    return accountId === null
      ? undefined
      : { evaluations: requireStore().listEvaluations(accountId) };
  });

  app.post("/evaluations", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const body = expectBody(request.body, ["siteId", "robotId", "buildId"]);
    if (
      body === null ||
      typeof body.siteId !== "string" ||
      typeof body.robotId !== "string" ||
      typeof body.buildId !== "string"
    )
      return rejectMalformed(reply);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const evaluationId = `evaluation:${randomBytes(16).toString("hex")}`;
    let evaluation: PublicEvaluation;
    try {
      evaluation = await requireStore().evaluateBuild(accountId, {
        siteId: body.siteId,
        robotId: body.robotId,
        buildId: body.buildId,
        evaluationId,
        requestedAt: timestamp,
        evaluatedAt: timestamp,
        evaluate: (input) => evaluationExecutor.evaluate(input),
      });
    } catch (error) {
      if (error instanceof CreEvaluationError && error.code === "CRE_EVALUATION_PENDING") {
        return reply.code(202).send({
          status: "PENDING",
          evaluationId,
          ...(error.executionId === undefined ? {} : { creExecutionId: error.executionId }),
        });
      }
      throw error;
    }
    return reply.code(201).send({ evaluation });
  });

  app.post("/internal/cre/evaluation-result", async (request, reply) => {
    if (creCallbackSecret === undefined || creCallbackSecret.length === 0) {
      return reply.code(503).send({
        error: "CRE_CALLBACK_UNAVAILABLE",
        message: "CRE result callback is not configured",
      });
    }
    const signature = request.headers["x-rovaulta-cre-signature"];
    let callback: ReturnType<typeof parseEvaluationResultCallback>;
    try {
      callback = parseEvaluationResultCallback(request.body);
    } catch {
      return reply
        .code(400)
        .send({ error: "CRE_CALLBACK_INVALID", message: "CRE result callback is malformed" });
    }
    const body = serializeEvaluationResultCallback(callback);
    if (!validCallbackSignature(creCallbackSecret, body, signature)) {
      return reply.code(401).send({
        error: "CRE_CALLBACK_UNAUTHORIZED",
        message: "CRE result callback signature is invalid",
      });
    }
    const completion = requireStore().completeCreEvaluation(callback);
    if (completion.status === "REJECTED") {
      return reply.send({ status: completion.status, code: completion.code });
    }
    return reply.send({ status: completion.status });
  });

  app.get("/evaluations/:evaluationId", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const params = request.params as { evaluationId?: unknown };
    if (typeof params.evaluationId !== "string") return rejectMalformed(reply);
    const status = requireStore().getEvaluationStatus(accountId, params.evaluationId);
    if ("status" in status && status.status === "PENDING") {
      return reply.code(202).send(status);
    }
    return { evaluation: status };
  });

  app.get("/releases", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    return accountId === null
      ? undefined
      : { releases: requireStore().listReleaseAttempts(accountId) };
  });

  app.post("/releases/prepare", async (request, reply) => {
    const accountId = requireAccount(request, reply);
    if (accountId === null) return undefined;
    const body = expectBody(request.body, ["evaluationId", "signerAddress", "clearance"]);
    if (
      body === null ||
      typeof body.evaluationId !== "string" ||
      typeof body.signerAddress !== "string"
    )
      return rejectMalformed(reply);
    const store = requireStore();
    const evaluation = store.getEvaluation(accountId, body.evaluationId);
    if (evaluation.verdict !== "CLEAR") {
      const attempt = store.recordReleaseAttempt(accountId, {
        evaluationId: evaluation.evaluationId,
        status: "BLOCKED",
        code: "EVALUATION_NOT_CLEAR",
        message: "Only a CLEAR evaluation can prepare a release",
      });
      return reply
        .code(409)
        .send({ error: "EVALUATION_NOT_CLEAR", message: attempt.message, attempt });
    }
    if (body.clearance === null || typeof body.clearance !== "object") {
      const attempt = store.recordReleaseAttempt(accountId, {
        evaluationId: evaluation.evaluationId,
        status: "BLOCKED",
        code: "CLEARANCE_NOT_AVAILABLE",
        message: "A public P4 clearance record is required before release preparation",
      });
      return reply
        .code(409)
        .send({ error: "CLEARANCE_NOT_AVAILABLE", message: attempt.message, attempt });
    }
    const clearanceBinding = clearanceMatchesEvaluation(body.clearance, evaluation);
    if (!clearanceBinding.ok) {
      const attempt = store.recordReleaseAttempt(accountId, {
        evaluationId: evaluation.evaluationId,
        status: "BLOCKED",
        code:
          clearanceBinding.code === "MALFORMED"
            ? "CLEARANCE_MALFORMED"
            : "CLEARANCE_BINDING_MISMATCH",
        message:
          clearanceBinding.code === "MALFORMED"
            ? "The public clearance record is malformed"
            : "The public clearance does not match this exact evaluation",
      });
      return reply
        .code(clearanceBinding.code === "MALFORMED" ? 400 : 409)
        .send({ error: attempt.code, message: attempt.message, attempt });
    }
    if (deploymentAgent === undefined) {
      const attempt = store.recordReleaseAttempt(accountId, {
        evaluationId: evaluation.evaluationId,
        status: "BLOCKED",
        code: "DEPLOYMENT_AGENT_UNAVAILABLE",
        message: "The account-backed deployment agent is not configured",
      });
      return reply.code(503).send({
        error: "DEPLOYMENT_AGENT_UNAVAILABLE",
        message: attempt.message,
        attempt,
      });
    }
    const agentResult = await deploymentAgent.run({
      request: `Deploy ${evaluation.robotBuildId} for ${evaluation.robotId} to ${evaluation.siteId}`,
      signerAddress: body.signerAddress,
      accountId,
      clearance: body.clearance,
    });
    if (agentResult.status === "BLOCKED") {
      const code = agentResult.audit.policyResult;
      const attempt = store.recordReleaseAttempt(accountId, {
        evaluationId: evaluation.evaluationId,
        status: "BLOCKED",
        code,
        message: agentResult.explanation,
      });
      const status =
        code === "GRAPH_UNAVAILABLE" || code.startsWith("PROVIDER_") || code.startsWith("CRE_")
          ? 503
          : 409;
      return reply.code(status).send({
        error: code,
        message: attempt.message,
        attempt,
        audit: agentResult.audit,
      });
    }
    const agentAttempt = store.recordReleaseAttempt(accountId, {
      evaluationId: evaluation.evaluationId,
      status: agentResult.status,
      code: null,
      message: agentResult.explanation,
    });
    return reply.send({
      status: agentResult.status,
      attempt: agentAttempt,
      audit: agentResult.audit,
      ...(agentResult.prepared === undefined ? {} : { prepared: agentResult.prepared }),
    });
  });
  app.post("/agent/deployment/prepare", async (request, reply) => {
    if (!requireLegacyAccess(request, reply)) return undefined;
    if (deploymentAgent === undefined) {
      throw new DeploymentAgentError("PROVIDER_UNAVAILABLE", "Deployment agent is not configured");
    }
    const demoRoute = demoRoutesEnabled();
    const body = expectBody(
      request.body,
      demoRoute
        ? ["request", "signerAddress"]
        : ["request", "signerAddress", "evaluationId", "clearance"],
    );
    if (
      body === null ||
      typeof body.request !== "string" ||
      typeof body.signerAddress !== "string"
    ) {
      return rejectMalformed(reply);
    }
    if (demoRoute) {
      return deploymentAgent.run({ request: body.request, signerAddress: body.signerAddress });
    }
    const accountId = requireAccount(request, reply);
    if (accountId === null || typeof body.evaluationId !== "string") return undefined;
    requireStore().getDeploymentContext(accountId, body.evaluationId, body.clearance);
    return deploymentAgent.run({
      request: body.request,
      signerAddress: body.signerAddress,
      accountId,
      clearance: body.clearance,
    });
  });
  app.post("/agent/deployment/status", async (request, reply) => {
    if (!requireLegacyAccess(request, reply)) return undefined;
    if (deploymentAgent === undefined) {
      throw new DeploymentAgentError("PROVIDER_UNAVAILABLE", "Deployment agent is not configured");
    }
    const body = expectBody(request.body, ["attemptId"]);
    if (body === null || typeof body.attemptId !== "string") return rejectMalformed(reply);
    const accountId =
      environment.NODE_ENV !== "production" &&
      readEnvironment(environment, "ROVAULTA_ENABLE_DEMO_ROUTES") === "true"
        ? undefined
        : requireAccount(request, reply);
    if (accountId === null) return undefined;
    return deploymentAgent.getAuthorizationStatus(body.attemptId, accountId);
  });
  app.post("/release/prepare", async (request, reply) => {
    const demoRoute = demoRoutesEnabled();
    const accountId = demoRoute ? undefined : requireAccount(request, reply);
    if (accountId === null) return undefined;
    if (releaseService === undefined) {
      throw new ReleaseGateError("PERSISTENCE_UNAVAILABLE", "Release gate is not configured");
    }
    const body = expectBody(request.body, [
      "siteId",
      "robotId",
      "robotBuildId",
      "robotBuildDigest",
      "clearance",
      "signerAddress",
    ]);
    if (body === null || typeof body.signerAddress !== "string") return rejectMalformed(reply);
    let clearance = body.clearance;
    if (accountId !== undefined) {
      let parsedClearance: ReturnType<typeof parseClearanceRecord>;
      try {
        parsedClearance = parseClearanceRecord(body.clearance);
      } catch {
        return rejectMalformed(reply);
      }
      requireStore().getDeploymentContext(accountId, parsedClearance.evaluationId, parsedClearance);
      clearance = parsedClearance;
    }
    return releaseService.prepare({
      siteId: body.siteId,
      robotId: body.robotId,
      robotBuildId: body.robotBuildId,
      robotBuildDigest: body.robotBuildDigest,
      clearance,
      signerAddress: body.signerAddress,
      ...(accountId === undefined ? {} : { accountId }),
    });
  });
  app.post("/release/consume", async (request, reply) => {
    const demoRoute = demoRoutesEnabled();
    const accountId = demoRoute ? undefined : requireAccount(request, reply);
    if (accountId === null) return undefined;
    if (releaseService === undefined) {
      throw new ReleaseGateError("PERSISTENCE_UNAVAILABLE", "Release gate is not configured");
    }
    const body = expectBody(request.body, ["intent", "signature"]);
    if (body === null) return rejectMalformed(reply);
    return releaseService.consume({
      intent: body.intent,
      signature: body.signature,
      ...(accountId === undefined ? {} : { accountId }),
    });
  });
  if (releaseService !== undefined) {
    app.addHook("onClose", async () => releaseService.close());
  }
  if (applicationStore !== undefined) {
    app.addHook("onClose", async () => applicationStore.close());
  }
  return app;
}
