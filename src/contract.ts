/** A precheck contract: what the proxy fetches and derives before a write reaches the server. */
export interface Contract {
  /** Downstream MCP server. */
  server: { command: string; args?: string[]; env?: Record<string, string> } | { url: string; headers?: Record<string, string> };
  /** shadow: log verdicts, forward everything. annotate: forward, attach a warning above `warn`. enforce: hold at or above `hold`. */
  mode: "shadow" | "annotate" | "enforce";
  thresholds: { warn: number; hold: number; selfAdvocating: number };
  /** Name of the free-text justification argument, if the server has one (e.g. `_reason`). */
  reasonField?: string;
  /** Minutes within which an identical call counts as a duplicate when a tool has no explicit rule. */
  duplicateWindowMin?: number;
  /** One line about the business, shown to the judge (e.g. "small specialty coffee wholesaler"). */
  domain?: string;
  tools: Record<string, ToolContract>;
}

export interface ToolContract {
  /** Only writes are judged. Reads pass through and are remembered as context for later writes. */
  write: boolean;
  /** Read calls to make first; results land in `ctx.<as>`. Arg values may reference `$args.path`. */
  context?: { as: string; tool: string; args: Record<string, unknown> }[];
  derive?: Derivation[];
}

export type Derivation =
  /** Same tool with the same values for `keys` seen within `windowMin` minutes in this session. */
  | { type: "duplicate"; keys: string[]; windowMin?: number }
  /** A value that must be present and non-empty. */
  | { type: "required"; path: string; label: string }
  /** A state field that must not be one of `conflicts`. */
  | { type: "state"; path: string; label: string; conflicts: string[] }
  /** Two values that should be equal (e.g. payer vs the invoice's customer). */
  | { type: "match"; a: string; b: string; label: string }
  /** A number relative to a baseline: stated as "about Nx", "N% of", "equal", "exceeds by". */
  | { type: "compare"; value: string; against: string; label: string; unit?: string }
  /** A prior call in this session that should exist (e.g. a return recorded before a refund). */
  | { type: "prerequisite"; tool: string; match?: Record<string, string>; label: string }
  /** A number that should not exceed another (e.g. credit vs invoice total). */
  | { type: "ceiling"; value: string; max: string; label: string };

/** `$args.a.b`, `$ctx.name.a.b`, or a literal. */
export function resolve(ref: unknown, scope: { args: any; ctx: any }): unknown {
  if (typeof ref !== "string" || !ref.startsWith("$")) return ref;
  const [root, ...path] = ref.slice(1).split(".");
  let v: any = root === "args" ? scope.args : root === "ctx" ? scope.ctx : undefined;
  for (const p of path) { if (v == null) return undefined; v = v[p]; }
  return v;
}

export async function loadContract(path: string): Promise<Contract> {
  const c = (await Bun.file(path).json()) as Contract;
  c.thresholds ??= { warn: 0.35, hold: 0.7, selfAdvocating: 0.6 };
  c.mode ??= "shadow";
  c.duplicateWindowMin ??= 30;
  return c;
}
