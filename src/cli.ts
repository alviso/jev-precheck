#!/usr/bin/env bun
import { runProxy } from "./proxy";
import { replay, scorecard, fit } from "./replay";
import { approve, heldList } from "./session";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
switch (cmd) {
  case "proxy": await runProxy(rest[0] ?? "precheck.json"); break;
  case "replay": {
    const { results, out, seconds } = await replay(rest[0]!, flag("contract") ?? "precheck.json", { concurrency: Number(flag("concurrency") ?? 5), limit: flag("limit") ? Number(flag("limit")) : undefined });
    console.log(scorecard(results)); console.log(`\n${seconds.toFixed(0)}s, rows in ${out}`); break;
  }
  case "score": { const rows = (await Bun.file(rest[0]!).text()).trim().split("\n").map((l) => JSON.parse(l)); console.log(scorecard(rows)); break; }
  case "fit": {
    const rows = (await Bun.file(rest[0]!).text()).trim().split("\n").map((l) => JSON.parse(l));
    const f = fit(rows, Number(flag("max-false-hold") ?? 0.02));
    console.log(`fitted on ${f.fit.n} cases (hash split): hold >= ${f.hold}, warn >= ${f.warn}`);
    console.log(`  fit half:  recall ${(f.fit.recall * 100).toFixed(1)}%  false holds ${(f.fit.falseHold * 100).toFixed(1)}%`);
    console.log(`  held-out:  recall ${(f.test.recall * 100).toFixed(1)}%  false holds ${(f.test.falseHold * 100).toFixed(1)}%  routine warned ${(f.test.warnRate * 100).toFixed(1)}%  (n=${f.test.n})`);
    break;
  }
  case "held": for (const h of heldList()) console.log(`${h.id}  ${h.ts}  ${h.tool} ${JSON.stringify(h.args).slice(0, 80)}\n          ${h.note}`); break;
  case "approve": approve(rest[0]!); console.log(`approved ${rest[0]}: the next identical call goes through`); break;
  default: console.log(`usage:
  precheck proxy <contract.json>                 run as an MCP server (stdio) in front of the real one
  precheck replay <cases.jsonl> --contract <c>   score the judge on labelled cases
  precheck score <replay.jsonl>                  re-print a scorecard
  precheck fit <replay.jsonl>                    pick thresholds on half the cases, report on the other half
  precheck held                                  list held calls
  precheck approve <id>                          let the next identical call through`);
}
