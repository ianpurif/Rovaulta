"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  type Account,
  ApiError,
  apiFetch,
  type Build,
  type Evaluation,
  jsonBody,
  type ReleaseAttempt,
  type Robot,
  type Site,
} from "./api-client";

export type ProductView = "overview" | "setup" | "builds" | "evaluate" | "releases" | "evidence";

interface WorkspaceData {
  readonly account: Account;
  readonly sites: readonly Site[];
  readonly robots: readonly Robot[];
  readonly builds: readonly Build[];
  readonly evaluations: readonly Evaluation[];
  readonly releases: readonly ReleaseAttempt[];
}

const navItems: readonly Readonly<{ href: string; label: string; view: ProductView }>[] = [
  { href: "/app", label: "Overview", view: "overview" },
  { href: "/app/setup", label: "Set up", view: "setup" },
  { href: "/app/builds", label: "Builds", view: "builds" },
  { href: "/app/evaluate", label: "Evaluate", view: "evaluate" },
  { href: "/app/releases", label: "Releases", view: "releases" },
  { href: "/app/evidence", label: "Evidence", view: "evidence" },
] as const;

function ProductBrand() {
  return (
    <Link className="brand-lockup product-brand" href="/app" aria-label="Rovaulta workspace home">
      <Image
        className="brand-mark-image"
        src="/brand/rovaulta-mark.png"
        alt=""
        width={29}
        height={33}
      />
      <span>
        <strong>Rovaulta</strong>
        <small>Deployment safety</small>
      </span>
    </Link>
  );
}

function StatusPill({ status }: { readonly status: string }) {
  const className = status.toLowerCase().replaceAll("_", "-");
  return <span className={`real-status-pill ${className}`}>{status}</span>;
}

