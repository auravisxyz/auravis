import { useEffect, useState } from "react";
import type { IntentDraft, PageCapture } from "@auravis/shared";
import { PatternIntentExtractor } from "@auravis/shared";
import { capturePage } from "../../lib/capture.js";

/** Below this, we ask rather than assume. It's the user's money. */
const CONFIDENCE_FLOOR = 0.6;

type Stage = "capturing" | "ready" | "extracting" | "review" | "error";

const extractor = new PatternIntentExtractor();

export default function App() {
  const [stage, setStage] = useState<Stage>("capturing");
  const [capture, setCapture] = useState<PageCapture | null>(null);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void runCapture();
  }, []);

  async function runCapture() {
    setStage("capturing");
    setError(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePage as unknown as () => PageCapture,
      });

      const result = results[0]?.result as PageCapture | undefined;
      if (!result) throw new Error("Could not read this page.");

      setCapture(result);
      setStage("ready");
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Some pages (browser settings, extension stores) can't be read.`
          : "Could not read this page.",
      );
      setStage("error");
    }
  }

  async function runExtract() {
    if (!capture || !instruction.trim()) return;
    setStage("extracting");
    try {
      const result = await extractor.extract(capture, instruction.trim());
      setDraft(result);
      setStage("review");
    } catch {
      setError("Could not understand that instruction. Try rephrasing it.");
      setStage("error");
    }
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <Header />

      {stage === "capturing" && <Capturing />}
      {stage === "error" && <ErrorState message={error} onRetry={runCapture} />}

      {(stage === "ready" || stage === "extracting") && capture && (
        <>
          <CaptureCard capture={capture} />
          <InstructionField
            value={instruction}
            onChange={setInstruction}
            onSubmit={runExtract}
            busy={stage === "extracting"}
          />
        </>
      )}

      {stage === "review" && draft && capture && (
        <ReviewCard
          draft={draft}
          capture={capture}
          onBack={() => setStage("ready")}
        />
      )}
    </main>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between">
      <h1 className="text-base font-semibold tracking-tight text-ink">Auravis</h1>
      <span className="text-xs text-ink-faint">Testnet</span>
    </header>
  );
}

function Capturing() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      <p className="text-sm text-ink-muted">Reading this page…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-danger">{message ?? "Something went wrong."}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-control border border-line px-3 py-2 text-sm text-ink hover:bg-surface-raised"
      >
        Try again
      </button>
    </div>
  );
}

function CaptureCard({ capture }: { capture: PageCapture }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p className="line-clamp-2 text-sm font-medium text-ink">
        {capture.title || "Untitled page"}
      </p>
      <p className="truncate text-xs text-ink-faint">{capture.url}</p>

      {capture.priceCandidates.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {capture.priceCandidates.slice(0, 4).map((price) => (
            <span
              key={price}
              className="rounded-control bg-surface-raised px-2 py-1 text-xs text-ink-muted"
            >
              {price}
            </span>
          ))}
        </div>
      ) : (
        <p className="pt-1 text-xs text-ink-faint">
          No prices found on this page — you can still name one yourself.
        </p>
      )}
    </section>
  );
}

function InstructionField({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <label htmlFor="instruction" className="text-sm text-ink-muted">
        What should happen?
      </label>
      <textarea
        id="instruction"
        rows={3}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        placeholder="buy $200 worth if it drops 8%"
        className="resize-none rounded-control border border-line bg-surface p-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60"
      />
      <button
        type="button"
        disabled={busy || value.trim().length === 0}
        onClick={onSubmit}
        className="rounded-control bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Reading…" : "Continue"}
      </button>
    </section>
  );
}

function ReviewCard({
  draft,
  capture,
  onBack,
}: {
  draft: IntentDraft;
  capture: PageCapture;
  onBack: () => void;
}) {
  const unsure = draft.confidence < CONFIDENCE_FLOOR;
  const missingAmount = draft.amount === null;
  const missingTarget = draft.targetPrice === null && draft.targetPercent === null;
  const blocked = unsure || missingAmount || missingTarget;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-ink">{draft.summary}</p>
        <dl className="flex flex-col gap-1 pt-1 text-xs">
          <Row label="On" value={capture.title || capture.url} />
          <Row label="Mode" value={draft.mode === "auto" ? "Auto — buys without asking" : "Catch — you confirm"} />
          <Row
            label="Trigger"
            value={
              draft.targetPrice !== null
                ? `${draft.direction} $${draft.targetPrice}`
                : draft.targetPercent !== null
                  ? `${draft.direction === "below" ? "drops" : "rises"} ${draft.targetPercent}%`
                  : "not set"
            }
          />
        </dl>
      </div>

      {draft.assumptions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-xs font-medium text-warn">What I filled in for you</p>
          <ul className="flex flex-col gap-1">
            {draft.assumptions.map((a) => (
              <li key={a} className="text-xs text-ink-muted">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <p className="text-xs text-warn">
          {missingAmount && "I couldn't tell how much to spend. "}
          {missingTarget && "I couldn't tell when to act. "}
          {!missingAmount && !missingTarget && "I'm not confident I understood that. "}
          Add the missing detail and try again.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-control border border-line px-3 py-2 text-sm text-ink hover:bg-surface-raised"
        >
          Back
        </button>
        <button
          type="button"
          disabled={blocked}
          className="flex-1 rounded-control bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
        >
          Create mandate
        </button>
      </div>

      <p className="text-center text-xs text-ink-faint">
        The cap is enforced on-chain. The agent cannot spend past it.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="truncate text-right text-ink-muted">{value}</dd>
    </div>
  );
}
