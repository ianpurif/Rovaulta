export interface Account {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly safetyEnvelopeId: string;
  readonly safetyEnvelopeCommitment: string;
  readonly createdAt: string;
}

export interface Robot {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface Build {
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
  readonly builder: Readonly<{ readonly id: string; readonly version: string }> | null;
  readonly runtime: Readonly<{
    readonly name: "bun" | "node";
    readonly version: string;
    readonly image: string;
  }> | null;
  readonly provenance: Readonly<Record<string, unknown>> | null;
  readonly buildErrorCode: string | null;
  readonly buildErrorMessage: string | null;
  readonly route: Readonly<{
    readonly start: Readonly<{ readonly xMm: number; readonly yMm: number }>;
    readonly end: Readonly<{ readonly xMm: number; readonly yMm: number }>;
    readonly speedMmPerSecond: number;
  }>;
  readonly createdAt: string;
}

export type EvaluationVerdict = "CLEAR" | "HOLD" | "ESCALATE";

export interface Evaluation {
  readonly id: string;
  readonly siteId: string;
  readonly robotId: string;
  readonly buildId: string;
  readonly evaluationId: string;
  readonly robotBuildId: string;
  readonly verdict: EvaluationVerdict;
  readonly safetyEnvelopeId: string;
  readonly evaluatorVersion: string;
  readonly robotBuildDigest: string;
  readonly safetyEnvelopeCommitment: string;
  readonly evaluationInputsDigest: string;
  readonly scenarioCount: number | null;
  readonly violationCount: number | null;
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
}

export type ReleaseStatus = "PREPARED" | "LEDGER_APPROVAL_REQUIRED" | "AUTHORIZED" | "BLOCKED";

export interface ReleaseAttempt {
  readonly id: string;
  readonly evaluationId: string;
  readonly status: ReleaseStatus;
  readonly code: string | null;
  readonly message: string;
  readonly createdAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
const SESSION_TOKEN_KEY = "rovaulta.session.token";

export function getClientSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem(SESSION_TOKEN_KEY) ??
      window.sessionStorage.getItem(SESSION_TOKEN_KEY)
    );
  } catch {
    return null;
  }
}

export function setClientSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token !== null && token.length > 0) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const token = getClientSessionToken();
  if (token !== null && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: init.cache ?? "no-store",
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.length === 0 ? null : JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : "REQUEST_FAILED",
      typeof record.message === "string" ? record.message : "Request failed",
    );
  }
  return payload as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
