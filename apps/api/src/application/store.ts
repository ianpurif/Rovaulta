import { Database } from "bun:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  CRE_CONFIDENTIAL_INPUT_VERSION,
  CRE_PUBLIC_REQUEST_VERSION,
  type CreEvaluationResultCallback,
  digestBehaviorInput,
  SYNTHETIC_TRACE_PROVENANCE,
  siteSecretId,
} from "@rovaulta/chainlink-cre/protocol";
import {
  assertEvaluationResultBindings,
  type BuildIntegrityEvidence,
  type BuildProvenanceStatement,
  canonicalSerialize,
  digestBuildIntegrity,
  digestRobotBuild,
  digestSafetyEnvelopeCommitment,
  EVALUATION_INPUTS_SCHEMA_VERSION,
  EVALUATION_REQUEST_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  ProtocolError,
  parseBuildIntegrityEvidence,
  parseClearanceRecord,
  parseEvaluationRequest,
  parseEvaluatorVersionId,
  parseRobotBuildDescriptor,
  parseSafetyEnvelopeId,
  parseSha256Digest,
  parseSiteId,
  parseUnixTimestamp,
  ROBOT_BUILD_SCHEMA_VERSION,
  type RobotBuildDescriptor,
  SOURCE_ROBOT_BUILD_SCHEMA_VERSION,
} from "@rovaulta/domain";
import {
  CONFIDENTIAL_EVALUATION_ENVELOPE_VERSION,
  type ConfidentialEvaluationEnvelope,
  confidentialEnvelopeCommitmentPayload,
  parseConfidentialEvaluationEnvelope,
  parsePointMm,
  parseRobotBehaviorTraceSuite,
  ROBOT_TRACE_SUITE_VERSION,
  type RobotBehaviorTraceSuite,
  SCENARIO_GENERATOR_VERSION,
  WAREHOUSE_EVALUATOR_VERSION,
} from "@rovaulta/simulation-core";
import type {
  BuildRunnerResult,
  SourceBuildRuntime,
} from "../build-integrity/index.js";
import type {
  ConfidentialEvaluationInput,
  ConfidentialEvaluationReport,
  EvaluationExecutionMode,
} from "../evaluation/index.js";
import { ApplicationError } from "./errors.js";
import {
  isPasswordLengthValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password-policy.js";

const SESSION_COOKIE = "rovaulta_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const POLICY_CIPHERTEXT_VERSION = "rovaulta.policy-ciphertext/v1" as const;
const ACCOUNT_ID_PATTERN = /^account:[a-f0-9]{32}$/;
const MAX_STORED_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_BUILDING_SOURCE_BUILDS_PER_ACCOUNT = 2;

export interface PublicAccount {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

export interface PolicyInput {
  readonly warehouseWidthMm: number;
  readonly warehouseHeightMm: number;
  readonly restrictedZone: Readonly<{
    readonly minXmm: number;
    readonly minYmm: number;
    readonly maxXmm: number;
    readonly maxYmm: number;
  }>;
  readonly maximumSpeedMmPerSecond: number;
  readonly zoneSpeedLimitMmPerSecond: number;
  readonly payloadThresholdGrams: number;
}

export interface PublicSite {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly safetyEnvelopeId: string;
  readonly safetyEnvelopeCommitment: string;
  readonly createdAt: string;
}

export interface PublicRobot {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface PublicBuild {
  readonly id: string;
  readonly siteId: string;
  readonly robotId: string;
  readonly version: string;
  readonly label: string;
  readonly buildMode: "EXISTING" | "SOURCE";
  readonly buildStatus: "BUILDING" | "BUILD_SUCCEEDED" | "BUILD_FAILED";
  readonly artifactDigest: string | null;
  readonly robotBuildDigest: string | null;
  readonly sourceRepository: string | null;
  readonly sourceRevision: string | null;
  readonly sourceSnapshotDigest: string | null;
  readonly buildCommand: string | null;
  readonly lockfileDigest: string | null;
  readonly builder: Readonly<{
    readonly id: string;
    readonly version: string;
  }> | null;
  readonly runtime: Readonly<{
    readonly name: "bun" | "node";
    readonly version: string;
    readonly image: string;
  }> | null;
  readonly provenance: BuildProvenanceStatement | null;
  readonly buildErrorCode: string | null;
  readonly buildErrorMessage: string | null;
  readonly route: Readonly<{
    readonly start: Readonly<{ readonly xMm: number; readonly yMm: number }>;
    readonly end: Readonly<{ readonly xMm: number; readonly yMm: number }>;
    readonly speedMmPerSecond: number;
  }>;
  readonly createdAt: string;
}

export interface PublicEvaluation {
  readonly id: string;
  readonly siteId: string;
  readonly robotId: string;
  readonly buildId: string;
  readonly evaluationId: string;
  readonly robotBuildId: string;
  readonly verdict: "CLEAR" | "HOLD" | "ESCALATE";
  readonly safetyEnvelopeId: string;
  readonly evaluatorVersion: string;
  readonly robotBuildDigest: string;
  readonly safetyEnvelopeCommitment: string;
  readonly evaluationInputsDigest: string;
  readonly scenarioCount: number | null;
  readonly violationCount: number | null;
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
  /** Public execution provenance; absent only on legacy rows created before P13.1. */
  readonly executionMode?: EvaluationExecutionMode;
  readonly creCliVersion?: string;
}

export interface PublicEvaluationPending {
  readonly status: "PENDING";
  readonly evaluationId: string;
  readonly siteId: string;
  readonly robotId: string;
  readonly buildId: string;
  readonly requestedAt: string;
}

export interface PublicReleaseAttempt {
  readonly id: string;
  readonly evaluationId: string;
  readonly status:
    | "PREPARED"
    | "LEDGER_APPROVAL_REQUIRED"
    | "AUTHORIZED"
    | "BLOCKED";
  readonly code: string | null;
  readonly message: string;
  readonly createdAt: string;
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

interface SessionRow {
  account_id: string;
  expires_at: string;
}

interface SiteRow {
  id: string;
  account_id: string;
  name: string;
  location: string;
  safety_envelope_id: string;
  safety_envelope_commitment: string;
  policy_ciphertext: string;
  created_at: string;
}

interface RobotRow {
  id: string;
  account_id: string;
  site_id: string;
  name: string;
  created_at: string;
}

interface BuildRow {
  id: string;
  account_id: string;
  site_id: string;
  robot_id: string;
  version: string;
  label: string;
  descriptor_json: string;
  trace_json: string;
  route_json: string;
  created_at: string;
}

type SourceBuildStatus = "BUILDING" | "BUILD_SUCCEEDED" | "BUILD_FAILED";

interface BuildIntegrityRow {
  build_id: string;
  account_id: string;
  site_id: string;
  robot_id: string;
  source_repository: string;
  source_revision: string;
  build_command: string;
  runtime: SourceBuildRuntime;
  status: SourceBuildStatus;
  artifact_path: string | null;
  integrity_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface EvaluationRow {
  id: string;
  account_id: string;
  site_id: string;
  robot_id: string;
  build_id: string;
  public_json: string;
  created_at: string;
}

interface PendingEvaluationRow {
  evaluation_id: string;
  account_id: string;
  site_id: string;
  robot_id: string;
  build_id: string;
  behavior_input_digest: string;
  requested_at: string;
  created_at: string;
}

interface CreEvaluationRejectionRow {
  evaluation_id: string;
  account_id: string;
  code: string;
  callback_digest: string;
  created_at: string;
}

interface ReleaseAttemptRow {
  id: string;
  account_id: string;
  evaluation_id: string;
  status: PublicReleaseAttempt["status"];
  code: string | null;
  message: string;
  created_at: string;
}

interface PersistedPolicy {
  readonly version: typeof POLICY_CIPHERTEXT_VERSION;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

interface DecryptedPolicy {
  readonly envelope: ConfidentialEvaluationEnvelope;
  readonly blind: Uint8Array;
}

export interface OperatorConfidentialEvaluationSecret {
  readonly selector: string;
  readonly value: string;
}

function nowSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

async function hashStoredArtifact(
  path: string,
): Promise<ReturnType<typeof parseSha256Digest>> {
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_STORED_ARTIFACT_BYTES)
        throw new Error("artifact is too large");
      hash.update(bytes);
    }
  } catch {
    throw new ApplicationError(
      "BUILD_FAILED",
      "The produced artifact could not be verified",
    );
  }
  if (size === 0)
    throw new ApplicationError(
      "BUILD_FAILED",
      "The produced artifact is empty",
    );
  return parseSha256Digest(`sha256:${hash.digest("hex")}`);
}

function id(prefix: string): string {
  return `${prefix}:${randomBytes(16).toString("hex")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function creCallbackDigest(callback: CreEvaluationResultCallback): string {
  return createHash("sha256")
    .update(canonicalSerialize(callback), "utf8")
    .digest("hex");
}

function normalizeEmail(input: unknown): string {
  if (typeof input !== "string")
    throw new ApplicationError("INVALID_INPUT", "Email is required");
  const email = input.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new ApplicationError("INVALID_INPUT", "Enter a valid email address");
  }
  return email;
}

function validatePassword(input: unknown): string {
  if (typeof input !== "string" || !isPasswordLengthValid(input)) {
    throw new ApplicationError(
      "INVALID_INPUT",
      `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  return input;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltEncoded, digestEncoded] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    saltEncoded === undefined ||
    digestEncoded === undefined
  )
    return false;
  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(digestEncoded, "base64url");
    const actual = scryptSync(password, salt, expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

function canonicalPolicyKey(input: Uint8Array | undefined): Uint8Array {
  if (input === undefined || input.length !== 32) {
    throw new ApplicationError(
      "POLICY_UNAVAILABLE",
      "A 32-byte policy encryption key is required",
    );
  }
  return Uint8Array.from(input);
}

function parseInteger(
  input: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input < minimum ||
    input > maximum
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return input;
}

function parseText(
  input: unknown,
  label: string,
  minimum = 1,
  maximum = 120,
): string {
  if (typeof input !== "string")
    throw new ApplicationError("INVALID_INPUT", `${label} is required`);
  const value = input.trim();
  if (value.length < minimum || value.length > maximum) {
    throw new ApplicationError(
      "INVALID_INPUT",
      `${label} must be ${minimum}-${maximum} characters`,
    );
  }
  return value;
}

function parsePoint(input: unknown, label: string) {
  try {
    return parsePointMm(input, label);
  } catch {
    throw new ApplicationError(
      "INVALID_INPUT",
      `${label} is not a valid point`,
    );
  }
}

function parsePolicy(input: unknown): PolicyInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ApplicationError("INVALID_INPUT", "Safety policy is required");
  }
  const record = input as Record<string, unknown>;
  const keys = [
    "warehouseWidthMm",
    "warehouseHeightMm",
    "restrictedZone",
    "maximumSpeedMmPerSecond",
    "zoneSpeedLimitMmPerSecond",
    "payloadThresholdGrams",
  ] as const;
  if (
    Object.keys(record).some(
      (key) => !keys.includes(key as (typeof keys)[number]),
    )
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Safety policy contains an unsupported field",
    );
  }
  const zone = record.restrictedZone;
  if (zone === null || typeof zone !== "object" || Array.isArray(zone)) {
    throw new ApplicationError("INVALID_INPUT", "Restricted zone is required");
  }
  const zoneRecord = zone as Record<string, unknown>;
  const zoneKeys = ["minXmm", "minYmm", "maxXmm", "maxYmm"] as const;
  if (
    Object.keys(zoneRecord).some(
      (key) => !zoneKeys.includes(key as (typeof zoneKeys)[number]),
    )
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Restricted zone contains an unsupported field",
    );
  }
  const width = parseInteger(
    record.warehouseWidthMm,
    "Warehouse width",
    1_000,
    10_000_000,
  );
  const height = parseInteger(
    record.warehouseHeightMm,
    "Warehouse height",
    1_000,
    10_000_000,
  );
  const parsedZone = {
    minXmm: parseInteger(
      zoneRecord.minXmm,
      "Restricted zone minXmm",
      0,
      width - 1,
    ),
    minYmm: parseInteger(
      zoneRecord.minYmm,
      "Restricted zone minYmm",
      0,
      height - 1,
    ),
    maxXmm: parseInteger(zoneRecord.maxXmm, "Restricted zone maxXmm", 1, width),
    maxYmm: parseInteger(
      zoneRecord.maxYmm,
      "Restricted zone maxYmm",
      1,
      height,
    ),
  } as const;
  if (
    parsedZone.minXmm >= parsedZone.maxXmm ||
    parsedZone.minYmm >= parsedZone.maxYmm
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Restricted zone must have positive dimensions",
    );
  }
  return Object.freeze({
    warehouseWidthMm: width,
    warehouseHeightMm: height,
    restrictedZone: Object.freeze(parsedZone),
    maximumSpeedMmPerSecond: parseInteger(
      record.maximumSpeedMmPerSecond,
      "Maximum speed",
      1,
      1_000_000,
    ),
    zoneSpeedLimitMmPerSecond: parseInteger(
      record.zoneSpeedLimitMmPerSecond,
      "Zone speed limit",
      1,
      1_000_000,
    ),
    payloadThresholdGrams: parseInteger(
      record.payloadThresholdGrams,
      "Payload threshold",
      0,
      1_000_000_000,
    ),
  });
}

