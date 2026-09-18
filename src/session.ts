import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PastCall } from "./derive";

mkdirSync("data", { recursive: true });
const LOG = process.env.PRECHECK_LOG ?? `data/calls.jsonl`;
const HELD = "data/held.jsonl";
const APPROVED = "data/approved.json";

export const history: PastCall[] = [];

export function remember(c: PastCall) { history.push(c); if (history.length > 500) history.shift(); }
export function log(entry: Record<string, unknown>) { appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"); }
export function hold(entry: Record<string, unknown>) { appendFileSync(HELD, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"); }

export function holdId(tool: string, args: unknown) { return Bun.hash(tool + JSON.stringify(args)).toString(36).slice(0, 8); }
function approved(): Set<string> { try { return new Set(JSON.parse(readFileSync(APPROVED, "utf8"))); } catch { return new Set(); } }
export function isApproved(id: string) { return approved().has(id); }
export function consumeApproval(id: string) { const s = approved(); s.delete(id); writeFileSync(APPROVED, JSON.stringify([...s])); }
export function approve(id: string) { const s = approved(); s.add(id); writeFileSync(APPROVED, JSON.stringify([...s])); }
export function heldList(): any[] { if (!existsSync(HELD)) return []; return readFileSync(HELD, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
