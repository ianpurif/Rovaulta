import Image from "next/image";
import Link from "next/link";
import styles from "./landing-page.module.css";
import { PipelineStory } from "./pipeline-story";
import { ReleasePipelineScene } from "./release-pipeline-scene";

const pipelineStages = [
  {
    number: "01",
    kicker: "Exact build",
    title: "Lock the artifact.",
    body: "Bind the site, robot, and software build to one release request before evaluation starts.",
    meta: "IDENTITY / SHA-256",
  },
  {
    number: "02",
    kicker: "Private evaluation",
    title: "Evaluate behind the boundary.",
    body: "Run the declared behavior against the facility's confidential envelope without rendering private rules or geometry.",
    meta: "CRE / PRIVATE INPUT",
  },
  {
    number: "03",
    kicker: "Evidence",
    title: "Expose only the proof.",
    body: "Project the public result, exact bindings, and evidence needed to inspect what was actually checked.",
    meta: "PUBLIC PROJECTION",
  },
  {
    number: "04",
    kicker: "Human review",
    title: "Stop for the operator.",
    body: "Prepare the exact release intent, then make the human boundary explicit on Ledger hardware.",
    meta: "LEDGER / HUMAN GATE",
  },
  {
    number: "05",
    kicker: "Release control",
    title: "Release what was checked.",
    body: "Only the same exact build, site commitment, evaluator, and expiry can move forward.",
    meta: "EXACT MATCH / CONTROL",
  },
] as const;

const boundarySignals = [
  {
    label: "01",
    title: "Exact-build binding",
    body: "A changed artifact cannot inherit an earlier clearance.",
  },
  {
    label: "02",
    title: "Private evaluation",
    body: "Private site rules stay inside the evaluation boundary.",
  },
  {
    label: "03",
    title: "Human release gate",
    body: "Automation prepares; the operator approves the final intent.",
  },
] as const;