function buildEnvelope(
  siteId: string,
  safetyEnvelopeId: string,
  input: PolicyInput,
): ConfidentialEvaluationEnvelope {
  try {
    return parseConfidentialEvaluationEnvelope({
      schemaVersion: CONFIDENTIAL_EVALUATION_ENVELOPE_VERSION,
      siteId,
      safetyEnvelopeId,
      warehouseBounds: {
        minXmm: 0,
        minYmm: 0,
        maxXmm: input.warehouseWidthMm,
        maxYmm: input.warehouseHeightMm,
      },
      zones: [{ zoneId: "zone:restricted", bounds: input.restrictedZone }],
      rules: [
        {
          ruleId: "rule:restricted-zone",
          type: "restricted-zone",
          zoneId: "zone:restricted",
        },
        {
          ruleId: "rule:site-speed",
          type: "site-speed-limit",
          maximumMmPerSecond: input.maximumSpeedMmPerSecond,
        },
        {
          ruleId: "rule:zone-speed",
          type: "zone-speed-limit",
          zoneId: "zone:restricted",
          maximumMmPerSecond: input.zoneSpeedLimitMmPerSecond,
        },
        {
          ruleId: "rule:payload-zone",
          type: "payload-zone-restriction",
          zoneId: "zone:restricted",
          payloadGreaterThanGrams: input.payloadThresholdGrams,
        },
      ],
      scenarioGeneration: {
        generatorVersion: SCENARIO_GENERATOR_VERSION,
        seed: 0x5eed1234,
        templates: [
          {
            scenarioId: "scenario:restricted-route",
            basePayloadGrams: 20_000,
            payloadVariationGrams: 500,
          },
          {
            scenarioId: "scenario:human-zone-speed",
            basePayloadGrams: 25_000,
            payloadVariationGrams: 500,
          },
          {
            scenarioId: "scenario:heavy-payload-route",
            basePayloadGrams: 50_000,
            payloadVariationGrams: 500,
          },
        ],
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "INVALID_INPUT",
      "Safety policy could not be validated",
    );
  }
}

function encryptPolicy(value: DecryptedPolicy, key: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = canonicalSerialize({
    envelope: value.envelope,
    blind: Buffer.from(value.blind).toString("base64url"),
  });
  const ciphertext = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: POLICY_CIPHERTEXT_VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  } satisfies PersistedPolicy);
}

