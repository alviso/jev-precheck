/** A tiny in-memory ERP as an MCP server, for end-to-end tests of the precheck proxy. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const customers: Record<string, any> = {
  "c-harbor": { id: "c-harbor", name: "Harbor Coffee Roasters", on_hold: false, terms: "net 30", credit_limit_cents: 1500000, open_balance_cents: 420000, typical_invoice_cents: 118000, oldest_open_days: 18, requires_po: false },
  "c-pine": { id: "c-pine", name: "Pine Street Bakery", on_hold: true, terms: "net 15", credit_limit_cents: 500000, open_balance_cents: 610000, typical_invoice_cents: 90000, oldest_open_days: 68, requires_po: false },
};
const invoices: Record<string, any> = {
  "inv-2041": { id: "inv-2041", customer_id: "c-harbor", total_cents: 118000, balance_due_cents: 118000, status: "open", period_open: true },
  "inv-2019": { id: "inv-2019", customer_id: "c-harbor", total_cents: 118000, balance_due_cents: 0, status: "paid", period_open: true },
  "inv-2050": { id: "inv-2050", customer_id: "c-pine", total_cents: 220000, balance_due_cents: 220000, status: "open", period_open: true },
};
const payments: Record<string, any> = { "pay-9": { id: "pay-9", customer_id: "c-harbor", amount_cents: 118000, unapplied_cents: 118000, method: "ach" } };
const orders: Record<string, any> = { "so-501": { id: "so-501", customer_id: "c-harbor", status: "confirmed", total_cents: 95000 }, "so-502": { id: "so-502", customer_id: "c-harbor", status: "draft", total_cents: 95000 } };
const items: Record<string, any> = { "guji": { id: "guji", name: "Ethiopia Guji", unit_price_cents: 2950, cost_cents: 1810, on_hand: 120, typical_receipt_qty: 300, open_po_qty: 300 } };

const s = new McpServer({ name: "mock-erp", version: "0.1.0" });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const find = (m: Record<string, any>, id: string, what: string) => { if (!m[id]) throw new Error(`${what} ${id} not found`); return m[id]; };
let seq = 100;

s.registerTool("get_customer", { description: "One customer with credit position.", inputSchema: { customer_id: z.string() }, annotations: { readOnlyHint: true } }, async ({ customer_id }) => text(find(customers, customer_id, "customer")));
s.registerTool("get_invoice", { description: "Invoice with balance.", inputSchema: { invoice_id: z.string() }, annotations: { readOnlyHint: true } }, async ({ invoice_id }) => text(find(invoices, invoice_id, "invoice")));
s.registerTool("get_payment", { description: "Payment with unapplied balance.", inputSchema: { payment_id: z.string() }, annotations: { readOnlyHint: true } }, async ({ payment_id }) => text(find(payments, payment_id, "payment")));
s.registerTool("get_order", { description: "Order with status.", inputSchema: { order_id: z.string() }, annotations: { readOnlyHint: true } }, async ({ order_id }) => text(find(orders, order_id, "order")));
s.registerTool("get_item", { description: "Item with price, cost, stock.", inputSchema: { item_id: z.string() }, annotations: { readOnlyHint: true } }, async ({ item_id }) => text(find(items, item_id, "item")));
s.registerTool("issue_invoice", { description: "Issue an invoice to a customer. Cents.", inputSchema: { customer_id: z.string(), amount_cents: z.number().int(), lines: z.string(), _reason: z.string().optional() } }, async (a) => { find(customers, a.customer_id, "customer"); const id = `inv-${++seq}`; invoices[id] = { id, customer_id: a.customer_id, total_cents: a.amount_cents, balance_due_cents: a.amount_cents, status: "open", period_open: true }; return text({ ok: true, invoice_id: id }); });
s.registerTool("apply_payment", { description: "Apply a payment to an invoice. Cents.", inputSchema: { payment_id: z.string(), invoice_id: z.string(), amount_cents: z.number().int(), _reason: z.string().optional() } }, async (a) => { const p = find(payments, a.payment_id, "payment"), i = find(invoices, a.invoice_id, "invoice"); const amt = Math.min(a.amount_cents, p.unapplied_cents, i.balance_due_cents); p.unapplied_cents -= amt; i.balance_due_cents -= amt; if (i.balance_due_cents === 0) i.status = "paid"; return text({ ok: true, applied_cents: amt }); });
s.registerTool("create_credit_note", { description: "Raise a credit note against a customer, optionally an invoice. Cents.", inputSchema: { customer_id: z.string(), invoice_id: z.string().optional(), amount_cents: z.number().int(), reason: z.string() } }, async (a) => text({ ok: true, credit_note_id: `cn-${++seq}` }));
s.registerTool("refund", { description: "Record money returned to the customer from a payment or credit note.", inputSchema: { source_type: z.enum(["payment", "credit_note"]), source_id: z.string(), amount_cents: z.number().int(), _reason: z.string().optional() } }, async (a) => text({ ok: true, refund_id: `rf-${++seq}` }));
s.registerTool("write_off", { description: "Write off the open balance of an invoice.", inputSchema: { invoice_id: z.string(), reason: z.string() } }, async (a) => { const i = find(invoices, a.invoice_id, "invoice"); i.balance_due_cents = 0; i.status = "paid"; return text({ ok: true }); });
s.registerTool("hold_customer", { description: "Put a customer on credit hold.", inputSchema: { customer_id: z.string(), reason: z.string() } }, async (a) => { find(customers, a.customer_id, "customer").on_hold = true; return text({ ok: true }); });
s.registerTool("release_customer", { description: "Release a customer from credit hold.", inputSchema: { customer_id: z.string(), reason: z.string() } }, async (a) => { find(customers, a.customer_id, "customer").on_hold = false; return text({ ok: true }); });
s.registerTool("ship_order", { description: "Record a shipment against a confirmed order.", inputSchema: { order_id: z.string(), tracking: z.string().optional(), _reason: z.string().optional() } }, async (a) => { const o = find(orders, a.order_id, "order"); o.status = "shipped"; return text({ ok: true }); });
s.registerTool("set_price", { description: "Change an item's list price. Cents.", inputSchema: { item_id: z.string(), unit_price_cents: z.number().int(), _reason: z.string().optional() } }, async (a) => { find(items, a.item_id, "item").unit_price_cents = a.unit_price_cents; return text({ ok: true }); });
s.registerTool("receive_stock", { description: "Increase quantity on hand.", inputSchema: { item_id: z.string(), qty: z.number().int(), note: z.string().optional() } }, async (a) => { find(items, a.item_id, "item").on_hand += a.qty; return text({ ok: true }); });

await s.connect(new StdioServerTransport());
