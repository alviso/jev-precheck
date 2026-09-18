/** Drive the proxy (or any stdio MCP server) as a client: list tools, then run the calls given on argv as JSON. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [cmd, ...rest] = process.argv.slice(2);
const calls = rest.map((s) => JSON.parse(s)) as { name: string; arguments: any }[];
const [command, ...args] = cmd!.split(" ");
const c = new Client({ name: "drive", version: "0" });
await c.connect(new StdioClientTransport({ command: command!, args, stderr: "inherit" }));
const tools = await c.listTools();
console.log(`tools: ${tools.tools.length}: ${tools.tools.map((t) => t.name).join(", ")}`);
for (const call of calls) {
  const r: any = await c.callTool(call);
  console.log(`\n> ${call.name} ${JSON.stringify(call.arguments)}\n${r.isError ? "ERROR " : ""}${(r.content ?? []).map((x: any) => x.text).join("\n")}`);
}
await c.close();