function decryptPolicy(encoded: string, key: Uint8Array): DecryptedPolicy {
  try {
    const stored = JSON.parse(encoded) as PersistedPolicy;
    if (stored.version !== POLICY_CIPHERTEXT_VERSION) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(stored.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as {
      envelope: unknown;
      blind: string;
    };
    const envelope = parseConfidentialEvaluationEnvelope(parsed.envelope);
    const blind = Uint8Array.from(Buffer.from(parsed.blind, "base64url"));
    if (blind.length !== 32) throw new Error();
    return Object.freeze({ envelope, blind });
  } catch {
    throw new ApplicationError(
      "POLICY_UNAVAILABLE",
      "Stored safety policy could not be opened",
    );
  }
}

function publicAccount(row: AccountRow): PublicAccount {
  return Object.freeze({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
  });
}

function publicSite(row: SiteRow): PublicSite {
  return Object.freeze({
    id: row.id,
    name: row.name,
    location: row.location,
    safetyEnvelopeId: row.safety_envelope_id,
    safetyEnvelopeCommitment: row.safety_envelope_commitment,
    createdAt: row.created_at,
  });
}

function publicRobot(row: RobotRow): PublicRobot {
  return Object.freeze({
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    createdAt: row.created_at,
  });
}

function buildTraceSuite(
  robotId: string,
  buildId: string,
  descriptor: RobotBuildDescriptor,
  start: Readonly<{ readonly xMm: number; readonly yMm: number }>,
  end: Readonly<{ readonly xMm: number; readonly yMm: number }>,
  speed: number,
): RobotBehaviorTraceSuite {
  return parseRobotBehaviorTraceSuite({
    schemaVersion: ROBOT_TRACE_SUITE_VERSION,
    robotId,
    robotBuildId: buildId,
    robotBuildDigest: digestRobotBuild(descriptor),
    traces: [
      "scenario:restricted-route",
      "scenario:human-zone-speed",
      "scenario:heavy-payload-route",
    ].map((scenarioId) => ({
      scenarioId,
      steps: [
        { stepIndex: 0, position: start, speedMmPerSecond: 0 },
        { stepIndex: 1, position: end, speedMmPerSecond: speed },
      ],
    })),
  });
}

const SOURCE_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE_BUILD_COMMAND_PATTERN =
  /^(?:bun|node|npm)(?:\s+[A-Za-z0-9_./:@=+-]+)*$/;

function parseSourceBuildInput(input: {
  readonly sourceRepository: unknown;
  readonly sourceRevision: unknown;
  readonly buildCommand: unknown;
  readonly runtime: unknown;
}): {
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly buildCommand: string;
  readonly runtime: SourceBuildRuntime;
} {
  if (typeof input.sourceRepository !== "string")
    throw new ApplicationError(
      "INVALID_INPUT",
      "Source repository is required",
    );
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.sourceRepository.trim());
  } catch {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Source repository must be an HTTPS URL",
    );
  }
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username !== "" ||
    sourceUrl.password !== "" ||
    sourceUrl.search !== "" ||
    sourceUrl.hash !== "" ||
    !["github.com", "gitlab.com"].includes(sourceUrl.hostname.toLowerCase())
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Source repository host is not allowed",
    );
  }
  const sourceRepository = sourceUrl.toString().replace(/\/$/, "");
  if (
    typeof input.sourceRevision !== "string" ||
    !SOURCE_COMMIT_PATTERN.test(input.sourceRevision)
  )
    throw new ApplicationError(
      "INVALID_INPUT",
      "Source revision must be an exact commit SHA",
    );
  if (typeof input.buildCommand !== "string")
    throw new ApplicationError("INVALID_INPUT", "Build command is required");
  const buildCommand = input.buildCommand.trim();
  if (!SOURCE_BUILD_COMMAND_PATTERN.test(buildCommand))
    throw new ApplicationError(
      "INVALID_INPUT",
      "Build command contains unsupported shell syntax",
    );
  if (input.runtime !== "bun" && input.runtime !== "node")
    throw new ApplicationError("INVALID_INPUT", "Runtime must be bun or node");
  const commandRuntime = buildCommand.split(/\s+/, 1)[0];
  if (
    (input.runtime === "bun" && commandRuntime !== "bun") ||
    (input.runtime === "node" &&
      commandRuntime !== "node" &&
      commandRuntime !== "npm")
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Build command does not match the selected runtime",
    );
  }
  return {
    sourceRepository,
    sourceRevision: input.sourceRevision,
    buildCommand,
    runtime: input.runtime,
  };
}

function publicBuild(
  row: BuildRow,
  integrity: BuildIntegrityRow | null = null,
): PublicBuild {
  const descriptor = parseRobotBuildDescriptor(JSON.parse(row.descriptor_json));
  const route = JSON.parse(row.route_json) as PublicBuild["route"];
  if (
    descriptor.robotId !== row.robot_id ||
    descriptor.robotBuildId !== row.id
  ) {
    throw new ApplicationError(
      "PERSISTENCE_UNAVAILABLE",
      "Build descriptor binding is invalid",
    );
  }
  const common = {
    id: row.id,
    siteId: row.site_id,
    robotId: row.robot_id,
    version: row.version,
    label: row.label,
    route,
    createdAt: row.created_at,
  };
  if (integrity === null) {
    return Object.freeze({
      ...common,
      buildMode: "EXISTING",
      buildStatus: "BUILD_SUCCEEDED",
      artifactDigest: descriptor.artifactDigest,
      robotBuildDigest: digestRobotBuild(descriptor),
      sourceRepository: null,
      sourceRevision: null,
      sourceSnapshotDigest: null,
      buildCommand: null,
      lockfileDigest: null,
      builder: null,
      runtime: null,
      provenance: null,
      buildErrorCode: null,
      buildErrorMessage: null,
    });
  }

  if (integrity.status !== "BUILD_SUCCEEDED") {
    return Object.freeze({
      ...common,
      buildMode: "SOURCE",
      buildStatus: integrity.status,
      artifactDigest: null,
      robotBuildDigest: null,
      sourceRepository: integrity.source_repository,
      sourceRevision: integrity.source_revision,
      sourceSnapshotDigest: null,
      buildCommand: integrity.build_command,
      lockfileDigest: null,
      builder: null,
      runtime: null,
      provenance: null,
      buildErrorCode: integrity.error_code,
      buildErrorMessage: integrity.error_message,
    });
  }

  if (integrity.integrity_json === null) {
    throw new ApplicationError(
      "PERSISTENCE_UNAVAILABLE",
      "Successful source build evidence is unavailable",
    );
  }
  try {
    const evidence = parseBuildIntegrityEvidence(
      JSON.parse(integrity.integrity_json),
    );
    if (
      evidence.buildId !== row.id ||
      evidence.sourceRepository !== integrity.source_repository ||
      evidence.sourceRevision !== integrity.source_revision ||
      evidence.buildCommand !== integrity.build_command ||
      evidence.runtime.name !== integrity.runtime ||
      descriptor.schemaVersion !== SOURCE_ROBOT_BUILD_SCHEMA_VERSION ||
      descriptor.buildIntegrityDigest === undefined ||
      digestBuildIntegrity(evidence) !== descriptor.buildIntegrityDigest ||
      evidence.artifactDigest !== descriptor.artifactDigest
    ) {
      throw new Error("source build binding mismatch");
    }
    return Object.freeze({
      ...common,
      buildMode: "SOURCE",
      buildStatus: "BUILD_SUCCEEDED",
      artifactDigest: descriptor.artifactDigest,
      robotBuildDigest: digestRobotBuild(descriptor),
      sourceRepository: evidence.sourceRepository,
      sourceRevision: evidence.sourceRevision,
      sourceSnapshotDigest: evidence.sourceSnapshotDigest,
      buildCommand: evidence.buildCommand,
      lockfileDigest: evidence.lockfileDigest,
      builder: evidence.builder,
      runtime: evidence.runtime,
      provenance: evidence.provenance,
      buildErrorCode: null,
      buildErrorMessage: null,
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "PERSISTENCE_UNAVAILABLE",
      "Successful source build evidence is invalid",
    );
  }
}

function publicEvaluation(row: EvaluationRow): PublicEvaluation {
  return Object.freeze(JSON.parse(row.public_json) as PublicEvaluation);
}

function publicPendingEvaluation(
  row: PendingEvaluationRow,
): PublicEvaluationPending {
  return Object.freeze({
    status: "PENDING",
    evaluationId: row.evaluation_id,
    siteId: row.site_id,
    robotId: row.robot_id,
    buildId: row.build_id,
    requestedAt: row.requested_at,
  });
}

function assertAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERN.test(accountId))
    throw new ApplicationError("AUTH_REQUIRED", "Session is invalid");
}

export class ApplicationStore {
  readonly #database: Database;
  readonly #policyKey: Uint8Array;
  readonly #artifactDirectory: string;
  readonly #now: () => string;

