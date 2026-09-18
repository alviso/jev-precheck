/** Code computes every comparison; the judge only reads plain statements. Jev is documented weak at arithmetic. */
import { resolve, type Derivation, type ToolContract, type Contract } from "./contract";

export interface PastCall { ts: number; tool: string; args: any; write: boolean; verdict?: string }

export interface Derived { statements: string[]; flags: string[] }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const empty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const money = (n: number, unit?: string) => (unit === "cents" ? `$${(n / 100).toFixed(2)}` : String(n));

export function derive(tool: string, tc: ToolContract | undefined, contract: Contract, args: any, ctx: any, history: PastCall[], now = Date.now()): Derived {
  const s: string[] = [], flags: string[] = [];
  const scope = { args, ctx };
  const say = (flag: string | null, text: string) => { s.push(text); if (flag) flags.push(flag); };

  // universal: a justification field that exists but is empty
  const rf = contract.reasonField;
  if (rf && rf in (args ?? {})) {
    if (empty(args[rf])) say("missing_justification", `${rf}: empty`);
    else say(null, `${rf} given: "${String(args[rf]).slice(0, 200)}"`);
  }
  // universal: identical call recently in this session
  const win = (contract.duplicateWindowMin ?? 30) * 60_000;
  const same = history.filter((h) => h.tool === tool && h.write && now - h.ts <= win && JSON.stringify(h.args) === JSON.stringify(args));
  if (same.length) say("duplicate", `identical call to ${tool} made ${Math.round((now - same[same.length - 1]!.ts) / 60_000)} min ago in this session`);

  for (const d of tc?.derive ?? []) {
    switch (d.type) {
      case "duplicate": {
        const w = (d.windowMin ?? contract.duplicateWindowMin ?? 30) * 60_000;
        const hit = history.filter((h) => h.tool === tool && h.write && now - h.ts <= w && d.keys.every((k) => JSON.stringify(h.args?.[k]) === JSON.stringify(args?.[k])));
        if (hit.length) say("duplicate", `a ${tool} with the same ${d.keys.join(", ")} was already made ${Math.round((now - hit[hit.length - 1]!.ts) / 60_000)} min ago`);
        else say(null, `no earlier ${tool} with the same ${d.keys.join(", ")} in this session`);
        break;
      }
      case "required": {
        const v = resolve(d.path, scope);
        if (empty(v)) say("missing", `${d.label}: missing`); else say(null, `${d.label}: present`);
        break;
      }
      case "state": {
        const v = resolve(d.path, scope);
        if (v === undefined) { say(null, `${d.label}: unknown (record not found)`); break; }
        if (d.conflicts.includes(String(v))) say("state_conflict", `${d.label} is "${v}", which conflicts with this action`);
        else say(null, `${d.label}: "${v}"`);
        break;
      }
      case "match": {
        const a = resolve(d.a, scope), b = resolve(d.b, scope);
        if (a === undefined || b === undefined) { say(null, `${d.label}: cannot verify (missing value)`); break; }
        if (String(a) !== String(b)) say("mismatch", `${d.label}: ${a} vs ${b}, they differ`); else say(null, `${d.label}: same (${a})`);
        break;
      }
      case "compare": {
        const v = num(resolve(d.value, scope)), b = num(resolve(d.against, scope));
        if (v === null || b === null) { say(null, `${d.label}: cannot compare (missing value)`); break; }
        if (b === 0) { say(v === 0 ? null : "disproportionate", `${d.label}: ${money(v, d.unit)} against a baseline of zero`); break; }
        const r = v / b;
        const txt = r >= 0.9 && r <= 1.1 ? `about equal (${money(v, d.unit)} vs ${money(b, d.unit)})` : r > 1 ? `about ${r >= 10 ? Math.round(r) : r.toFixed(1)}x the baseline (${money(v, d.unit)} vs ${money(b, d.unit)})` : `${Math.round(r * 100)}% of the baseline (${money(v, d.unit)} vs ${money(b, d.unit)})`;
        say(r > 3 || r < 0.2 ? "disproportionate" : null, `${d.label}: ${txt}`);
        break;
      }
      case "ceiling": {
        const v = num(resolve(d.value, scope)), m = num(resolve(d.max, scope));
        if (v === null || m === null) { say(null, `${d.label}: cannot verify (missing value)`); break; }
        if (v > m) say("exceeds", `${d.label}: ${v} exceeds the maximum of ${m} (${Math.round((v / m) * 100)}%)`);
        else say(null, `${d.label}: ${v} within the maximum of ${m}`);
        break;
      }
      case "prerequisite": {
        const hit = history.find((h) => h.tool === d.tool && Object.entries(d.match ?? {}).every(([k, ref]) => JSON.stringify(h.args?.[k]) === JSON.stringify(resolve(ref, scope))));
        if (hit) say(null, `${d.label}: done earlier in this session (${d.tool})`); else say("missing_prerequisite", `${d.label}: no ${d.tool} found in this session`);
        break;
      }
    }
  }
  return { statements: s, flags };
}