function ErrorNotice({ message }: { readonly message: string }) {
  return (
    <p className="real-error" role="alert">
      {message}
    </p>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <section className="real-empty-state">
      <span className="real-empty-icon" aria-hidden="true">
        +
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}

function ProductSidebar({
  view,
  data,
  onSignOut,
  signOutBusy,
  signOutError,
}: {
  readonly view: ProductView;
  readonly data: WorkspaceData;
  readonly onSignOut: () => void;
  readonly signOutBusy: boolean;
  readonly signOutError: string | null;
}) {
  const site = data.sites[0];
  return (
    <aside className="product-sidebar real-sidebar">
      <div className="product-sidebar-top">
        <ProductBrand />
        <div className="sidebar-workspace-card">
          <span className="sidebar-label">Account</span>
          <strong>{data.account.email}</strong>
          <span>{site?.name ?? "No site configured"}</span>
        </div>
        <nav className="product-nav" aria-label="Workspace navigation">
          <span className="sidebar-label">Workspace</span>
          {navItems.map((item) => (
            <Link
              className={`product-nav-link ${item.view === view ? "is-active" : ""}`}
              href={item.href}
              aria-current={item.view === view ? "page" : undefined}
              key={item.view}
            >
              <span className={`nav-icon nav-icon-${item.view}`} aria-hidden="true" />
              {item.label}
              {item.view === "evaluate" && data.builds.length > 0 ? (
                <span className="nav-count">{data.builds.length}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
      <div className="product-sidebar-bottom">
        {signOutError !== null ? (
          <p className="real-error" role="alert">
            {signOutError}
          </p>
        ) : null}
        <div className="sidebar-boundary-card">
          <span className="sidebar-boundary-icon" aria-hidden="true">
            ◇
          </span>
          <span>
            <strong>Private by design</strong>
            <small>Policy rules stay in the API boundary.</small>
          </span>
        </div>
        <button
          type="button"
          className="sidebar-back-link real-signout"
          onClick={onSignOut}
          disabled={signOutBusy}
        >
          {signOutBusy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}

function ProductHeader({
  view,
  data,
}: {
  readonly view: ProductView;
  readonly data: WorkspaceData;
}) {
  const labels: Readonly<Record<ProductView, string>> = {
    overview: "Overview",
    setup: "Site setup",
    builds: "Builds",
    evaluate: "Evaluation",
    releases: "Releases",
    evidence: "Evidence",
  };
  return (
    <header className="product-header">
      <div>
        <p className="product-breadcrumb">
          Workspace <span aria-hidden="true">/</span> {labels[view]}
        </p>
        <span className="product-header-context">
          {data.sites[0]?.name ?? "No site configured"}
        </span>
      </div>
      <div className="product-header-actions">
        <span className="workspace-status">
          <i aria-hidden="true" /> Account workspace
        </span>
      </div>
    </header>
  );
}

function OverviewView({ data }: { readonly data: WorkspaceData }) {
  const site = data.sites[0];
  const latest = data.evaluations[0];
  if (site === undefined) {
    return (
      <div className="product-view">
        <div className="view-heading-row">
          <div>
            <p className="view-eyebrow">Workspace overview</p>
            <h1>Start with a real deployment target.</h1>
            <p className="view-lede">
              Create a site, keep its policy private, then register the first robot build you want
              to review.
            </p>
          </div>
        </div>
        <EmptyState
          title="No site yet"
          body="Your account is ready. Add the facility and its private evaluation policy to begin."
          action={
            <Link className="view-primary-action" href="/app/setup">
              Set up a site <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="product-view overview-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Workspace overview</p>
          <h1>Make the next release easy to trust.</h1>
          <p className="view-lede">
            Rovaulta keeps the target, exact build, evaluation result, and human handoff in one
            accountable path.
          </p>
        </div>
        <Link className="view-primary-action" href="/app/evaluate">
          Evaluate a build <span aria-hidden="true">→</span>
        </Link>
      </div>
      <section className="workspace-summary-card" aria-labelledby="real-summary-title">
        <div className="summary-card-heading">
          <div>
            <span className="view-eyebrow">Current target</span>
            <h2 id="real-summary-title">{site.name}</h2>
          </div>
          <span className="summary-ready-pill">
            <i aria-hidden="true" /> Account-owned
          </span>
        </div>
        <div className="summary-facts">
          <div>
            <span>Location</span>
            <strong>{site.location}</strong>
            <small>Private policy commitment recorded</small>
          </div>
          <div>
            <span>Robots</span>
            <strong>{data.robots.length}</strong>
            <small>{data.robots.length === 1 ? "robot registered" : "robots registered"}</small>
          </div>
          <div>
            <span>Builds</span>
            <strong>{data.builds.length}</strong>
            <small>
              {data.builds.length === 0 ? "Register a build to evaluate" : "Exact build identities"}
            </small>
          </div>
        </div>
      </section>
      <section className="product-section-heading">
        <div>
          <p className="view-eyebrow">Release path</p>
          <h2>From target to accountable approval.</h2>
        </div>
        <span className="section-helper">Data belongs to {data.account.email}</span>
      </section>
      <ol className="release-path-list real-release-path">
        <li className="release-path-item is-complete">
          <span className="path-step">1</span>
          <div>
            <strong>Set up the target</strong>
            <p>Site, robot, and private policy are stored for this account.</p>
          </div>
          <span className="path-state">{site ? "READY" : "WAITING"}</span>
        </li>
        <li
          className={`release-path-item ${data.builds.length > 0 ? "is-complete" : "is-current"}`}
        >
          <span className="path-step">2</span>
          <div>
            <strong>Register an exact build</strong>
            <p>Record the artifact digest and declared route for evaluation.</p>
          </div>
          {data.builds.length > 0 ? (
            <span className="path-state">READY</span>
          ) : (
            <Link href="/app/setup" className="path-action">
              Add build <span aria-hidden="true">→</span>
            </Link>
          )}
        </li>
        <li className={`release-path-item ${latest ? "is-current" : ""}`}>
          <span className="path-step">3</span>
          <div>
            <strong>Evaluate the build</strong>
            <p>
              {latest
                ? `Latest result is ${latest.verdict}.`
                : "Request a confidential evaluation against the private site policy."}
            </p>
          </div>
          {latest ? (
            <StatusPill status={latest.verdict} />
          ) : (
            <Link href="/app/evaluate" className="path-action">
              Evaluate <span aria-hidden="true">→</span>
            </Link>
          )}
        </li>
        <li className="release-path-item">
          <span className="path-step">4</span>
          <div>
            <strong>Prepare and approve release</strong>
            <p>A public clearance and human Ledger confirmation are still required.</p>
          </div>
          <Link href="/app/releases" className="path-action">
            View releases <span aria-hidden="true">→</span>
          </Link>
        </li>
      </ol>
      <section className="overview-cards" aria-label="Account workspace details">
        <article className="overview-detail-card">
          <div className="detail-card-topline">
            <span className="view-eyebrow">Latest evaluation</span>
            <Link href="/app/evaluate">Open evaluation →</Link>
          </div>
          {latest ? (
            <>
              <h3>
                <StatusPill status={latest.verdict} />
              </h3>
              <p>
                {latest.violationCount === null
                  ? "The confidential evaluator returned the verdict; detailed findings remain inside the protected evaluation boundary."
                  : latest.violationCount === 0
                    ? "No public violations were returned by the evaluator."
                    : `${latest.violationCount} public violation${latest.violationCount === 1 ? "" : "s"} need attention before release.`}
              </p>
              <div className="proof-line">
                <span>Build</span>
                <strong>{latest.robotBuildId}</strong>
              </div>
            </>
          ) : (
            <>
              <h3>No evaluation yet</h3>
              <p>Choose a registered build to create the first public result.</p>
            </>
          )}
        </article>
        <article className="overview-detail-card">
          <div className="detail-card-topline">
            <span className="view-eyebrow">Private policy</span>
            <Link href="/app/evidence">View boundaries →</Link>
          </div>
          <h3>Commitment only in the browser</h3>
          <p>
            The application shows a commitment and public result. Restricted geometry, thresholds,
            and the blind stay inside the API evaluation boundary.
          </p>
          <div className="proof-line">
            <span>Envelope</span>
            <strong>{site.safetyEnvelopeId}</strong>
          </div>
        </article>
      </section>
    </div>
  );
}

interface SetupFormState {
  readonly siteName: string;
  readonly location: string;
  readonly robotName: string;
  readonly robotId: string;
  readonly version: string;
  readonly label: string;
  readonly buildMode: "existing" | "source";
  readonly artifactDigest: string;
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly buildCommand: string;
  readonly runtime: "bun" | "node";
  readonly startX: string;
  readonly startY: string;
  readonly endX: string;
  readonly endY: string;
  readonly speed: string;
  readonly width: string;
  readonly height: string;
  readonly zoneMinX: string;
  readonly zoneMinY: string;
  readonly zoneMaxX: string;
  readonly zoneMaxY: string;
  readonly maxSpeed: string;
  readonly zoneSpeed: string;
  readonly payloadThreshold: string;
}

const INITIAL_SETUP: SetupFormState = {
  siteName: "",
  location: "",
  robotName: "",
  robotId: "",
  version: "",
  label: "",
  buildMode: "existing",
  artifactDigest: "",
  sourceRepository: "",
  sourceRevision: "",
  buildCommand: "bun run build",
  runtime: "bun",
  startX: "100",
  startY: "100",
  endX: "900",
  endY: "100",
  speed: "400",
  width: "1000",
  height: "1000",
  zoneMinX: "400",
  zoneMinY: "400",
  zoneMaxX: "600",
  zoneMaxY: "600",
  maxSpeed: "1000",
  zoneSpeed: "600",
  payloadThreshold: "40000",
};

function SetupView({
  data,
  refresh,
}: {
  readonly data: WorkspaceData;
  readonly refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<SetupFormState>(INITIAL_SETUP);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (field: keyof SetupFormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const site = await apiFetch<{ site: Site }>("/sites", {
        method: "POST",
        body: jsonBody({
          name: form.siteName,
          location: form.location,
          policy: {
            warehouseWidthMm: Number(form.width),
            warehouseHeightMm: Number(form.height),
            restrictedZone: {
              minXmm: Number(form.zoneMinX),
              minYmm: Number(form.zoneMinY),
              maxXmm: Number(form.zoneMaxX),
              maxYmm: Number(form.zoneMaxY),
            },
            maximumSpeedMmPerSecond: Number(form.maxSpeed),
            zoneSpeedLimitMmPerSecond: Number(form.zoneSpeed),
            payloadThresholdGrams: Number(form.payloadThreshold),
          },
        }),
      });
      const robot = await apiFetch<{ robot: Robot }>(`/sites/${site.site.id}/robots`, {
        method: "POST",
        body: jsonBody({ name: form.robotName }),
      });
      const buildPayload = {
        robotId: robot.robot.id,
        version: form.version,
        label: form.label,
        route: {
          start: { xMm: Number(form.startX), yMm: Number(form.startY) },
          end: { xMm: Number(form.endX), yMm: Number(form.endY) },
          speedMmPerSecond: Number(form.speed),
        },
      };
      await apiFetch<{ build: Build }>(
        form.buildMode === "source"
          ? `/sites/${site.site.id}/source-builds`
          : `/sites/${site.site.id}/builds`,
        {
          method: "POST",
          body: jsonBody(
            form.buildMode === "source"
              ? {
                  ...buildPayload,
                  sourceRepository: form.sourceRepository,
                  sourceRevision: form.sourceRevision,
                  buildCommand: form.buildCommand,
                  runtime: form.runtime,
                }
              : { ...buildPayload, artifactDigest: form.artifactDigest },
          ),
        },
      );
      await refresh();
      router.push(form.buildMode === "source" ? "/app/builds" : "/app");
    } catch (reason) {
      setError(
        reason instanceof ApiError ? reason.message : "The setup could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const sourceBuildReady =
    /^https:\/\/(?:github\.com|gitlab\.com)\/[^?#\s]+$/.test(form.sourceRepository.trim()) &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(form.sourceRevision.trim()) &&
    /^(?:bun|node|npm)(?:\s+[A-Za-z0-9_./:@=+-]+)*$/.test(form.buildCommand.trim()) &&
    ((form.runtime === "bun" && form.buildCommand.trim().startsWith("bun")) ||
      (form.runtime === "node" &&
        (form.buildCommand.trim().startsWith("node") ||
          form.buildCommand.trim().startsWith("npm"))));
  const buildReady =
    form.buildMode === "existing"
      ? /^sha256:[0-9a-f]{64}$/.test(form.artifactDigest.trim().toLowerCase())
      : sourceBuildReady;
  const existingSite = data.sites[0];
  if (existingSite !== undefined && searchParams.get("mode") === "build")
    return <BuildOnlyView data={data} site={existingSite} refresh={refresh} />;
  if (existingSite !== undefined) {
    const site = existingSite;
    return (
      <div className="product-view setup-view">
        <div className="view-heading-row">
          <div>
            <p className="view-eyebrow">Site setup</p>
            <h1>{site.name} is connected to this account.</h1>
            <p className="view-lede">
              The private safety policy is represented here by its public commitment. Add more
              builds from the Builds view.
            </p>
          </div>
          <StatusPill status="READY" />
        </div>
        <section className="real-record-card">
          <dl className="real-facts">
            <div>
              <dt>Location</dt>
              <dd>{site.location}</dd>
            </div>
            <div>
              <dt>Safety envelope</dt>
              <dd>
                <code>{site.safetyEnvelopeId}</code>
              </dd>
            </div>
            <div>
              <dt>Commitment</dt>
              <dd>
                <code>{site.safetyEnvelopeCommitment}</code>
              </dd>
            </div>
            <div>
              <dt>Robots</dt>
              <dd>{data.robots.length}</dd>
            </div>
          </dl>
          <p className="real-boundary-copy">
            The policy contents, restricted geometry, thresholds, and blinding secret are not
            readable from this page or from the browser.
          </p>
          <Link className="view-primary-action" href="/app/builds">
            Manage builds <span aria-hidden="true">→</span>
          </Link>
        </section>
      </div>
    );
  }
  const steps = ["Site and policy", "Robot", "Exact build"];
  return (
    <div className="product-view setup-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">First-time setup</p>
          <h1>Create the target you actually operate.</h1>
          <p className="view-lede">
            This is saved to your account. The safety policy is encrypted at rest and only its
            commitment is returned to the browser.
          </p>
        </div>
        <span className="local-only-badge">Account-backed</span>
      </div>
      <section className="real-onboarding-card">
        <nav className="real-stepper" aria-label={`Setup step ${step + 1} of ${steps.length}`}>
          {steps.map((label, index) => (
            <span
              className={index === step ? "active" : index < step ? "complete" : ""}
              key={label}
            >
              <i aria-hidden="true">{index < step ? "✓" : index + 1}</i>
              {label}
            </span>
          ))}
        </nav>
        {error ? <ErrorNotice message={error} /> : null}
        {step === 0 ? (
          <div className="real-form-grid">
            <label>
              Site name
              <input
                value={form.siteName}
                onChange={(event) => update("siteName", event.target.value)}
                placeholder="North dock facility"
                required
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(event) => update("location", event.target.value)}
                placeholder="City or facility code"
                required
              />
            </label>
            <fieldset>
              <legend>Private evaluation policy</legend>
              <p className="field-help">
                Use the measurements and rules your safety team owns. These values are never
                returned after save.
              </p>
              <div className="real-inline-fields">
                <label>
                  Width (mm)
                  <input
                    type="number"
                    value={form.width}
                    onChange={(event) => update("width", event.target.value)}
                  />
                </label>
                <label>
                  Height (mm)
                  <input
                    type="number"
                    value={form.height}
                    onChange={(event) => update("height", event.target.value)}
                  />
                </label>
                <label>
                  Max speed
                  <input
                    type="number"
                    value={form.maxSpeed}
                    onChange={(event) => update("maxSpeed", event.target.value)}
                  />
                </label>
                <label>
                  Zone speed
                  <input
                    type="number"
                    value={form.zoneSpeed}
                    onChange={(event) => update("zoneSpeed", event.target.value)}
                  />
                </label>
                <label>
                  Payload threshold (g)
                  <input
                    type="number"
                    value={form.payloadThreshold}
                    onChange={(event) => update("payloadThreshold", event.target.value)}
                  />
                </label>
              </div>
              <p className="field-help">Restricted rectangle</p>
              <div className="real-inline-fields">
                <label>
                  Min X
                  <input
                    type="number"
                    value={form.zoneMinX}
                    onChange={(event) => update("zoneMinX", event.target.value)}
                  />
                </label>
                <label>
                  Min Y
                  <input
                    type="number"
                    value={form.zoneMinY}
                    onChange={(event) => update("zoneMinY", event.target.value)}
                  />
                </label>
                <label>
                  Max X
                  <input
                    type="number"
                    value={form.zoneMaxX}
                    onChange={(event) => update("zoneMaxX", event.target.value)}
                  />
                </label>
                <label>
                  Max Y
                  <input
                    type="number"
                    value={form.zoneMaxY}
                    onChange={(event) => update("zoneMaxY", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>
            <button
              type="button"
              className="view-primary-action"
              onClick={() => setStep(1)}
              disabled={!form.siteName.trim() || !form.location.trim()}
            >
              Continue <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="real-form-grid">
            <label>
              Robot name
              <input
                value={form.robotName}
                onChange={(event) => update("robotName", event.target.value)}
                placeholder="AMR-01"
                required
              />
            </label>
            <p className="field-help">
              The robot is linked to this site and cannot be evaluated under another account.
            </p>
            <div className="real-form-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="view-primary-action"
                onClick={() => setStep(2)}
                disabled={!form.robotName.trim()}
              >
                Continue <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="real-form-grid">
            <label>
              Build version
              <input
                value={form.version}
                onChange={(event) => update("version", event.target.value)}
                placeholder="2026.09.08"
                required
              />
            </label>
            <label>
              Build label
              <input
                value={form.label}
                onChange={(event) => update("label", event.target.value)}
                placeholder="Release candidate"
                required
              />
            </label>
            <fieldset>
              <legend>Build</legend>
              <div className="real-choice-grid">
                <label className="real-choice-card">
                  <input
                    type="radio"
                    name="build-mode"
                    value="existing"
                    checked={form.buildMode === "existing"}
                    onChange={() => update("buildMode", "existing")}
                  />
                  <span>
                    <strong>Use Existing Build</strong>
                    <small>Keep the current build-number and declared artifact flow.</small>
                  </span>
                </label>
                <label className="real-choice-card">
                  <input
                    type="radio"
                    name="build-mode"
                    value="source"
                    checked={form.buildMode === "source"}
                    onChange={() => update("buildMode", "source")}
                  />
                  <span>
                    <strong>Build From Source</strong>
                    <small>Build an exact commit in Rovaulta's isolated runner first.</small>
                  </span>
                </label>
              </div>
            </fieldset>
            {form.buildMode === "existing" ? (
              <label>
                Artifact digest
                <input
                  value={form.artifactDigest}
                  onChange={(event) => update("artifactDigest", event.target.value)}
                  placeholder="sha256:…"
                  required
                />
                <span className="field-help">
                  Use the digest produced by your build pipeline. Rovaulta records this identity; it
                  does not inspect the artifact bytes.
                </span>
              </label>
            ) : (
              <fieldset>
                <legend>Source build</legend>
                <label>
                  Repository
                  <input
                    value={form.sourceRepository}
                    onChange={(event) => update("sourceRepository", event.target.value)}
                    placeholder="https://github.com/org/repository"
                    type="url"
                    required
                  />
                </label>
                <label>
                  Revision / commit
                  <input
                    value={form.sourceRevision}
                    onChange={(event) => update("sourceRevision", event.target.value)}
                    placeholder="40 or 64 character commit SHA"
                    spellCheck={false}
                    required
                  />
                </label>
                <div className="real-inline-fields">
                  <label>
                    Runtime
                    <select
                      value={form.runtime}
                      onChange={(event) => update("runtime", event.target.value)}
                    >
                      <option value="bun">Bun</option>
                      <option value="node">Node</option>
                    </select>
                  </label>
                  <label>
                    Build command
                    <input
                      value={form.buildCommand}
                      onChange={(event) => update("buildCommand", event.target.value)}
                      placeholder="bun run build"
                      spellCheck={false}
                      required
                    />
                  </label>
                </div>
                <span className="field-help">
                  Bun builds require the repository&apos;s bun.lock or bun.lockb. Dependency
                  installation is frozen; there is no unlocked fallback.
                </span>
              </fieldset>
            )}
            <fieldset>
              <legend>Declared route for evaluation</legend>
              <div className="real-inline-fields">
                <label>
                  Start X
                  <input
                    type="number"
                    value={form.startX}
                    onChange={(event) => update("startX", event.target.value)}
                  />
                </label>
                <label>
                  Start Y
                  <input
                    type="number"
                    value={form.startY}
                    onChange={(event) => update("startY", event.target.value)}
                  />
                </label>
                <label>
                  End X
                  <input
                    type="number"
                    value={form.endX}
                    onChange={(event) => update("endX", event.target.value)}
                  />
                </label>
                <label>
                  End Y
                  <input
                    type="number"
                    value={form.endY}
                    onChange={(event) => update("endY", event.target.value)}
                  />
                </label>
                <label>
                  Speed (mm/s)
                  <input
                    type="number"
                    value={form.speed}
                    onChange={(event) => update("speed", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>
            <div className="real-form-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setStep(1)}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="view-primary-action"
                onClick={() => void submit()}
                disabled={busy || !form.version.trim() || !form.label.trim() || !buildReady}
              >
                {busy
                  ? form.buildMode === "source"
                    ? "Starting isolated build…"
                    : "Saving target…"
                  : form.buildMode === "source"
                    ? "Build from source"
                    : "Create target and build"}{" "}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function BuildOnlyView({
  data,
  site,
  refresh,
}: {
  readonly data: WorkspaceData;
  readonly site: Site;
  readonly refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SetupFormState>({
    ...INITIAL_SETUP,
    robotId: data.robots[0]?.id ?? "",
  });
  const [buildMode, setBuildMode] = useState<SetupFormState["buildMode"]>("existing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (field: keyof SetupFormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const sourceBuildReady =
    /^https:\/\/(?:github\.com|gitlab\.com)\/[^?#\s]+$/.test(form.sourceRepository.trim()) &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(form.sourceRevision.trim()) &&
    /^(?:bun|node|npm)(?:\s+[A-Za-z0-9_./:@=+-]+)*$/.test(form.buildCommand.trim()) &&
    ((form.runtime === "bun" && form.buildCommand.trim().startsWith("bun")) ||
      (form.runtime === "node" &&
        (form.buildCommand.trim().startsWith("node") ||
          form.buildCommand.trim().startsWith("npm"))));
  const buildReady =
    buildMode === "existing"
      ? /^sha256:[0-9a-f]{64}$/.test(form.artifactDigest.trim().toLowerCase())
      : sourceBuildReady;
  async function submit() {
    const robotId = form.robotId || data.robots[0]?.id;
    if (robotId === undefined) {
      setError("Create a robot before registering a build.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = {
        robotId,
        version: form.version,
        label: form.label,
        route: {
          start: { xMm: Number(form.startX), yMm: Number(form.startY) },
          end: { xMm: Number(form.endX), yMm: Number(form.endY) },
          speedMmPerSecond: Number(form.speed),
        },
      };
      await apiFetch<{ build: Build }>(
        buildMode === "source" ? `/sites/${site.id}/source-builds` : `/sites/${site.id}/builds`,
        {
          method: "POST",
          body: jsonBody(
            buildMode === "source"
              ? {
                  ...base,
                  sourceRepository: form.sourceRepository,
                  sourceRevision: form.sourceRevision,
                  buildCommand: form.buildCommand,
                  runtime: form.runtime,
                }
              : { ...base, artifactDigest: form.artifactDigest },
          ),
        },
      );
      await refresh();
      router.push("/app/builds");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The build could not be registered.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="product-view setup-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Add build</p>
          <h1>Choose how Rovaulta identifies this build.</h1>
          <p className="view-lede">
            This adds a build to {site.name} without changing existing build records or the private
            evaluation policy.
          </p>
        </div>
        <Link className="button-secondary" href="/app/builds">
          Back to builds
        </Link>
      </div>
      <section className="real-onboarding-card">
        {error ? <ErrorNotice message={error} /> : null}
        <div className="real-form-grid">
          <label>
            Robot
            <select
              value={form.robotId}
              onChange={(event) => update("robotId", event.target.value)}
            >
              {data.robots.map((robot) => (
                <option value={robot.id} key={robot.id}>
                  {robot.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Build version
            <input
              value={form.version}
              onChange={(event) => update("version", event.target.value)}
              placeholder="2026.09.12"
              required
            />
          </label>
          <label>
            Build label
            <input
              value={form.label}
              onChange={(event) => update("label", event.target.value)}
              placeholder="Release candidate"
              required
            />
          </label>
          <fieldset>
            <legend>Build</legend>
            <div className="real-choice-grid">
              <label className="real-choice-card">
                <input
                  type="radio"
                  name="additional-build-mode"
                  checked={buildMode === "existing"}
                  onChange={() => setBuildMode("existing")}
                />
                <span>
                  <strong>Use Existing Build</strong>
                  <small>Keep the current build-number and declared artifact flow.</small>
                </span>
              </label>
              <label className="real-choice-card">
                <input
                  type="radio"
                  name="additional-build-mode"
                  checked={buildMode === "source"}
                  onChange={() => setBuildMode("source")}
                />
                <span>
                  <strong>Build From Source</strong>
                  <small>Build this exact commit in the isolated runner.</small>
                </span>
              </label>
            </div>
          </fieldset>
          {buildMode === "existing" ? (
            <label>
              Artifact digest
              <input
                value={form.artifactDigest}
                onChange={(event) => update("artifactDigest", event.target.value)}
                placeholder="sha256:…"
                required
              />
            </label>
          ) : (
            <fieldset>
              <legend>Source build</legend>
              <label>
                Repository
                <input
                  value={form.sourceRepository}
                  onChange={(event) => update("sourceRepository", event.target.value)}
                  placeholder="https://github.com/org/repository"
                  type="url"
                  required
                />
              </label>
              <label>
                Revision / commit
                <input
                  value={form.sourceRevision}
                  onChange={(event) => update("sourceRevision", event.target.value)}
                  placeholder="40 or 64 character commit SHA"
                  spellCheck={false}
                  required
                />
              </label>
              <div className="real-inline-fields">
                <label>
                  Runtime
                  <select
                    value={form.runtime}
                    onChange={(event) => update("runtime", event.target.value)}
                  >
                    <option value="bun">Bun</option>
                    <option value="node">Node</option>
                  </select>
                </label>
                <label>
                  Build command
                  <input
                    value={form.buildCommand}
                    onChange={(event) => update("buildCommand", event.target.value)}
                    placeholder="bun run build"
                    spellCheck={false}
                    required
                  />
                </label>
              </div>
              <span className="field-help">
                Frozen lockfile installation is required; a failed install cannot fall back to an
                unlocked dependency install.
              </span>
            </fieldset>
          )}
          <fieldset>
            <legend>Declared route for evaluation</legend>
            <div className="real-inline-fields">
              <label>
                Start X
                <input
                  type="number"
                  value={form.startX}
                  onChange={(event) => update("startX", event.target.value)}
                />
              </label>
              <label>
                Start Y
                <input
                  type="number"
                  value={form.startY}
                  onChange={(event) => update("startY", event.target.value)}
                />
              </label>
              <label>
                End X
                <input
                  type="number"
                  value={form.endX}
                  onChange={(event) => update("endX", event.target.value)}
                />
              </label>
              <label>
                End Y
                <input
                  type="number"
                  value={form.endY}
                  onChange={(event) => update("endY", event.target.value)}
                />
              </label>
              <label>
                Speed (mm/s)
                <input
                  type="number"
                  value={form.speed}
                  onChange={(event) => update("speed", event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <div className="real-form-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => router.push("/app/builds")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="view-primary-action"
              onClick={() => void submit()}
              disabled={busy || !form.version.trim() || !form.label.trim() || !buildReady}
            >
              {busy
                ? buildMode === "source"
                  ? "Starting isolated build…"
                  : "Saving build…"
                : "Register build"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BuildsView({
  data,
  refresh,
}: {
  readonly data: WorkspaceData;
  readonly refresh: () => Promise<void>;
}) {
  const hasRunningBuild = data.builds.some((build) => build.buildStatus === "BUILDING");
  useEffect(() => {
    if (!hasRunningBuild) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasRunningBuild, refresh]);
  if (data.sites.length === 0)
    return (
      <div className="product-view">
        <EmptyState
          title="Set up a site first"
          body="Build identities are always scoped to a real site and robot."
          action={
            <Link className="view-primary-action" href="/app/setup">
              Set up site <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </div>
    );
  if (data.builds.length === 0)
    return (
      <div className="product-view">
        <div className="view-heading-row">
          <div>
            <p className="view-eyebrow">Builds</p>
            <h1>Register the exact artifact.</h1>
            <p className="view-lede">
              Choose the existing build-number flow or ask Rovaulta to independently build an exact
              source revision before evaluation.
            </p>
          </div>
        </div>
        <EmptyState
          title="No builds registered"
          body="Return to site setup to register the first build for this account."
          action={
            <Link className="view-primary-action" href="/app/setup?mode=build">
              Register first build <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="product-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Builds</p>
          <h1>Exact robot build identities.</h1>
          <p className="view-lede">
            Existing build numbers remain valid. Source-built records expose the artifact digest and
            provenance that the exact evaluation binds to.
          </p>
        </div>
        <Link className="view-primary-action" href="/app/setup?mode=build">
          Add build <span aria-hidden="true">→</span>
        </Link>
      </div>
      <ul className="real-list">
        {data.builds.map((build) => (
          <li className="real-list-card" key={build.id}>
            <div>
              <span className="view-eyebrow">{build.label}</span>
              <h2>{build.version}</h2>
              <p>
                {build.robotId} · {build.id}
              </p>
              <div className="real-inline-statuses">
                <StatusPill status={build.buildMode === "SOURCE" ? "SOURCE" : "EXISTING"} />
                <StatusPill status={build.buildStatus} />
                <StatusPill
                  status={
                    data.evaluations.find((evaluation) => evaluation.buildId === build.id)
                      ?.verdict ?? (build.buildStatus === "BUILD_SUCCEEDED" ? "NOT_RUN" : "BLOCKED")
                  }
                />
              </div>
            </div>
            <div className="real-list-meta">
              {build.artifactDigest !== null ? (
                <span>
                  Artifact <code>{build.artifactDigest}</code>
                </span>
              ) : null}
              {build.robotBuildDigest !== null ? (
                <span>
                  Build digest <code>{build.robotBuildDigest}</code>
                </span>
              ) : null}
              {build.buildMode === "SOURCE" ? (
                <>
                  <span>
                    Source <code>{build.sourceRepository}</code>
                  </span>
                  <span>
                    Revision <code>{build.sourceRevision}</code>
                  </span>
                  <span>
                    Command <code>{build.buildCommand}</code>
                  </span>
                  {build.buildErrorMessage !== null ? (
                    <span className="real-error">{build.buildErrorMessage}</span>
                  ) : null}
                  <details className="build-evidence-details">
                    <summary>Evidence details</summary>
                    <dl className="real-facts">
                      <div>
                        <dt>Source snapshot</dt>
                        <dd>
                          <code>{build.sourceSnapshotDigest ?? "Pending"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Lockfile</dt>
                        <dd>
                          <code>{build.lockfileDigest ?? "Pending"}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>
                          {build.runtime === null
                            ? "Pending"
                            : `${build.runtime.name} ${build.runtime.version}`}
                        </dd>
                      </div>
                      <div>
                        <dt>Builder</dt>
                        <dd>
                          {build.builder === null
                            ? "Pending"
                            : `${build.builder.id} ${build.builder.version}`}
                        </dd>
                      </div>
                    </dl>
                    {build.provenance !== null ? (
                      <pre className="build-provenance-json">
                        {JSON.stringify(build.provenance, null, 2)}
                      </pre>
                    ) : null}
                  </details>
                </>
              ) : null}
              {build.buildStatus === "BUILD_SUCCEEDED" ? (
                <Link
                  className="path-action"
                  href={`/app/evaluate?build=${encodeURIComponent(build.id)}`}
                >
                  Evaluate <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <span className="field-help">
                  {build.buildStatus === "BUILDING"
                    ? "Evaluation unlocks after the build succeeds."
                    : "Evaluation is blocked because the build failed."}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvaluateView({
  data,
  refresh,
}: {
  readonly data: WorkspaceData;
  readonly refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedBuildId = searchParams.get("build");
  const requestedSiteId = searchParams.get("site");
  const requestedRobotId = searchParams.get("robot");
  const requestedBuild = data.builds.find((build) => build.id === requestedBuildId);
  const initialSiteId =
    requestedBuild?.siteId ??
    (requestedSiteId !== null && data.sites.some((site) => site.id === requestedSiteId)
      ? requestedSiteId
      : (data.sites[0]?.id ?? ""));
  const initialRobots = data.robots.filter((robot) => robot.siteId === initialSiteId);
  const initialRobotId =
    requestedBuild?.robotId ??
    (requestedRobotId !== null && initialRobots.some((robot) => robot.id === requestedRobotId)
      ? requestedRobotId
      : (initialRobots[0]?.id ?? ""));
  const initialBuildId =
    requestedBuild !== undefined &&
    requestedBuild.siteId === initialSiteId &&
    requestedBuild.robotId === initialRobotId
      ? requestedBuild.id
      : (data.builds.find(
          (build) => build.siteId === initialSiteId && build.robotId === initialRobotId,
        )?.id ?? "");
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId);
  const [selectedRobotId, setSelectedRobotId] = useState(initialRobotId);
  const [selectedBuildId, setSelectedBuildId] = useState(initialBuildId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const robotsForSite = data.robots.filter((robot) => robot.siteId === selectedSiteId);
  const buildsForRobot = data.builds.filter(
    (build) => build.siteId === selectedSiteId && build.robotId === selectedRobotId,
  );

  useEffect(() => {
    if (data.sites.length === 0) {
      if (selectedSiteId !== "") setSelectedSiteId("");
      return;
    }
    if (!data.sites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId(data.sites[0]?.id ?? "");
    }
  }, [data.sites, selectedSiteId]);

  useEffect(() => {
    const nextRobotId = robotsForSite.some((robot) => robot.id === selectedRobotId)
      ? selectedRobotId
      : (robotsForSite[0]?.id ?? "");
    if (nextRobotId !== selectedRobotId) setSelectedRobotId(nextRobotId);
  }, [robotsForSite, selectedRobotId]);

  useEffect(() => {
    const nextBuildId = buildsForRobot.some((build) => build.id === selectedBuildId)
      ? selectedBuildId
      : (buildsForRobot[0]?.id ?? "");
    if (nextBuildId !== selectedBuildId) setSelectedBuildId(nextBuildId);
  }, [buildsForRobot, selectedBuildId]);

  const selected = buildsForRobot.find((build) => build.id === selectedBuildId);
  const latest = data.evaluations.find((evaluation) => evaluation.buildId === selectedBuildId);

  function updateSelectionUrl(siteId: string, robotId: string, buildId: string): void {
    const params = new URLSearchParams();
    if (siteId !== "") params.set("site", siteId);
    if (robotId !== "") params.set("robot", robotId);
    if (buildId !== "") params.set("build", buildId);
    const query = params.toString();
    router.replace(`/app/evaluate${query.length === 0 ? "" : `?${query}`}`);
  }

  function selectSite(siteId: string): void {
    const nextRobotId = data.robots.find((robot) => robot.siteId === siteId)?.id ?? "";
    const nextBuildId =
      data.builds.find((build) => build.siteId === siteId && build.robotId === nextRobotId)?.id ??
      "";
    setSelectedSiteId(siteId);
    setSelectedRobotId(nextRobotId);
    setSelectedBuildId(nextBuildId);
    updateSelectionUrl(siteId, nextRobotId, nextBuildId);
  }

  function selectRobot(robotId: string): void {
    const nextBuildId =
      data.builds.find((build) => build.siteId === selectedSiteId && build.robotId === robotId)
        ?.id ?? "";
    setSelectedRobotId(robotId);
    setSelectedBuildId(nextBuildId);
    updateSelectionUrl(selectedSiteId, robotId, nextBuildId);
  }

  function selectBuild(buildId: string): void {
    setSelectedBuildId(buildId);
    updateSelectionUrl(selectedSiteId, selectedRobotId, buildId);
  }

  async function evaluate() {
    if (selected === undefined || selectedSiteId === "" || selectedRobotId === "") return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<
        | { readonly evaluation: Evaluation }
        | { readonly status: "PENDING"; readonly evaluationId: string }
      >("/evaluations", {
        method: "POST",
        body: jsonBody({
          siteId: selectedSiteId,
          robotId: selectedRobotId,
          buildId: selected.id,
        }),
      });
      if ("status" in response && response.status === "PENDING") {
        setError("CRE accepted the evaluation. Waiting for the confidential result…");
        let completed = false;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            const status = await apiFetch<
              | { readonly evaluation: Evaluation }
              | { readonly status: "PENDING"; readonly evaluationId: string }
            >(`/evaluations/${response.evaluationId}`);
            if ("evaluation" in status) {
              completed = true;
              break;
            }
          } catch {
            break;
          }
        }
        if (!completed) {
          setError("CRE accepted the evaluation, but the completed result is not available yet.");
        } else {
          setError(null);
        }
      }
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CRE_EVALUATION_PENDING") {
        setError("CRE accepted the evaluation, but no completed result is available yet.");
      } else if (reason instanceof ApiError && reason.code === "CRE_UNAVAILABLE") {
        setError(`Confidential evaluation unavailable: ${reason.message}`);
      } else {
        setError(reason instanceof ApiError ? reason.message : "Evaluation failed");
      }
    } finally {
      setBusy(false);
    }
  }
  if (data.builds.length === 0)
    return (
      <div className="product-view">
        <EmptyState
          title="No build to evaluate"
          body="Register a site, robot, and exact artifact before asking for an evaluation."
          action={
            <Link className="view-primary-action" href="/app/setup">
              Set up a build <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="product-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Evaluation</p>
          <h1>Understand the result before release.</h1>
          <p className="view-lede">
            The configured Chainlink confidential workflow evaluates the registered build
            declaration and supplied route against the private policy, then returns only a public
            result. Artifact bytes and external provenance are not inspected by this workflow.
          </p>
        </div>
        <Link className="button-secondary" href="/app/builds">
          Manage builds
        </Link>
      </div>
      <section className="real-evaluation-card">
        <div className="real-evaluation-account">
          <div>
            <span className="view-eyebrow">Authenticated P13 evaluation</span>
            <strong>{data.account.email}</strong>
          </div>
          <p>
            Your current account session supplies identity. Credentials are never entered into this
            form or sent to the browser evaluation request.
          </p>
        </div>
        <div className="real-evaluation-selector-grid">
          <label>
            Site
            <select
              aria-label="Evaluation site"
              value={selectedSiteId}
              onChange={(event) => selectSite(event.target.value)}
            >
              {data.sites.length === 0 ? <option value="">No sites available</option> : null}
              {data.sites.map((site) => (
                <option value={site.id} key={site.id}>
                  {site.name} · {site.location}
                </option>
              ))}
            </select>
          </label>
          <label>
            Robot
            <select
              aria-label="Evaluation robot"
              value={selectedRobotId}
              onChange={(event) => selectRobot(event.target.value)}
              disabled={robotsForSite.length === 0}
            >
              {robotsForSite.length === 0 ? (
                <option value="">No robots for this site</option>
              ) : null}
              {robotsForSite.map((robot) => (
                <option value={robot.id} key={robot.id}>
                  {robot.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Exact build
            <select
              aria-label="Evaluation build"
              value={selectedBuildId}
              onChange={(event) => selectBuild(event.target.value)}
              disabled={buildsForRobot.length === 0}
            >
              {buildsForRobot.length === 0 ? (
                <option value="">No builds for this robot</option>
              ) : null}
              {buildsForRobot.map((build) => (
                <option value={build.id} key={build.id}>
                  {build.version} · {build.label} · {build.buildStatus}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="real-evaluation-toolbar">
          <p className="field-help">
            The server checks ownership, exact bindings, and build readiness before invoking the
            configured CRE path.
            {selected !== undefined && selected.buildStatus !== "BUILD_SUCCEEDED"
              ? " This build is not ready for evaluation yet."
              : ""}
          </p>
          <button
            type="button"
            className="view-primary-action"
            data-testid="run-p13-evaluation"
            onClick={() => void evaluate()}
            disabled={busy || selected === undefined || selected.buildStatus !== "BUILD_SUCCEEDED"}
          >
            {busy ? "Evaluating…" : "Run evaluation"} <span aria-hidden="true">→</span>
          </button>
        </div>
        {error ? <ErrorNotice message={error} /> : null}
        {latest ? (
          <div
            className={`real-result-card ${latest.verdict.toLowerCase()}`}
            data-testid="real-evaluation-result"
          >
            <div className="real-result-heading">
              <div>
                <span className="view-eyebrow">Public evaluator result</span>
                <h2>
                  <StatusPill status={latest.verdict} />
                </h2>
              </div>
              <span className="real-result-date">
                {new Date(Number(latest.evaluatedAt) * 1000).toLocaleString()}
              </span>
            </div>
            <p className="real-result-summary">
              {latest.verdict === "CLEAR"
                ? latest.violationCount === null
                  ? "CRE returned CLEAR for this exact build and binding. Detailed private evaluation findings are not released to the application."
                  : "This registered build declaration produced no public violations for the stored policy."
                : latest.violationCount === null
                  ? "CRE returned HOLD for this exact build and binding. The private evaluation report remains inside the confidential boundary."
                  : "This registered build declaration must not move to release preparation until the reported violations are addressed."}
            </p>
            <div className="real-result-facts">
              <div>
                <span>Build binding</span>
                <code>{latest.robotBuildId}</code>
                <code>{latest.robotBuildDigest}</code>
              </div>
              <div>
                <span>Scenarios</span>
                <strong>{latest.scenarioCount ?? "Not returned"}</strong>
              </div>
              <div>
                <span>Violations</span>
                <strong>{latest.violationCount ?? "Not returned"}</strong>
              </div>
            </div>
            {latest.reasons.length > 0 ? (
              <ul className="real-reason-list">
                {latest.reasons.map((reason) => (
                  <li key={reason}>{reason.replaceAll("-", " ")}</li>
                ))}
              </ul>
            ) : null}
            <div className="real-result-footer">
              <span>Evaluator {latest.evaluatorVersion}</span>
              <span>
                Envelope commitment <code>{latest.safetyEnvelopeCommitment}</code>
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No result for this build"
            body="Run the configured confidential evaluation to request a public result. Private policy values will not be returned."
            action={
              <button
                type="button"
                className="view-primary-action"
                onClick={() => void evaluate()}
                disabled={busy}
              >
                {busy ? "Evaluating…" : "Run evaluation"}
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}

function ReleasesView({
  data,
  refresh,
}: {
  readonly data: WorkspaceData;
  readonly refresh: () => Promise<void>;
}) {
  const clearEvaluation = data.evaluations.find((evaluation) => evaluation.verdict === "CLEAR");
  const [signer, setSigner] = useState("");
  const [clearanceText, setClearanceText] = useState("");
  const [handoffReady, setHandoffReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function prepare() {
    if (clearEvaluation === undefined) return;
    setBusy(true);
    setError(null);
    try {
      let clearance: unknown = null;
      if (clearanceText.trim() !== "") {
        try {
          clearance = JSON.parse(clearanceText);
        } catch {
          throw new Error("Public P4 clearance must be valid JSON");
        }
      }
      const response = await apiFetch<{
        readonly status?: string;
        readonly prepared?: unknown;
      }>("/releases/prepare", {
        method: "POST",
        body: jsonBody({
          evaluationId: clearEvaluation.evaluationId,
          signerAddress: signer,
          clearance,
        }),
      });
      if (response.status === "LEDGER_APPROVAL_REQUIRED" && response.prepared !== undefined) {
        window.sessionStorage.setItem(
          "rovaulta.p5.prepared",
          JSON.stringify({
            version: 1,
            scope: "account",
            accountId: data.account.id,
            prepared: response.prepared,
          }),
        );
        setHandoffReady(true);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Release preparation failed");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="product-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Releases</p>
          <h1>Prepare the exact handoff.</h1>
          <p className="view-lede">
            A clear local evaluation is not an onchain clearance. Rovaulta will stop until the
            public record and configured release gate are available.
          </p>
        </div>
      </div>
      {clearEvaluation === undefined ? (
        <EmptyState
          title="A CLEAR evaluation is required"
          body="Run and review a clear result before release preparation becomes available."
          action={
            <Link className="view-primary-action" href="/app/evaluate">
              Open evaluation <span aria-hidden="true">→</span>
            </Link>
          }
        />
      ) : (
        <section className="real-release-card">
          <div className="real-release-target">
            <span className="view-eyebrow">Eligible evaluation</span>
            <h2>{clearEvaluation.robotBuildId}</h2>
            <p>
              {clearEvaluation.evaluationId} · exact digest{" "}
              <code>{clearEvaluation.robotBuildDigest}</code>
            </p>
            <StatusPill status="CLEAR" />
          </div>
          <div className="real-release-form">
            <label>
              Authorized signer address
              <input
                value={signer}
                onChange={(event) => setSigner(event.target.value)}
                placeholder="0x…"
              />
            </label>
            <fieldset className="real-release-clearance">
              <legend>Public P4 clearance record</legend>
              <p className="field-help">
                Paste the public clearance issued for this exact evaluation. Rovaulta cannot create
                one here, and private policy contents do not belong in this field.
              </p>
              <textarea
                rows={8}
                value={clearanceText}
                onChange={(event) => {
                  setClearanceText(event.target.value);
                  setHandoffReady(false);
                }}
                placeholder='{"schemaVersion":"rovaulta.clearance-record/v1",…}'
                spellCheck={false}
                aria-label="Public P4 clearance record"
              />
            </fieldset>
            <button
              type="button"
              className="view-primary-action"
              onClick={() => void prepare()}
              disabled={busy || !/^0x[a-fA-F0-9]{40}$/.test(signer)}
            >
              {busy ? "Checking release gate…" : "Prepare release"}{" "}
              <span aria-hidden="true">→</span>
            </button>
            <p className="field-help">
              The browser cannot create a clearance, sign, or approve. This action calls the
              existing P5 boundary and will return a truthful blocked state when the public
              clearance or release gate is unavailable.
            </p>
            {handoffReady ? (
              <Link className="view-primary-action" href="/p5-ledger">
                Continue to human Ledger approval <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
          {error ? <ErrorNotice message={error} /> : null}
        </section>
      )}
      {data.releases.length > 0 ? (
        <section className="real-history">
          <div className="product-section-heading">
            <div>
              <p className="view-eyebrow">Release history</p>
              <h2>Account-owned attempts</h2>
            </div>
          </div>
          {data.releases.map((release) => (
            <article className="real-history-row" key={release.id}>
              <div>
                <strong>{release.evaluationId}</strong>
                <span>{release.message}</span>
              </div>
              <StatusPill status={release.status} />
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function EvidenceView({ data }: { readonly data: WorkspaceData }) {
  return (
    <div className="product-view">
      <div className="view-heading-row">
        <div>
          <p className="view-eyebrow">Evidence and boundaries</p>
          <h1>Technical proof supports the decision.</h1>
          <p className="view-lede">
            The normal product shows what an operator needs to trust the next step. Deeper partner
            evidence remains documented outside the private policy boundary.
          </p>
        </div>
      </div>
      <section className="real-evidence-grid">
        <article className="real-record-card">
          <span className="view-eyebrow">Data ownership</span>
          <h2>{data.account.email}</h2>
          <p>
            Sites, robots, builds, evaluations, and release attempts are loaded from this
            account&apos;s authenticated session. Another account cannot address their identifiers.
          </p>
        </article>
        <article className="real-record-card">
          <span className="view-eyebrow">Confidential evaluation</span>
          <h2>Commitment, not contents</h2>
          <p>
            The browser receives a safety-envelope commitment and public verdict only. The encrypted
            policy and blinding secret are opened inside the configured confidential evaluation
            boundary; they never enter the browser projection.
          </p>
        </article>
        <article className="real-record-card">
          <span className="view-eyebrow">Human authority</span>
          <h2>Preparation is not approval</h2>
          <p>
            Release preparation can stop at <code>LEDGER_APPROVAL_REQUIRED</code>; only the existing
            P5 consume path can produce authorization, and no AI or browser state can replace the
            signer.
          </p>
        </article>
        <article className="real-record-card">
          <span className="view-eyebrow">Fixture boundary</span>
          <h2>P7 fixtures are not account data</h2>
          <p>
            The deterministic unsafe/corrected/mutated fixture remains available only at the
            explicit development route used by regression tests. It is not used by this workspace.
          </p>
          <Link className="path-action" href="/app/evidence">
            Keep reading <span aria-hidden="true">→</span>
          </Link>
        </article>
      </section>
    </div>
  );
}

export function RealProductApp({ initialView }: { readonly initialView: ProductView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const me = await apiFetch<{ account: Account }>("/auth/me");
    const sites = (await apiFetch<{ sites: readonly Site[] }>("/sites")).sites;
    const siteResources = await Promise.all(
      sites.map(async (site) => {
        const [robots, builds] = await Promise.all([
          apiFetch<{ robots: readonly Robot[] }>(`/sites/${site.id}/robots`),
          apiFetch<{ builds: readonly Build[] }>(`/sites/${site.id}/builds`),
        ]);
        return { robots: robots.robots, builds: builds.builds };
      }),
    );
    const [evaluations, releases] = await Promise.all([
      apiFetch<{ evaluations: readonly Evaluation[] }>("/evaluations"),
      apiFetch<{ releases: readonly ReleaseAttempt[] }>("/releases"),
    ]);
    setData({
      account: me.account,
      sites,
      robots: siteResources.flatMap((resource) => resource.robots),
      builds: siteResources.flatMap((resource) => resource.builds),
      evaluations: evaluations.evaluations,
      releases: releases.releases,
    });
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void refresh()
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          router.replace(`/start?next=${encodeURIComponent(pathname)}`);
          return;
        }
        setError(reason instanceof ApiError ? reason.message : "The workspace could not be loaded");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pathname, refresh, router]);
  async function signOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      await apiFetch("/auth/sign-out", { method: "POST" });
      window.sessionStorage.removeItem("rovaulta.p5.prepared");
      router.replace("/start");
    } catch (reason) {
      setSignOutError(
        reason instanceof ApiError ? reason.message : "The session could not be signed out.",
      );
      setSignOutBusy(false);
    }
  }
  if (loading)
    return (
      <main className="product-loading" id="main-content">
        <div className="real-loading-card">
          <Image
            className="workspace-loading-wordmark"
            src="/brand/rovaulta-wordmark.png"
            alt="Rovaulta"
            width={150}
            height={30}
          />
          <span className="loading-spinner" aria-hidden="true" />
          <h1>Loading your workspace</h1>
          <p>Checking the account session and private target records.</p>
        </div>
      </main>
    );
  if (error !== null || data === null)
    return (
      <main className="product-loading" id="main-content">
        <div className="real-loading-card">
          <Image
            className="workspace-loading-wordmark"
            src="/brand/rovaulta-wordmark.png"
            alt="Rovaulta"
            width={150}
            height={30}
          />
          <h1>Workspace unavailable</h1>
          <p>{error ?? "Sign in is required."}</p>
          <Link className="view-primary-action" href="/start">
            Return to account entry
          </Link>
        </div>
      </main>
    );
  return (
    <main className="product-shell" id="main-content" data-product-view={initialView}>
      <ProductSidebar
        view={initialView}
        data={data}
        onSignOut={() => void signOut()}
        signOutBusy={signOutBusy}
        signOutError={signOutError}
      />
      <div className="product-main">
        <ProductHeader view={initialView} data={data} />
        <div className="product-content">
          {initialView === "overview" ? (
            <OverviewView data={data} />
          ) : initialView === "setup" ? (
            <SetupView data={data} refresh={refresh} />
          ) : initialView === "builds" ? (
            <BuildsView data={data} refresh={refresh} />
          ) : initialView === "evaluate" ? (
            <EvaluateView data={data} refresh={refresh} />
          ) : initialView === "releases" ? (
            <ReleasesView data={data} refresh={refresh} />
          ) : (
            <EvidenceView data={data} />
          )}
        </div>
      </div>
    </main>
  );
}