  constructor(options: {
    readonly dbPath: string;
    readonly policyKey: Uint8Array;
    readonly artifactDirectory?: string;
    readonly now?: () => string;
  }) {
    try {
      if (options.dbPath !== ":memory:")
        mkdirSync(dirname(options.dbPath), { recursive: true });
      this.#database = new Database(options.dbPath, {
        create: true,
        strict: true,
      });
      this.#database.run("PRAGMA journal_mode = WAL");
      this.#database.run("PRAGMA synchronous = FULL");
      this.#database.run("PRAGMA foreign_keys = ON");
      this.#database.run(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sites (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          location TEXT NOT NULL,
          safety_envelope_id TEXT NOT NULL,
          safety_envelope_commitment TEXT NOT NULL,
          policy_ciphertext TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS robots (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS builds (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          robot_id TEXT NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          label TEXT NOT NULL,
          descriptor_json TEXT NOT NULL,
          trace_json TEXT NOT NULL,
          route_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS build_integrity (
          build_id TEXT PRIMARY KEY REFERENCES builds(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          robot_id TEXT NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
          source_repository TEXT NOT NULL,
          source_revision TEXT NOT NULL,
          build_command TEXT NOT NULL,
          runtime TEXT NOT NULL,
          status TEXT NOT NULL,
          artifact_path TEXT,
          integrity_json TEXT,
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(account_id, build_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS evaluations (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          robot_id TEXT NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
          build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
          public_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS pending_evaluations (
          evaluation_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          robot_id TEXT NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
          build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
          behavior_input_digest TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, evaluation_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS cre_evaluation_rejections (
          evaluation_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          callback_digest TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(account_id, evaluation_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS release_attempts (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          code TEXT,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
      this.#policyKey = canonicalPolicyKey(options.policyKey);
      this.#artifactDirectory = resolve(
        options.artifactDirectory ??
          resolve(process.cwd(), ".data/rovaulta-build-artifacts"),
      );
      this.#now = options.now ?? nowSeconds;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Application store is unavailable",
      );
    }
  }

  registerAccount(input: {
    readonly email: unknown;
    readonly password: unknown;
  }): {
    account: PublicAccount;
    sessionToken: string;
    expiresAt: string;
  } {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const createdAt = this.#now();
    const accountId = id("account");
    try {
      const row = this.#database
        .query<AccountRow, [string]>("SELECT id FROM accounts WHERE email = ?")
        .get(email);
      if (row !== null && row !== undefined)
        throw new ApplicationError(
          "DUPLICATE_ACCOUNT",
          "An account with that email already exists",
        );
      this.#database
        .query(
          "INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(accountId, email, hashPassword(password), createdAt);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "DUPLICATE_ACCOUNT",
        "An account with that email already exists",
      );
    }
    const session = this.createSession(accountId);
    return { account: { id: accountId, email, createdAt }, ...session };
  }

  signIn(input: { readonly email: unknown; readonly password: unknown }): {
    account: PublicAccount;
    sessionToken: string;
    expiresAt: string;
  } {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const row = this.#database
      .query<AccountRow, [string]>("SELECT * FROM accounts WHERE email = ?")
      .get(email);
    if (
      row === null ||
      row === undefined ||
      !verifyPassword(password, row.password_hash)
    ) {
      throw new ApplicationError(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
      );
    }
    const session = this.createSession(row.id);
    return { account: publicAccount(row), ...session };
  }

  createSession(accountId: string): {
    sessionToken: string;
    expiresAt: string;
  } {
    assertAccountId(accountId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = (
      BigInt(this.#now()) + BigInt(SESSION_TTL_SECONDS)
    ).toString();
    this.#database
      .query(
        "INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(hashToken(token), accountId, expiresAt, this.#now());
    return { sessionToken: token, expiresAt };
  }

  accountForSession(token: string | null | undefined): PublicAccount | null {
    if (token === null || token === undefined || token.length < 16) return null;
    const row = this.#database
      .query<
        SessionRow,
        [string]
      >("SELECT account_id, expires_at FROM sessions WHERE token_hash = ?")
      .get(hashToken(token));
    if (row === null || row === undefined) return null;
    if (BigInt(row.expires_at) <= BigInt(this.#now())) {
      this.#database
        .query("DELETE FROM sessions WHERE token_hash = ?")
        .run(hashToken(token));
      return null;
    }
    const account = this.#database
      .query<AccountRow, [string]>("SELECT * FROM accounts WHERE id = ?")
      .get(row.account_id);
    return account === null || account === undefined
      ? null
      : publicAccount(account);
  }

  revokeSession(token: string | null | undefined): void {
    if (token === null || token === undefined) return;
    this.#database
      .query("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  createSite(
    accountId: string,
    input: {
      readonly name: unknown;
      readonly location: unknown;
      readonly policy: unknown;
    },
  ): PublicSite {
    assertAccountId(accountId);
    const name = parseText(input.name, "Site name");
    const location = parseText(input.location, "Site location", 1, 160);
    const policyInput = parsePolicy(input.policy);
    const siteId = id("site");
    const safetyEnvelopeId = id("safety-envelope");
    const envelope = buildEnvelope(siteId, safetyEnvelopeId, policyInput);
    const blind = randomBytes(32);
    const commitment = digestSafetyEnvelopeCommitment(
      parseSiteId(siteId),
      parseSafetyEnvelopeId(safetyEnvelopeId),
      confidentialEnvelopeCommitmentPayload(envelope),
      blind,
    );
    const createdAt = this.#now();
    const row: SiteRow = {
      id: siteId,
      account_id: accountId,
      name,
      location,
      safety_envelope_id: safetyEnvelopeId,
      safety_envelope_commitment: commitment,
      policy_ciphertext: encryptPolicy({ envelope, blind }, this.#policyKey),
      created_at: createdAt,
    };
    this.#database
      .query(
        "INSERT INTO sites (id, account_id, name, location, safety_envelope_id, safety_envelope_commitment, policy_ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.account_id,
        row.name,
        row.location,
        row.safety_envelope_id,
        row.safety_envelope_commitment,
        row.policy_ciphertext,
        row.created_at,
      );
    return publicSite(row);
  }

  listSites(accountId: string): readonly PublicSite[] {
    assertAccountId(accountId);
    return Object.freeze(
      this.#database
        .query<
          SiteRow,
          [string]
        >("SELECT * FROM sites WHERE account_id = ? ORDER BY created_at, id")
        .all(accountId)
        .map(publicSite),
    );
  }

  getSite(accountId: string, siteId: string): PublicSite {
    const row = this.#siteRow(accountId, siteId);
    return publicSite(row);
  }

  /**
   * Returns the exact site-bound CRE secret for a trusted local provisioning operator.
   *
   * This method is intentionally not used by HTTP handlers. Callers must provision the returned
   * value directly to CRE; it must never be sent to a browser, logged, or written to evidence.
   */
  readConfidentialEvaluationSecretForOperator(
    accountId: string,
    siteId: string,
  ): OperatorConfidentialEvaluationSecret {
    const site = this.#siteRow(accountId, siteId);
    const policy = decryptPolicy(site.policy_ciphertext, this.#policyKey);
    const commitment = digestSafetyEnvelopeCommitment(
      parseSiteId(site.id),
      parseSafetyEnvelopeId(site.safety_envelope_id),
      confidentialEnvelopeCommitmentPayload(policy.envelope),
      policy.blind,
    );
    if (commitment !== site.safety_envelope_commitment) {
      throw new ApplicationError(
        "CONFLICT",
        "Stored site policy does not match the public safety-envelope commitment",
      );
    }
    return Object.freeze({
      selector: siteSecretId(site.id),
      value: canonicalSerialize({
        schemaVersion: CRE_CONFIDENTIAL_INPUT_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        confidentialEnvelope: policy.envelope,
        envelopeBlindingSecretHex: bytesToHex(policy.blind),
      }),
    });
  }

  createRobot(
    accountId: string,
    siteId: string,
    input: { readonly name: unknown },
  ): PublicRobot {
    const site = this.#siteRow(accountId, siteId);
    const row: RobotRow = {
      id: id("robot"),
      account_id: accountId,
      site_id: site.id,
      name: parseText(input.name, "Robot name"),
      created_at: this.#now(),
    };
    this.#database
      .query(
        "INSERT INTO robots (id, account_id, site_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.id, row.account_id, row.site_id, row.name, row.created_at);
    return publicRobot(row);
  }

  listRobots(accountId: string, siteId: string): readonly PublicRobot[] {
    this.#siteRow(accountId, siteId);
    return Object.freeze(
      this.#database
        .query<
          RobotRow,
          [string, string]
        >("SELECT * FROM robots WHERE account_id = ? AND site_id = ? ORDER BY created_at, id")
        .all(accountId, siteId)
        .map(publicRobot),
    );
  }

  createBuild(
    accountId: string,
    siteId: string,
    input: {
      readonly robotId: unknown;
      readonly version: unknown;
      readonly label: unknown;
      readonly artifactDigest: unknown;
      readonly route: unknown;
    },
  ): PublicBuild {
    const { site, robot, version, label, start, end, speed } =
      this.#parseBuildCreationInput(accountId, siteId, input);
    let artifactDigest: RobotBuildDescriptor["artifactDigest"];
    try {
      artifactDigest = parseSha256Digest(
        input.artifactDigest,
        "artifactDigest",
      );
    } catch {
      throw new ApplicationError(
        "INVALID_INPUT",
        "Artifact digest must be sha256:<64 lowercase hex characters>",
      );
    }
    const buildId = id("robot-build");
    const descriptor: RobotBuildDescriptor = parseRobotBuildDescriptor({
      schemaVersion: ROBOT_BUILD_SCHEMA_VERSION,
      robotId: robot.id,
      robotBuildId: buildId,
      artifactDigest,
    });
    const traces = buildTraceSuite(
      robot.id,
      buildId,
      descriptor,
      start,
      end,
      speed,
    );
    const createdAt = this.#now();
    const row: BuildRow = {
      id: buildId,
      account_id: accountId,
      site_id: site.id,
      robot_id: robot.id,
      version,
      label,
      descriptor_json: canonicalSerialize(descriptor),
      trace_json: canonicalSerialize(traces),
      route_json: canonicalSerialize({ start, end, speedMmPerSecond: speed }),
      created_at: createdAt,
    };
    this.#database
      .query(
        "INSERT INTO builds (id, account_id, site_id, robot_id, version, label, descriptor_json, trace_json, route_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.account_id,
        row.site_id,
        row.robot_id,
        row.version,
        row.label,
        row.descriptor_json,
        row.trace_json,
        row.route_json,
        row.created_at,
      );
    return publicBuild(row);
  }

  createSourceBuild(
    accountId: string,
    siteId: string,
    input: {
      readonly robotId: unknown;
      readonly version: unknown;
      readonly label: unknown;
      readonly sourceRepository: unknown;
      readonly sourceRevision: unknown;
      readonly buildCommand: unknown;
      readonly runtime: unknown;
      readonly route: unknown;
    },
  ): PublicBuild {
    const { site, robot, version, label, start, end, speed } =
      this.#parseBuildCreationInput(accountId, siteId, input);
    const source = parseSourceBuildInput(input);
    const buildId = id("robot-build");
    const placeholderArtifactDigest = parseSha256Digest(
      `sha256:${"0".repeat(64)}`,
    );
    const descriptor = parseRobotBuildDescriptor({
      schemaVersion: ROBOT_BUILD_SCHEMA_VERSION,
      robotId: robot.id,
      robotBuildId: buildId,
      artifactDigest: placeholderArtifactDigest,
    });
    const traces = buildTraceSuite(
      robot.id,
      buildId,
      descriptor,
      start,
      end,
      speed,
    );
    const createdAt = this.#now();
    const row: BuildRow = {
      id: buildId,
      account_id: accountId,
      site_id: site.id,
      robot_id: robot.id,
      version,
      label,
      descriptor_json: canonicalSerialize(descriptor),
      trace_json: canonicalSerialize(traces),
      route_json: canonicalSerialize({ start, end, speedMmPerSecond: speed }),
      created_at: createdAt,
    };
    const integrity: BuildIntegrityRow = {
      build_id: buildId,
      account_id: accountId,
      site_id: site.id,
      robot_id: robot.id,
      source_repository: source.sourceRepository,
      source_revision: source.sourceRevision,
      build_command: source.buildCommand,
      runtime: source.runtime,
      status: "BUILDING",
      artifact_path: null,
      integrity_json: null,
      error_code: null,
      error_message: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    try {
      this.#database.run("BEGIN IMMEDIATE");
      const active = this.#database
        .query<
          { readonly count: number },
          [string, string]
        >("SELECT COUNT(*) AS count FROM build_integrity WHERE account_id = ? AND status = ?")
        .get(accountId, "BUILDING");
      if ((active?.count ?? 0) >= MAX_BUILDING_SOURCE_BUILDS_PER_ACCOUNT) {
        throw new ApplicationError(
          "CONFLICT",
          "This account already has too many source builds running",
        );
      }
      this.#database
        .query(
          "INSERT INTO builds (id, account_id, site_id, robot_id, version, label, descriptor_json, trace_json, route_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.account_id,
          row.site_id,
          row.robot_id,
          row.version,
          row.label,
          row.descriptor_json,
          row.trace_json,
          row.route_json,
          row.created_at,
        );
      this.#database
        .query(
          "INSERT INTO build_integrity (build_id, account_id, site_id, robot_id, source_repository, source_revision, build_command, runtime, status, artifact_path, integrity_json, error_code, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          integrity.build_id,
          integrity.account_id,
          integrity.site_id,
          integrity.robot_id,
          integrity.source_repository,
          integrity.source_revision,
          integrity.build_command,
          integrity.runtime,
          integrity.status,
          integrity.artifact_path,
          integrity.integrity_json,
          integrity.error_code,
          integrity.error_message,
          integrity.created_at,
          integrity.updated_at,
        );
      this.#database.run("COMMIT");
    } catch (error) {
      try {
        this.#database.run("ROLLBACK");
      } catch {
        // Preserve the original failure without exposing SQLite details.
      }
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Source build could not be stored",
      );
    }
    return publicBuild(row, integrity);
  }

  async completeSourceBuild(
    accountId: string,
    buildId: string,
    result: BuildRunnerResult,
  ): Promise<PublicBuild> {
    assertAccountId(accountId);
    const currentIntegrity = this.#buildIntegrityRow(accountId, buildId);
    if (currentIntegrity === null)
      throw new ApplicationError("NOT_FOUND", "Source build was not found");
    const build = this.#buildRow(
      accountId,
      currentIntegrity.site_id,
      currentIntegrity.robot_id,
      buildId,
    );
    if (currentIntegrity.status === "BUILD_SUCCEEDED")
      return publicBuild(build, currentIntegrity);
    if (currentIntegrity.status !== "BUILDING")
      throw new ApplicationError(
        "CONFLICT",
        "Source build is no longer running",
      );

    let evidence: BuildIntegrityEvidence;
    try {
      evidence = parseBuildIntegrityEvidence(result.evidence);
    } catch {
      throw new ApplicationError(
        "BUILD_FAILED",
        "Source build evidence is invalid",
      );
    }
    if (
      evidence.buildId !== build.id ||
      evidence.sourceRepository !== currentIntegrity.source_repository ||
      evidence.sourceRevision !== currentIntegrity.source_revision ||
      evidence.buildCommand !== currentIntegrity.build_command ||
      evidence.runtime.name !== currentIntegrity.runtime ||
      evidence.artifactDigest !== result.artifactDigest ||
      typeof result.artifactPath !== "string" ||
      result.artifactPath.trim().length === 0
    ) {
      throw new ApplicationError(
        "BUILD_FAILED",
        "Source build evidence does not match the build job",
      );
    }

    const artifactPath = resolve(result.artifactPath);
    const expectedArtifactPath = resolve(
      this.#artifactDirectory,
      `${build.id.slice("robot-build:".length)}.tar.gz`,
    );
    if (
      !artifactPath.startsWith(`${this.#artifactDirectory}${sep}`) ||
      artifactPath !== expectedArtifactPath
    ) {
      throw new ApplicationError(
        "BUILD_FAILED",
        "Source build artifact path is invalid",
      );
    }
    const storedArtifactDigest = await hashStoredArtifact(artifactPath);
    if (storedArtifactDigest !== evidence.artifactDigest) {
      throw new ApplicationError(
        "BUILD_FAILED",
        "Stored artifact digest does not match evidence",
      );
    }

    const route = JSON.parse(build.route_json) as PublicBuild["route"];
    const descriptor = parseRobotBuildDescriptor({
      schemaVersion: SOURCE_ROBOT_BUILD_SCHEMA_VERSION,
      robotId: build.robot_id,
      robotBuildId: build.id,
      artifactDigest: evidence.artifactDigest,
      buildIntegrityDigest: digestBuildIntegrity(evidence),
    });
    const traces = buildTraceSuite(
      build.robot_id,
      build.id,
      descriptor,
      parsePoint(route.start, "route.start"),
      parsePoint(route.end, "route.end"),
      parseInteger(route.speedMmPerSecond, "Route speed", 0, 1_000_000),
    );
    const updatedAt = this.#now();
    const updatedIntegrity: BuildIntegrityRow = {
      ...currentIntegrity,
      status: "BUILD_SUCCEEDED",
      artifact_path: artifactPath,
      integrity_json: canonicalSerialize(evidence),
      error_code: null,
      error_message: null,
      updated_at: updatedAt,
    };
    const updatedBuild: BuildRow = {
      ...build,
      descriptor_json: canonicalSerialize(descriptor),
      trace_json: canonicalSerialize(traces),
    };
    try {
      this.#database.run("BEGIN IMMEDIATE");
      const integrityUpdate = this.#database
        .query(
          "UPDATE build_integrity SET status = ?, artifact_path = ?, integrity_json = ?, error_code = ?, error_message = ?, updated_at = ? WHERE build_id = ? AND account_id = ? AND status = ?",
        )
        .run(
          updatedIntegrity.status,
          updatedIntegrity.artifact_path,
          updatedIntegrity.integrity_json,
          updatedIntegrity.error_code,
          updatedIntegrity.error_message,
          updatedIntegrity.updated_at,
          updatedIntegrity.build_id,
          accountId,
          "BUILDING",
        );
      if (integrityUpdate.changes !== 1) {
        throw new ApplicationError(
          "CONFLICT",
          "Source build is no longer running",
        );
      }
      const buildUpdate = this.#database
        .query(
          "UPDATE builds SET descriptor_json = ?, trace_json = ? WHERE id = ? AND account_id = ?",
        )
        .run(
          updatedBuild.descriptor_json,
          updatedBuild.trace_json,
          build.id,
          accountId,
        );
      if (buildUpdate.changes !== 1) {
        throw new ApplicationError(
          "PERSISTENCE_UNAVAILABLE",
          "Source build could not be promoted",
        );
      }
      this.#database.run("COMMIT");
    } catch (error) {
      try {
        this.#database.run("ROLLBACK");
      } catch {
        // Preserve the original failure without exposing SQLite details.
      }
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Source build completion could not be stored",
      );
    }
    return publicBuild(updatedBuild, updatedIntegrity);
  }

  failSourceBuild(
    accountId: string,
    buildId: string,
    errorCode: string,
    errorMessage: string,
  ): PublicBuild {
    assertAccountId(accountId);
    const currentIntegrity = this.#buildIntegrityRow(accountId, buildId);
    if (currentIntegrity === null)
      throw new ApplicationError("NOT_FOUND", "Source build was not found");
    const build = this.#buildRow(
      accountId,
      currentIntegrity.site_id,
      currentIntegrity.robot_id,
      buildId,
    );
    if (currentIntegrity.status === "BUILD_FAILED")
      return publicBuild(build, currentIntegrity);
    if (currentIntegrity.status === "BUILD_SUCCEEDED")
      return publicBuild(build, currentIntegrity);
    const updatedIntegrity: BuildIntegrityRow = {
      ...currentIntegrity,
      status: "BUILD_FAILED",
      error_code: errorCode.slice(0, 80),
      error_message: errorMessage.slice(0, 240),
      updated_at: this.#now(),
    };
    this.#database
      .query(
        "UPDATE build_integrity SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE build_id = ? AND account_id = ? AND status = ?",
      )
      .run(
        updatedIntegrity.status,
        updatedIntegrity.error_code,
        updatedIntegrity.error_message,
        updatedIntegrity.updated_at,
        updatedIntegrity.build_id,
        accountId,
        "BUILDING",
      );
    return publicBuild(build, updatedIntegrity);
  }

  listBuilds(accountId: string, siteId: string): readonly PublicBuild[] {
    this.#siteRow(accountId, siteId);
    return Object.freeze(
      this.#database
        .query<BuildRow, [string, string]>(
          "SELECT * FROM builds WHERE account_id = ? AND site_id = ? ORDER BY created_at, id",
        )
        .all(accountId, siteId)
        .map((row) =>
          publicBuild(row, this.#buildIntegrityRow(accountId, row.id)),
        ),
    );
  }

  listAllBuilds(accountId: string): readonly PublicBuild[] {
    assertAccountId(accountId);
    return Object.freeze(
      this.#database
        .query<BuildRow, [string]>(
          "SELECT * FROM builds WHERE account_id = ? ORDER BY created_at, id",
        )
        .all(accountId)
        .map((row) =>
          publicBuild(row, this.#buildIntegrityRow(accountId, row.id)),
        ),
    );
  }

  #findEvaluationByEvaluationId(
    accountId: string,
    evaluationId: string,
  ): EvaluationRow | null {
    const rows = this.#database
      .query<
        EvaluationRow,
        [string]
      >("SELECT * FROM evaluations WHERE account_id = ?")
      .all(accountId);
    return (
      rows.find(
        (row) =>
          (JSON.parse(row.public_json) as PublicEvaluation).evaluationId ===
          evaluationId,
      ) ?? null
    );
  }

  #findAnyEvaluationByEvaluationId(evaluationId: string): EvaluationRow | null {
    const rows = this.#database
      .query<EvaluationRow, []>("SELECT * FROM evaluations")
      .all();
    return (
      rows.find(
        (row) =>
          (JSON.parse(row.public_json) as PublicEvaluation).evaluationId ===
          evaluationId,
      ) ?? null
    );
  }

  #recordPendingEvaluation(input: {
    readonly accountId: string;
    readonly evaluationId: string;
    readonly siteId: string;
    readonly robotId: string;
    readonly buildId: string;
    readonly behaviorInputDigest: string;
    readonly requestedAt: string;
  }): void {
    const existing = this.#database
      .query<
        PendingEvaluationRow,
        [string]
      >("SELECT * FROM pending_evaluations WHERE evaluation_id = ?")
      .get(input.evaluationId);
    if (existing !== null && existing !== undefined) {
      if (
        existing.account_id !== input.accountId ||
        existing.site_id !== input.siteId ||
        existing.robot_id !== input.robotId ||
        existing.build_id !== input.buildId ||
        existing.behavior_input_digest !== input.behaviorInputDigest ||
        existing.requested_at !== input.requestedAt
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Evaluation request binding changed",
        );
      }
      return;
    }
    if (
      this.#findEvaluationByEvaluationId(
        input.accountId,
        input.evaluationId,
      ) !== null
    )
      return;
    this.#database
      .query(
        "INSERT INTO pending_evaluations (evaluation_id, account_id, site_id, robot_id, build_id, behavior_input_digest, requested_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.evaluationId,
        input.accountId,
        input.siteId,
        input.robotId,
        input.buildId,
        input.behaviorInputDigest,
        input.requestedAt,
        this.#now(),
      );
  }

  #deletePendingEvaluation(evaluationId: string): void {
    this.#database
      .query("DELETE FROM pending_evaluations WHERE evaluation_id = ?")
      .run(evaluationId);
  }

  #findCreEvaluationRejection(
    evaluationId: string,
  ): CreEvaluationRejectionRow | null {
    return (
      this.#database
        .query<
          CreEvaluationRejectionRow,
          [string]
        >("SELECT * FROM cre_evaluation_rejections WHERE evaluation_id = ?")
        .get(evaluationId) ?? null
    );
  }

  getEvaluationStatus(
    accountId: string,
    evaluationId: string,
  ): PublicEvaluation | PublicEvaluationPending {
    assertAccountId(accountId);
    const completed = this.#findEvaluationByEvaluationId(
      accountId,
      evaluationId,
    );
    if (completed !== null) return publicEvaluation(completed);
    const pending = this.#database
      .query<
        PendingEvaluationRow,
        [string, string]
      >("SELECT * FROM pending_evaluations WHERE account_id = ? AND evaluation_id = ?")
      .get(accountId, evaluationId);
    if (pending !== null && pending !== undefined)
      return publicPendingEvaluation(pending);
    throw new ApplicationError("NOT_FOUND", "Evaluation was not found");
  }

  completeCreEvaluation(callback: CreEvaluationResultCallback):
    | { readonly status: "COMPLETED"; readonly evaluation: PublicEvaluation }
    | {
        readonly status: "ALREADY_COMPLETED";
        readonly evaluation: PublicEvaluation;
      }
    | { readonly status: "REJECTED"; readonly code: string } {
    try {
      this.#database.run("BEGIN IMMEDIATE");
      const callbackDigest = creCallbackDigest(callback);
      const pending = this.#database
        .query<
          PendingEvaluationRow,
          [string]
        >("SELECT * FROM pending_evaluations WHERE evaluation_id = ?")
        .get(callback.evaluationId);
      if (pending === null || pending === undefined) {
        const existing = this.#findAnyEvaluationByEvaluationId(
          callback.evaluationId,
        );
        if (existing !== null) {
          this.#database.run("COMMIT");
          return {
            status: "ALREADY_COMPLETED",
            evaluation: publicEvaluation(existing),
          };
        }
        const rejection = this.#findCreEvaluationRejection(
          callback.evaluationId,
        );
        if (rejection !== null) {
          if (rejection.callback_digest !== callbackDigest) {
            throw new ApplicationError(
              "CONFLICT",
              "CRE evaluation already reached a terminal state",
            );
          }
          this.#database.run("COMMIT");
          return { status: "REJECTED", code: rejection.code };
        }
        throw new ApplicationError(
          "NOT_FOUND",
          "Pending evaluation was not found",
        );
      }

      const rejection = this.#findCreEvaluationRejection(callback.evaluationId);
      if (rejection !== null) {
        if (rejection.callback_digest !== callbackDigest) {
          throw new ApplicationError(
            "CONFLICT",
            "CRE evaluation already reached a terminal state",
          );
        }
        this.#database.run("COMMIT");
        return { status: "REJECTED", code: rejection.code };
      }

      if (callback.response.status === "REJECT") {
        this.#database
          .query(
            "INSERT INTO cre_evaluation_rejections (evaluation_id, account_id, code, callback_digest, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            callback.evaluationId,
            pending.account_id,
            callback.response.code,
            callbackDigest,
            this.#now(),
          );
        this.#deletePendingEvaluation(callback.evaluationId);
        this.#database.run("COMMIT");
        return { status: "REJECTED", code: callback.response.code };
      }

      if (
        callback.response.behaviorInputDigest !== pending.behavior_input_digest
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "CRE result behavior binding does not match request",
        );
      }
      const site = this.#siteRow(pending.account_id, pending.site_id);
      const robot = this.#robotRow(
        pending.account_id,
        site.id,
        pending.robot_id,
      );
      const build = this.#buildRow(
        pending.account_id,
        site.id,
        robot.id,
        pending.build_id,
      );
      const descriptor = parseRobotBuildDescriptor(
        JSON.parse(build.descriptor_json),
      );
      const request = parseEvaluationRequest({
        schemaVersion: EVALUATION_REQUEST_SCHEMA_VERSION,
        evaluationId: callback.evaluationId,
        inputs: {
          schemaVersion: EVALUATION_INPUTS_SCHEMA_VERSION,
          siteId: site.id,
          robotId: robot.id,
          robotBuildId: descriptor.robotBuildId,
          robotBuildDigest: digestRobotBuild(descriptor),
          safetyEnvelopeId: site.safety_envelope_id,
          safetyEnvelopeCommitment: site.safety_envelope_commitment,
          evaluatorVersion: parseEvaluatorVersionId(
            WAREHOUSE_EVALUATOR_VERSION,
          ),
        },
        requestedAt: pending.requested_at,
      });
      const result = assertEvaluationResultBindings(
        callback.response.result,
        request,
      );
      const publicResult: PublicEvaluation = Object.freeze({
        id: id("evaluation-record"),
        siteId: site.id,
        robotId: robot.id,
        buildId: build.id,
        evaluationId: result.evaluationId,
        robotBuildId: result.inputs.robotBuildId,
        verdict: result.verdict,
        safetyEnvelopeId: result.inputs.safetyEnvelopeId,
        evaluatorVersion: result.inputs.evaluatorVersion,
        robotBuildDigest: result.inputs.robotBuildDigest,
        safetyEnvelopeCommitment: result.inputs.safetyEnvelopeCommitment,
        evaluationInputsDigest: result.evaluationInputsDigest,
        scenarioCount: null,
        violationCount: null,
        reasons: Object.freeze([]),
        evaluatedAt: result.evaluatedAt,
        executionMode: "cre-gateway-callback",
      });
      const row: EvaluationRow = {
        id: publicResult.id,
        account_id: pending.account_id,
        site_id: site.id,
        robot_id: robot.id,
        build_id: build.id,
        public_json: canonicalSerialize(publicResult),
        created_at: this.#now(),
      };
      this.#database
        .query(
          "INSERT INTO evaluations (id, account_id, site_id, robot_id, build_id, public_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.account_id,
          row.site_id,
          row.robot_id,
          row.build_id,
          row.public_json,
          row.created_at,
        );
      this.#deletePendingEvaluation(callback.evaluationId);
      this.#database.run("COMMIT");
      return { status: "COMPLETED", evaluation: publicResult };
    } catch (error) {
      try {
        this.#database.run("ROLLBACK");
      } catch {
        // Preserve the original failure without exposing SQLite details.
      }
      if (error instanceof ApplicationError || error instanceof ProtocolError)
        throw error;
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "CRE evaluation result could not be stored",
      );
    }
  }

  async evaluateBuild(
    accountId: string,
    input: {
      readonly siteId: string;
      readonly robotId: string;
      readonly buildId: string;
      readonly evaluationId: string;
      readonly requestedAt: string;
      readonly evaluatedAt: string;
      readonly evaluate: (
        value: ConfidentialEvaluationInput,
      ) => ConfidentialEvaluationReport | Promise<ConfidentialEvaluationReport>;
    },
  ): Promise<PublicEvaluation> {
    const site = this.#siteRow(accountId, input.siteId);
    const robot = this.#robotRow(accountId, site.id, input.robotId);
    const build = this.#buildRow(accountId, site.id, robot.id, input.buildId);
    const integrity = this.#buildIntegrityRow(accountId, build.id);
    if (integrity?.status === "BUILDING") {
      throw new ApplicationError(
        "BUILD_NOT_READY",
        "Source build is still running",
      );
    }
    if (integrity?.status === "BUILD_FAILED") {
      throw new ApplicationError(
        "BUILD_FAILED",
        "Source build did not complete successfully",
      );
    }
    if (integrity !== null) publicBuild(build, integrity);
    const policy = decryptPolicy(site.policy_ciphertext, this.#policyKey);
    const descriptor = parseRobotBuildDescriptor(
      JSON.parse(build.descriptor_json),
    );
    if (
      descriptor.robotId !== robot.id ||
      descriptor.robotBuildId !== build.id
    ) {
      throw new ApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "Build descriptor binding is invalid",
      );
    }
    const traces = parseRobotBehaviorTraceSuite(JSON.parse(build.trace_json));
    const request = parseEvaluationRequest({
      schemaVersion: EVALUATION_REQUEST_SCHEMA_VERSION,
      evaluationId: input.evaluationId,
      inputs: {
        schemaVersion: EVALUATION_INPUTS_SCHEMA_VERSION,
        siteId: site.id,
        robotId: robot.id,
        robotBuildId: descriptor.robotBuildId,
        robotBuildDigest: digestRobotBuild(descriptor),
        safetyEnvelopeId: site.safety_envelope_id,
        safetyEnvelopeCommitment: site.safety_envelope_commitment,
        evaluatorVersion: parseEvaluatorVersionId(WAREHOUSE_EVALUATOR_VERSION),
      },
      requestedAt: input.requestedAt,
    });
    const behaviorInputDigest = digestBehaviorInput({
      schemaVersion: CRE_PUBLIC_REQUEST_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      confidentialInputSecretId: siteSecretId(site.id),
      request,
      robotBuild: descriptor,
      behaviorTraces: traces,
      traceProvenance: SYNTHETIC_TRACE_PROVENANCE,
      evaluatedAt: parseUnixTimestamp(input.evaluatedAt, "evaluatedAt"),
    });
    this.#recordPendingEvaluation({
      accountId,
      evaluationId: input.evaluationId,
      siteId: site.id,
      robotId: robot.id,
      buildId: build.id,
      behaviorInputDigest,
      requestedAt: input.requestedAt,
    });
    let report: ConfidentialEvaluationReport;
    try {
      report = await input.evaluate({
        request,
        robotBuild: descriptor,
        confidentialEnvelope: policy.envelope,
        envelopeBlindingSecret: policy.blind,
        behaviorTraces: traces,
        evaluatedAt: input.evaluatedAt,
      });
    } catch (error) {
      const existing = this.#findEvaluationByEvaluationId(
        accountId,
        input.evaluationId,
      );
      if (existing !== null) return publicEvaluation(existing);
      if (
        !(
          error !== null &&
          typeof error === "object" &&
          (error as { readonly code?: unknown }).code ===
            "CRE_EVALUATION_PENDING"
        )
      ) {
        this.#deletePendingEvaluation(input.evaluationId);
      }
      throw error;
    }
    const boundResult = assertEvaluationResultBindings(report.result, request);
    const reasons = Object.freeze(
      Array.from(
        new Set((report.violations ?? []).map((violation) => violation.type)),
      ),
    );
    const result: PublicEvaluation = Object.freeze({
      id: id("evaluation-record"),
      siteId: site.id,
      robotId: robot.id,
      buildId: build.id,
      evaluationId: boundResult.evaluationId,
      robotBuildId: boundResult.inputs.robotBuildId,
      verdict: boundResult.verdict,
      safetyEnvelopeId: boundResult.inputs.safetyEnvelopeId,
      evaluatorVersion: boundResult.inputs.evaluatorVersion,
      robotBuildDigest: boundResult.inputs.robotBuildDigest,
      safetyEnvelopeCommitment: boundResult.inputs.safetyEnvelopeCommitment,
      evaluationInputsDigest: boundResult.evaluationInputsDigest,
      scenarioCount: report.scenarioCount ?? null,
      violationCount: report.violationCount ?? null,
      reasons,
      evaluatedAt: boundResult.evaluatedAt,
      ...(report.executionMode === undefined
        ? {}
        : { executionMode: report.executionMode }),
      ...(report.creCliVersion === undefined
        ? {}
        : { creCliVersion: report.creCliVersion }),
    });
    const row: EvaluationRow = {
      id: result.id,
      account_id: accountId,
      site_id: site.id,
      robot_id: robot.id,
      build_id: build.id,
      public_json: canonicalSerialize(result),
      created_at: this.#now(),
    };
    this.#database
      .query(
        "INSERT INTO evaluations (id, account_id, site_id, robot_id, build_id, public_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.account_id,
        row.site_id,
        row.robot_id,
        row.build_id,
        row.public_json,
        row.created_at,
      );
    this.#deletePendingEvaluation(input.evaluationId);
    return result;
  }

  listEvaluations(accountId: string): readonly PublicEvaluation[] {
    assertAccountId(accountId);
    return Object.freeze(
      this.#database
        .query<
          EvaluationRow,
          [string]
        >("SELECT * FROM evaluations WHERE account_id = ? ORDER BY created_at DESC, id DESC")
        .all(accountId)
        .map(publicEvaluation),
    );
  }

  getEvaluation(accountId: string, evaluationId: string): PublicEvaluation {
    assertAccountId(accountId);
    const byRecordId = this.#database
      .query<
        EvaluationRow,
        [string, string]
      >("SELECT * FROM evaluations WHERE account_id = ? AND id = ?")
      .get(accountId, evaluationId);
    if (byRecordId !== null && byRecordId !== undefined)
      return publicEvaluation(byRecordId);
    const match = this.#findEvaluationByEvaluationId(accountId, evaluationId);
    if (match === null)
      throw new ApplicationError("NOT_FOUND", "Evaluation was not found");
    return publicEvaluation(match);
  }

  getDeploymentContext(
    accountId: string,
    evaluationId: string,
    clearanceInput: unknown,
  ): {
    readonly evaluation: PublicEvaluation;
    readonly clearance: ReturnType<typeof parseClearanceRecord>;
  } {
    const evaluation = this.getEvaluation(accountId, evaluationId);
    let clearance: ReturnType<typeof parseClearanceRecord>;
    try {
      clearance = parseClearanceRecord(clearanceInput);
    } catch {
      throw new ApplicationError(
        "CONFLICT",
        "The public clearance record is malformed",
      );
    }
    const matches =
      clearance.evaluationId === evaluation.evaluationId &&
      clearance.inputs.siteId === evaluation.siteId &&
      clearance.inputs.robotId === evaluation.robotId &&
      clearance.inputs.robotBuildId === evaluation.robotBuildId &&
      clearance.inputs.robotBuildDigest === evaluation.robotBuildDigest &&
      clearance.inputs.safetyEnvelopeId === evaluation.safetyEnvelopeId &&
      clearance.inputs.safetyEnvelopeCommitment ===
        evaluation.safetyEnvelopeCommitment &&
      clearance.inputs.evaluatorVersion === evaluation.evaluatorVersion &&
      clearance.evaluationInputsDigest === evaluation.evaluationInputsDigest;
    if (!matches) {
      throw new ApplicationError(
        "CONFLICT",
        "The clearance does not match the account evaluation",
      );
    }
    return Object.freeze({ evaluation, clearance });
  }

  recordReleaseAttempt(
    accountId: string,
    input: Omit<PublicReleaseAttempt, "id" | "createdAt">,
  ): PublicReleaseAttempt {
    assertAccountId(accountId);
    const evaluation = this.getEvaluation(accountId, input.evaluationId);
    const row: ReleaseAttemptRow = {
      id: id("release-attempt"),
      account_id: accountId,
      evaluation_id: evaluation.id,
      status: input.status,
      code: input.code,
      message: input.message,
      created_at: this.#now(),
    };
    this.#database
      .query(
        "INSERT INTO release_attempts (id, account_id, evaluation_id, status, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.account_id,
        row.evaluation_id,
        row.status,
        row.code,
        row.message,
        row.created_at,
      );
    return Object.freeze({
      id: row.id,
      evaluationId: evaluation.evaluationId,
      status: row.status,
      code: row.code,
      message: row.message,
      createdAt: row.created_at,
    });
  }

  listReleaseAttempts(accountId: string): readonly PublicReleaseAttempt[] {
    assertAccountId(accountId);
    return Object.freeze(
      this.#database
        .query<
          ReleaseAttemptRow & { evaluation_public_json: string },
          [string]
        >(
          "SELECT release_attempts.*, evaluations.public_json AS evaluation_public_json FROM release_attempts JOIN evaluations ON evaluations.id = release_attempts.evaluation_id WHERE release_attempts.account_id = ? ORDER BY release_attempts.created_at DESC, release_attempts.id DESC",
        )
        .all(accountId)
        .map((row) =>
          Object.freeze({
            id: row.id,
            evaluationId: (
              JSON.parse(row.evaluation_public_json) as PublicEvaluation
            ).evaluationId,
            status: row.status,
            code: row.code,
            message: row.message,
            createdAt: row.created_at,
          }),
        ),
    );
  }

  close(): void {
    this.#database.close();
  }

  static sessionCookieName(): string {
    return SESSION_COOKIE;
  }

  static sessionCookie(token: string, secure: boolean): string {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
  }

  static clearSessionCookie(secure: boolean): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Max-Age=0${secure ? "; Secure" : ""}`;
  }

  static readSessionCookie(header: string | undefined): string | null {
    if (header === undefined) return null;
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE) {
        try {
          return decodeURIComponent(rest.join("="));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  #parseBuildCreationInput(
    accountId: string,
    siteId: string,
    input: {
      readonly robotId: unknown;
      readonly version: unknown;
      readonly label: unknown;
      readonly route: unknown;
    },
  ): {
    readonly site: SiteRow;
    readonly robot: RobotRow;
    readonly version: string;
    readonly label: string;
    readonly start: ReturnType<typeof parsePoint>;
    readonly end: ReturnType<typeof parsePoint>;
    readonly speed: number;
  } {
    const site = this.#siteRow(accountId, siteId);
    if (typeof input.robotId !== "string")
      throw new ApplicationError("INVALID_INPUT", "Robot id is required");
    const robot = this.#robotRow(accountId, site.id, input.robotId);
    const version = parseText(input.version, "Build version", 1, 80);
    const label = parseText(input.label, "Build label", 1, 120);
    if (
      input.route === null ||
      typeof input.route !== "object" ||
      Array.isArray(input.route)
    )
      throw new ApplicationError("INVALID_INPUT", "A route is required");
    const route = input.route as Record<string, unknown>;
    const start = parsePoint(route.start, "route.start");
    const end = parsePoint(route.end, "route.end");
    const speed = parseInteger(
      route.speedMmPerSecond,
      "Route speed",
      0,
      1_000_000,
    );
    const policy = decryptPolicy(site.policy_ciphertext, this.#policyKey);
    const bounds = policy.envelope.warehouseBounds;
    for (const [point, labelName] of [
      [start, "route.start"],
      [end, "route.end"],
    ] as const) {
      if (
        point.xMm < bounds.minXmm ||
        point.xMm > bounds.maxXmm ||
        point.yMm < bounds.minYmm ||
        point.yMm > bounds.maxYmm
      ) {
        throw new ApplicationError(
          "INVALID_INPUT",
          `${labelName} must be inside the warehouse bounds`,
        );
      }
    }
    return { site, robot, version, label, start, end, speed };
  }

  #siteRow(accountId: string, siteId: string): SiteRow {
    assertAccountId(accountId);
    const row = this.#database
      .query<
        SiteRow,
        [string, string]
      >("SELECT * FROM sites WHERE account_id = ? AND id = ?")
      .get(accountId, siteId);
    if (row === null || row === undefined)
      throw new ApplicationError("NOT_FOUND", "Site was not found");
    return row;
  }

  #robotRow(accountId: string, siteId: string, robotId: string): RobotRow {
    const row = this.#database
      .query<
        RobotRow,
        [string, string, string]
      >("SELECT * FROM robots WHERE account_id = ? AND site_id = ? AND id = ?")
      .get(accountId, siteId, robotId);
    if (row === null || row === undefined)
      throw new ApplicationError("NOT_FOUND", "Robot was not found");
    return row;
  }

  #buildRow(
    accountId: string,
    siteId: string,
    robotId: string,
    buildId: string,
  ): BuildRow {
    const row = this.#database
      .query<
        BuildRow,
        [string, string, string, string]
      >("SELECT * FROM builds WHERE account_id = ? AND site_id = ? AND robot_id = ? AND id = ?")
      .get(accountId, siteId, robotId, buildId);
    if (row === null || row === undefined)
      throw new ApplicationError("NOT_FOUND", "Build was not found");
    return row;
  }

  #buildIntegrityRow(
    accountId: string,
    buildId: string,
  ): BuildIntegrityRow | null {
    const row = this.#database
      .query<
        BuildIntegrityRow,
        [string, string]
      >("SELECT * FROM build_integrity WHERE account_id = ? AND build_id = ?")
      .get(accountId, buildId);
    return row ?? null;
  }
}

export { SESSION_COOKIE };
