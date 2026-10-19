// Published amounts keep their exact stored decimal (trailing zeros and all digits), not a float.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { formatAmount } from "../../src/lib/format.ts";

const EDITOR = "00000000-0000-0000-0000-00000000000e";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const dir = new URL("../../db/migrations/", import.meta.url);
const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
await db.exec(`insert into app_users (id, email, display_name) values ('${EDITOR}', 'e@example.test', 'Editor'), ('${REVIEWER}', 'r@example.test', 'Reviewer');
  insert into team_memberships (user_id, role, display_name) values ('${EDITOR}', 'editor', 'Editor'), ('${REVIEWER}', 'reviewer', 'Reviewer');`);

async function as(user, q, params = []) {
  await db.exec(`select set_config('nut.user_id', '${user ?? ""}', false); set role ${user ? "nut_member" : "nut_anon"};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (user, q, params) => Object.values((await as(user, q, params))[0])[0];
const lock = (rev) => one(EDITOR, "select lock_version from revisions where id = $1", [rev]);

test("a published amount reaches the public payload as exact decimal text", async () => {
  const rev = await one(EDITOR, "select create_institution('exact-amount-university', 'Exact Amount University')");
  await one(EDITOR, "select save_profile($1, $2, $3)", [rev, await lock(rev), JSON.stringify({ assessment_period: "FY 2024" })]);
  await one(EDITOR, "select save_indicator($1, $2, 'budget_personnel', $3)", [rev, await lock(rev), JSON.stringify({
    state: "published", period_type: "financial_year", period_label: "2024", value_amount: "123456789012345678.50",
    value_scale: "units", value_currency: "NGN", value_literal: "₦123,456,789,012,345,678.50" })]);
  await one(EDITOR, "select add_evidence($1, $2, $3)", [rev, await lock(rev), JSON.stringify({
    indicator_key: "budget_personnel", url: "https://example.org/budget-2024.pdf", locator: "p. 3", excerpt: "Personnel" })]);
  await one(EDITOR, "select submit_revision($1, $2)", [rev, await lock(rev)]);
  await one(REVIEWER, "select review_revision($1, 'approved')", [rev]);
  await one(REVIEWER, "select publish_revision($1)", [rev]);
  const [row] = await as(null, `select i->>'value_amount' as amount, jsonb_typeof(i->'value_amount') as kind
                                   from published_snapshots s, jsonb_array_elements(s.payload->'indicators') i
                                  where i->>'key' = 'budget_personnel'`);
  assert.equal(row.kind, "string");
  assert.equal(row.amount, "123456789012345678.50");
  assert.equal(formatAmount(row.amount, "units", "NGN").includes("123,456,789,012,345,678.50"), true);
});
