import { Suspense } from "react";
import P5LedgerOperatorPage from "./operator-page";

export const dynamic = "force-dynamic";

export default function P5LedgerPage() {
  const allowDemoHandoff =
    process.env.NODE_ENV !== "production" && process.env.ROVAULTA_ENABLE_DEMO_ROUTES === "true";
  return (
    <Suspense
      fallback={
        <main className="product-loading" id="main-content">
          <div className="real-loading-card">
            <span className="loading-spinner" aria-hidden="true" />
            <h1>Checking operator access</h1>
            <p>Preparing the authenticated Ledger boundary.</p>
          </div>
        </main>
      }
    >
      <P5LedgerOperatorPage allowDemoHandoff={allowDemoHandoff} />
    </Suspense>
  );
}
