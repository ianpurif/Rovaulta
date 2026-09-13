"use client";

import {
  createLedgerBrowserDependencies,
  createLedgerTransportRuntime,
  LedgerBrowserAdapter,
  parseLedgerTransportConfig,
} from "@rovaulta/ledger-gate";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type Account, ApiError, apiFetch } from "../api-client";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
const preparedHandoffKey = "rovaulta.p5.prepared";
const isSpeculos =
  (process.env.NEXT_PUBLIC_LEDGER_TRANSPORT?.trim().toLowerCase() ?? "webhid") === "speculos";

type PreparedHandoff = Readonly<{
  readonly version: 1;
  readonly scope: "account";
  readonly accountId: string;
  readonly prepared: Record<string, unknown>;
}>;

type DemoPreparedHandoff = Readonly<{
  readonly version: 1;
  readonly scope: "demo";
  readonly prepared: Record<string, unknown>;
}>;

function publicError(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) return String(error.code);
  if (error instanceof Error) return error.message;
  return "REQUEST_FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePreparedHandoff(value: unknown): PreparedHandoff | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.scope !== "account" ||
    typeof value.accountId !== "string" ||
    !isRecord(value.prepared)
  ) {
    return null;
  }
  return { version: 1, scope: "account", accountId: value.accountId, prepared: value.prepared };
}

function parseDemoPreparedHandoff(value: unknown): DemoPreparedHandoff | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.scope !== "demo" ||
    !isRecord(value.prepared)
  ) {
    return null;
  }
  return { version: 1, scope: "demo", prepared: value.prepared };
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "REQUEST_FAILED"));
  return payload;
}

