import type { Contract } from "./contract";
import type { Verdict } from "./judge";
import type { Derived } from "./derive";

export type Decision = { action: "flow" } | { action: "warn"; note: string } | { action: "hold"; note: string };

export function decide(contract: Contract, v: Verdict, d: Derived): Decision {
  const t = contract.thresholds;
  const why = `${v.issue.replace(/_/g, " ")} (p=${v.pReview.toFixed(2)})` + (d.statements.length ? `. ${d.statements.filter((s) => !s.endsWith("present") && !s.includes("no earlier")).join("; ")}` : "");
  // A reason that argues for its own approval is surfaced, never a hold on its own: in the fixtures every
  // adversarial case already scores high on the main question, and honest judgments ("not worth collecting") trip it.
  const advocacy = v.pSelfAdvocating >= t.selfAdvocating;
  const note = (advocacy ? "the stated reason argues for its own approval; " : "") + why;
  if (contract.mode === "shadow") return { action: "flow" };
  if (v.pReview >= t.hold) return { action: "hold", note };
  if (v.pReview >= t.warn || advocacy) return { action: "warn", note };
  return { action: "flow" };
}