export function LandingPage() {
  return (
    <main className={styles.page} id="main-content">
      <div className={styles.gridField} aria-hidden="true" />
      <div className={styles.scanLine} aria-hidden="true" />

      <header className={styles.nav}>
        <Link className={styles.brand} href="/" aria-label="Rovaulta home">
          <span className={styles.brandIdentity}>
            <Image
              className={styles.wordmark}
              src="/brand/rovaulta-wordmark.png"
              alt=""
              width={174}
              height={35}
            />
            <span className={styles.brandDescriptor}>Release control for robots</span>
          </span>
        </Link>

        <nav className={styles.navLinks} aria-label="Primary navigation">
          <a href="#how-it-works">Workflow</a>
          <a href="#boundaries">Boundaries</a>
          <Link href="/app/evidence">Technical evidence</Link>
        </nav>

        <div className={styles.navActions}>
          <Link className={styles.signInLink} href="/sign-in">
            Sign in
          </Link>
          <Link className={`${styles.button} ${styles.navAction}`} href="/start">
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowMark} aria-hidden="true" />
            Robot software release control / 01
          </p>
          <h1 id="landing-title">
            Release the build
            <span className={styles.heroTitleAccent}> you actually evaluated.</span>
          </h1>
          <p className={styles.lede}>
            Rovaulta binds an exact robot build to a site's private evaluation envelope, then keeps
            a human in control of the release decision.
          </p>
          <div className={styles.actions}>
            <Link className={`${styles.button} ${styles.primaryAction}`} href="/start">
              Open the operator console <span aria-hidden="true">→</span>
            </Link>
            <a className={`${styles.button} ${styles.secondaryAction}`} href="#how-it-works">
              Trace the release path <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className={styles.heroNote}>
            <span className={styles.heroNoteMark} aria-hidden="true">
              ◇
            </span>
            <p>
              Simulation is evidence for a defined envelope—not a claim of physical robot safety.
            </p>
          </div>
        </div>

        <section className={styles.heroVisual} aria-labelledby="hero-visual-title">
          <div className={styles.visualHeader}>
            <div>
              <span className={styles.visualOverline}>CONTROL PLANE / 00</span>
              <strong id="hero-visual-title">Release request</strong>
            </div>
            <span className={styles.visualStatus}>
              <i aria-hidden="true" />
              PUBLIC PROJECTION
            </span>
          </div>
          <div className={styles.sceneWrap}>
            <ReleasePipelineScene activeStage={3} className={styles.heroScene} />
            <div className={styles.sceneLegend} aria-hidden="true">
              <span>EXACT BUILD</span>
              <span>PRIVATE EVALUATION</span>
              <span>EVIDENCE</span>
              <span>HUMAN REVIEW</span>
              <span>RELEASE</span>
            </div>
          </div>
          <div className={styles.heroReadout}>
            <div>
              <span className={styles.fieldLabel}>Current boundary</span>
              <strong>Human approval required</strong>
            </div>
            <span className={styles.holdTag}>HOLD / REVIEW</span>
          </div>
          <dl className={styles.visualFacts}>
            <div>
              <dt>Build</dt>
              <dd>candidate-17</dd>
            </div>
            <div>
              <dt>Evaluator</dt>
              <dd>warehouse-rules-v1</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>operator</dd>
            </div>
          </dl>
        </section>
      </section>

      <section className={styles.signalStrip} aria-label="Rovaulta product boundaries">
        {boundarySignals.map((signal) => (
          <div className={styles.signal} key={signal.label}>
            <span className={styles.signalNumber}>{signal.label}</span>
            <div>
              <strong>{signal.title}</strong>
              <p>{signal.body}</p>
            </div>
          </div>
        ))}
      </section>

      <PipelineStory stages={pipelineStages} />

      <section className={styles.proofSection} id="evidence" aria-labelledby="proof-title">
        <div className={styles.sectionMarker}>
          <span>PUBLIC SURFACE / 02</span>
          <span>READABLE · BOUNDED · EXACT</span>
        </div>
        <div className={styles.proofHeading}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowMark} aria-hidden="true" />
            Evidence without exposure
          </p>
          <h2 id="proof-title">The useful surface is the one that knows its limits.</h2>
          <p>
            Rovaulta makes the release path inspectable without turning private policy into a
            browser payload. Every public signal keeps its boundary attached.
          </p>
        </div>

        <div className={styles.proofBoard}>
          <div className={styles.proofBoardHeader}>
            <span>PUBLIC RELEASE PROJECTION</span>
            <span className={styles.proofBoardStatus}>
              <i aria-hidden="true" />
              READ-ONLY
            </span>
          </div>
          <div className={styles.proofRows}>
            <div className={styles.proofRow}>
              <span>Exact build</span>
              <code>sha256:7f2a…19c4</code>
              <strong className={styles.rowVerified}>BOUND</strong>
            </div>
            <div className={styles.proofRow}>
              <span>Site commitment</span>
              <code>commitment:••••</code>
              <strong className={styles.rowVerified}>MATCHED</strong>
            </div>
            <div className={styles.proofRow}>
              <span>Evaluation result</span>
              <code>warehouse-rules-v1</code>
              <strong className={styles.rowAttention}>HOLD</strong>
            </div>
            <div className={styles.proofRow}>
              <span>Release authority</span>
              <code>human / ledger</code>
              <strong className={styles.rowAttention}>REQUIRED</strong>
            </div>
          </div>
          <p className={styles.proofBoardNote}>
            The public projection is intentionally smaller than the private evaluation. It can show
            what is bound and what happens next; it cannot disclose the facility's rules.
          </p>
        </div>
      </section>

      <section className={styles.boundarySection} id="boundaries" aria-labelledby="boundary-title">
        <div className={styles.boundaryHeading}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowMark} aria-hidden="true" />
            Designed to fail closed / 03
          </p>
          <h2 id="boundary-title">Useful automation. Clear limits.</h2>
        </div>
        <div className={styles.boundaryCopy}>
          <p>
            Rovaulta can explain a public result and prepare an exact release request. It cannot see
            a facility's private rules, turn a hold into a clear, or sign on behalf of an operator.
          </p>
          <Link className={styles.textLink} href="/app/evidence">
            Read the evidence boundaries <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="cta-title">
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowMark} aria-hidden="true" />
            The operator remains in the loop
          </p>
          <h2 id="cta-title">Move from declared build to controlled release.</h2>
        </div>
        <div className={styles.finalCtaAction}>
          <p>Start with a target. Keep the proof attached to the build.</p>
          <Link className={`${styles.button} ${styles.primaryAction}`} href="/start">
            Start a workspace <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Image
            className={styles.footerMark}
            src="/brand/rovaulta-mark.png"
            alt=""
            width={24}
            height={28}
          />
          <span className={styles.brandText}>
            <strong>Rovaulta</strong>
            <small>Confidential deployment gate</small>
          </span>
        </div>
        <span className={styles.footerTagline}>
          Exact build · private evaluation · human approval
        </span>
        <Link href="/start">Start a workspace →</Link>
      </footer>
    </main>
  );
}
