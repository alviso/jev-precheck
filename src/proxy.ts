/**
 * MCP precheck proxy. Speaks MCP to the agent over stdio, forwards to the real server (stdio or HTTP).
 * Reads pass through and are remembered. Before a write: fetch the records it touches, derive comparisons
 * in code, ask Jev whether a person should see it, then flow / warn / hold per the contract.
 * Everything diagnostic goes to stderr; stdout is the MCP channel.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadContract, resolve, type Contract } from "./contract";
import { derive } from "./derive";
import { judge } from "./judge";
import { decide } from "./policy";
import { history, remember, log, hold, holdId, isApproved, consumeApproval } from "./session";

const err = (...a: unknown[]) => console.error("[precheck]", ...a);

export async function connectDownstream(contract: Contract) {
  const client = new Client({ name: "jev-precheck", version: "0.1.0" });
  const s = contract.server as any;
  const transport = "url" in s
    ? new StreamableHTTPClientTransport(new URL(s.url), s.headers ? { requestInit: { headers: s.headers } } : undefined)
    : new StdioClientTransport({ command: s.command, args: s.args ?? [], env: { ...process.env as Record<string, string>, ...(s.env ?? {}) }, stderr: "inherit" });
  await client.connect(transport);
  return client;
}

/** Text content of a tool result, parsed as JSON when it is JSON. */
export function parseResult(r: any): unknown {
  const t = (r?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  if (r?.structuredContent) return r.structuredContent;
  try { return JSON.parse(t); } catch { return t; }
}

export async function runProxy(contractPath: string) {
  const contract = await loadContract(contractPath);
  const client = await connectDownstream(contract);
  const tools = (await client.listTools()).tools;
  const byName = new Map(tools.map((t) => [t.name, t]));
  err(`connected: ${tools.length} tools, mode=${contract.mode}, contract=${contractPath}`);

  const server = new Server({ name: "jev-precheck", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: client.getInstructions() });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const tc = contract.tools[name];
    const meta = byName.get(name);
    const isWrite = tc ? tc.write : !(meta?.annotations?.readOnlyHint === true) && !/^(get|list|search|find|read|show|describe|schema|status|due|pipeline|today|calendar|coverage|stats)/i.test(name.replace(/^[a-z0-9]+_/, ""));
    const t0 = performance.now();

    if (!isWrite) {
      const r = await client.callTool({ name, arguments: args });
      remember({ ts: Date.now(), tool: name, args, write: false });
      log({ tool: name, write: false, ms: Math.round(performance.now() - t0) });
      return r;
    }

    const id = holdId(name, args);
    if (isApproved(id)) {
      consumeApproval(id);
      const r = await client.callTool({ name, arguments: args });
      remember({ ts: Date.now(), tool: name, args, write: true, verdict: "approved" });
      log({ tool: name, write: true, verdict: "approved", id });
      return r;
    }

    // 1. context
    const ctx: Record<string, unknown> = {};
    for (const c of tc?.context ?? []) {
      const cargs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.args)) cargs[k] = resolve(v, { args, ctx });
      if (Object.values(cargs).some((v) => v === undefined)) { ctx[c.as] = { error: "argument missing, not fetched" }; continue; }
      try { ctx[c.as] = parseResult(await client.callTool({ name: c.tool, arguments: cargs })); }
      catch (e) { ctx[c.as] = { error: (e as Error).message.slice(0, 200) }; }
    }
    // 2. derive
    const d = derive(name, tc, contract, args, ctx, history);
    // 3. judge
    let verdict, decision;
    try {
      verdict = await judge({ tool: name, description: meta?.description, args, context: ctx, derived: d.statements, recentCalls: history, domain: contract.domain });
      decision = decide(contract, verdict, d);
    } catch (e) {
      err(`judge failed, forwarding: ${(e as Error).message.slice(0, 120)}`);
      verdict = null; decision = { action: "flow" as const };
    }
    const ms = Math.round(performance.now() - t0);
    log({ tool: name, write: true, args, derived: d.statements, flags: d.flags, verdict, decision, ms, id });
    err(`${name} -> ${decision.action}${verdict ? ` p=${verdict.pReview.toFixed(2)} ${verdict.issue}` : ""} (${ms} ms)`);

    if (decision.action === "hold") {
      hold({ id, tool: name, args, derived: d.statements, verdict, note: decision.note });
      remember({ ts: Date.now(), tool: name, args, write: true, verdict: "held" });
      return { isError: true, content: [{ type: "text", text: `Held for human review by precheck (id ${id}): ${decision.note}. The call was not executed. A person can approve it with \`precheck approve ${id}\`, after which the same call will go through. Do not retry with a different reason; state the business fact or ask the person.` }] };
    }
    const r: any = await client.callTool({ name, arguments: args });
    remember({ ts: Date.now(), tool: name, args, write: true, verdict: decision.action });
    if (decision.action === "warn") r.content = [...(r.content ?? []), { type: "text", text: `[precheck warning: ${decision.note}]` }];
    return r;
  });

  await server.connect(new StdioServerTransport());
  err("ready");
}