export default function P5LedgerOperatorPage({
  allowDemoHandoff,
}: {
  readonly allowDemoHandoff: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const adapter = useRef<LedgerBrowserAdapter | null>(null);
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [clearanceJson, setClearanceJson] = useState("");
  const [prepared, setPrepared] = useState<Record<string, unknown> | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState("Checking the authenticated operator session…");
  const [authState, setAuthState] = useState<"checking" | "ready" | "error">("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authProbe, setAuthProbe] = useState(0);
  const demoHandoff = allowDemoHandoff && searchParams.get("source") === "p6";

  useEffect(() => {
    let active = true;
    let ledger: LedgerBrowserAdapter | null = null;
    setAuthState("checking");
    setAuthError(null);
    setPrepared(null);
    setStatus(
      demoHandoff
        ? "Loading the explicit development Ledger handoff."
        : "Checking the authenticated operator session…",
    );

    function loadHandoff(accountId: string | null) {
      const handoff = window.sessionStorage.getItem(preparedHandoffKey);
      if (handoff === null) return;
      try {
        const parsed = JSON.parse(handoff) as unknown;
        if (demoHandoff) {
          const demo = parseDemoPreparedHandoff(parsed);
          if (demo !== null) {
            setPrepared(demo.prepared);
            setStatus(
              "Exact P5 request handed off from the judge view. Connect Ledger to review it; authorization has not happened.",
            );
          } else {
            window.sessionStorage.removeItem(preparedHandoffKey);
            setStatus(
              "The prepared request was cleared because it is not a development fixture handoff.",
            );
          }
          return;
        }
        const scoped = parsePreparedHandoff(parsed);
        if (scoped === null || scoped.accountId !== accountId) {
          window.sessionStorage.removeItem(preparedHandoffKey);
          setStatus("The prepared request was cleared because it belongs to another account.");
          return;
        }
        setPrepared(scoped.prepared);
        setStatus(
          "Exact P5 request handed off from this account. Connect Ledger to review it; authorization has not happened.",
        );
      } catch {
        window.sessionStorage.removeItem(preparedHandoffKey);
      }
    }

    function initializeLedger(accountId: string | null) {
      if (!active) return;
      loadHandoff(accountId);
      try {
        const ledgerTransport = parseLedgerTransportConfig(
          process.env.NEXT_PUBLIC_LEDGER_TRANSPORT,
          process.env.NEXT_PUBLIC_LEDGER_SPECULOS_URL,
          process.env.NODE_ENV,
        );
        ledger = new LedgerBrowserAdapter(
          process.env.NEXT_PUBLIC_LEDGER_ORIGIN_TOKEN ?? "",
          process.env.NEXT_PUBLIC_LEDGER_DERIVATION_PATH || undefined,
          createLedgerBrowserDependencies(
            createLedgerTransportRuntime(ledgerTransport, process.env.NODE_ENV),
          ),
        );
        adapter.current = ledger;
        setAuthState("ready");
      } catch (error) {
        setAuthState("error");
        setAuthError(publicError(error));
        setStatus("Failed to initialize Ledger transport.");
      }
    }

    if (demoHandoff) {
      initializeLedger(null);
    } else {
      void apiFetch<{ account: Account }>(`/auth/me?probe=${authProbe}`)
        .then(({ account }) => initializeLedger(account.id))
        .catch((error: unknown) => {
          if (!active) return;
          window.sessionStorage.removeItem(preparedHandoffKey);
          if (error instanceof ApiError && error.status === 401) {
            router.replace(`/start?next=${encodeURIComponent("/p5-ledger")}`);
            return;
          }
          setAuthState("error");
          setAuthError(publicError(error));
          setStatus("The authenticated operator session could not be checked.");
        });
    }

    return () => {
      active = false;
      if (adapter.current === ledger) adapter.current = null;
      void ledger?.disconnect();
    };
  }, [authProbe, demoHandoff, router]);

  async function connect() {
    try {
      setStatus("Waiting for Ledger connection and address confirmation…");
      const connected = await adapter.current?.connect();
      setSession(connected ? { ...connected } : null);
      setSignature(null);
      setResult(null);
      setStatus("Ledger connected. Paste a public P1 clearance record to run the pre-sign gate.");
    } catch (error) {
      setStatus(publicError(error));
    }
  }

  async function prepare() {
    try {
      if (session === null) throw new Error("DEVICE_DISCONNECTED");
      const clearance = JSON.parse(clearanceJson) as Record<string, unknown>;
      const inputs = clearance.inputs as Record<string, unknown>;
      const response = await post("/release/prepare", {
        siteId: inputs.siteId,
        robotId: inputs.robotId,
        robotBuildId: inputs.robotBuildId,
        robotBuildDigest: inputs.robotBuildDigest,
        clearance,
        signerAddress: session.signerAddress,
      });
      window.sessionStorage.removeItem(preparedHandoffKey);
      setPrepared(response);
      setSignature(null);
      setResult(null);
      setStatus(
        "Eligible exact intent prepared. Signing proceeds only if Ledger resolves every required display field.",
      );
    } catch (error) {
      setStatus(publicError(error));
    }
  }

  async function approve() {
    try {
      if (prepared === null) throw new Error("NO_PREPARED_REQUEST");
      setStatus("Review the exact fields on Ledger; unresolved Clear Signing aborts the request.");
      const approval = await adapter.current?.sign(prepared);
      if (approval === undefined) throw new Error("DEVICE_DISCONNECTED");
      setSignature(approval.signature);
      setStatus("Signature received. It is not authorization until server verification succeeds.");
    } catch (error) {
      setStatus(publicError(error));
    }
  }

  async function consume() {
    try {
      if (prepared === null || signature === null) throw new Error("NO_LEDGER_SIGNATURE");
      const authorization = await post("/release/consume", {
        intent: prepared.intent,
        signature,
      });
      setResult(authorization);
      setStatus("One-time ReleaseAuthorization verified and nonce consumed.");
    } catch (error) {
      setStatus(publicError(error));
    }
  }

  if (authState === "checking") {
    return (
      <main className="product-loading" id="main-content">
        <div className="real-loading-card">
          <span className="loading-spinner" aria-hidden="true" />
          <h1>Checking operator access</h1>
          <p>
            Private release handoffs are available only to the authenticated account that created
            them.
          </p>
        </div>
      </main>
    );
  }

  if (authState === "error") {
    return (
      <main className="product-loading" id="main-content">
        <div className="real-loading-card">
          <h1>Operator access unavailable</h1>
          <p>{authError ?? "The authenticated operator session could not be checked."}</p>
          <button
            type="button"
            className="view-primary-action"
            onClick={() => setAuthProbe((value) => value + 1)}
          >
            Try again
          </button>
          <Link className="path-action" href="/app/releases">
            Return to releases
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell p5-operator" id="main-content">
      <header className="operator-topbar">
        <Link className="brand-lockup" href="/app" aria-label="Back to Rovaulta workspace">
          <Image
            className="brand-wordmark-image"
            src="/brand/rovaulta-wordmark.png"
            alt=""
            width={150}
            height={30}
          />
          <span>
            <small>Human release gate</small>
          </span>
        </Link>
        <Link className="operator-back-link" href="/app/releases">
          Back to releases <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className="operator-heading">
        <p className="eyebrow">
          {isSpeculos
            ? "HUMAN APPROVAL / LEDGER SPECULOS SIMULATOR"
            : "HUMAN APPROVAL / LEDGER DEVICE"}
        </p>
        <span className="operator-step-state">STEP 4 OF 4 · OPERATOR ACTION</span>
      </div>
      <h1>Approve the exact release.</h1>
      <p className="lede">
        The agent can prepare a request, but only you can verify the exact fields on Ledger.{" "}
        {isSpeculos ? "This run uses Ledger's official simulator. " : ""}
        This harness does not activate a robot or decide whether a clearance is valid.
      </p>
      <ol className="operator-stepper" aria-label="Human approval steps">
        <li className="is-complete">
          <span>1</span>Prepare exact intent
        </li>
        <li className="is-current">
          <span>2</span>Review on device
        </li>
        <li>
          <span>3</span>Verify and consume once
        </li>
      </ol>
      <div className="operator-actions">
        <button type="button" onClick={connect}>
          Connect and verify Ledger
        </button>
        <button type="button" onClick={prepare}>
          Run deterministic pre-sign gate
        </button>
        <button type="button" onClick={approve}>
          {isSpeculos ? "Request simulator approval" : "Request physical approval"}
        </button>
        <button type="button" onClick={consume}>
          Verify and consume once
        </button>
      </div>
      <details className="operator-input-details" open={prepared === null}>
        <summary>Advanced: provide a public P1 clearance record</summary>
        <label htmlFor="clearance">Public P1 clearance record</label>
        <textarea
          id="clearance"
          rows={16}
          spellCheck={false}
          value={clearanceJson}
          onChange={(event) => {
            setClearanceJson(event.target.value);
            window.sessionStorage.removeItem(preparedHandoffKey);
            setPrepared(null);
            setSignature(null);
            setResult(null);
          }}
        />
      </details>
      <section className="card operator-status">
        <strong>Current status</strong>
        <span>{status}</span>
      </section>
      {session ? <pre>{JSON.stringify(session, null, 2)}</pre> : null}
      {prepared ? <pre>{JSON.stringify(prepared, null, 2)}</pre> : null}
      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
    </main>
  );
}
