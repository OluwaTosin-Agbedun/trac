// Team directory helpers: slugs, filter parsing and links. Run: node --test tests/lib/cmsDirectory.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CMS_PATH,
  cmsInstitutionsHref,
  hasCmsFilters,
  isIsoDate,
  isValidSlug,
  pageRange,
  parseCmsInstitutionFilters,
  suggestSlug,
} from "../../src/lib/cmsDirectory.ts";

test("slug validation matches the database rule and the 80 character cap", () => {
  assert.equal(isValidSlug("university-of-lagos"), true);
  assert.equal(isValidSlug("fupre2"), true);
  assert.equal(isValidSlug("a".repeat(80)), true);
  assert.equal(isValidSlug("a".repeat(81)), false);
  for (const bad of ["", "-lead", "trail-", "double--hyphen", "Upper", "spa ce", "under_score", "dot.ted", null, 5]) {
    assert.equal(isValidSlug(bad), false, String(bad));
  }
});

test("suggested slugs are always valid or empty", () => {
  assert.equal(suggestSlug("University of Lagos"), "university-of-lagos");
  assert.equal(suggestSlug("  Federal Polytechnic, Ilaro  "), "federal-polytechnic-ilaro");
  assert.equal(suggestSlug("Ahmadu Bello University (TEST DATA)"), "ahmadu-bello-university-test-data");
  assert.equal(suggestSlug("Science & Technology"), "science-and-technology");
  assert.equal(suggestSlug("Nnamdi Azikiwe's Université"), "nnamdi-azikiwes-universite");
  assert.equal(suggestSlug("!!!"), "");
  const long = suggestSlug("word ".repeat(40));
  assert.ok(long.length <= 80);
  assert.equal(isValidSlug(long), true);
  for (const name of ["A", "Abia State University, Uturu", "College of Education (Technical) — Asaba", "x".repeat(200)]) {
    assert.equal(isValidSlug(suggestSlug(name)), true, name);
  }
});

test("ISO dates must be real calendar dates in range", () => {
  assert.equal(isIsoDate("2026-10-24"), true);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("1999-12-31"), false);
  assert.equal(isIsoDate("24/10/2026"), false);
  assert.equal(isIsoDate("2026-10-24T00:00"), false);
  assert.equal(isIsoDate(undefined), false);
});

test("filter parsing drops unknown values and keeps known ones", () => {
  const f = parseCmsInstitutionFilters({
    q: "  lagos ",
    status: "draft",
    ownership: "federal",
    type: "university",
    state: "Lagos",
    assignee: "me",
    published: "no",
    sort: "updated",
    page: "3",
  });
  assert.deepEqual(f, {
    q: "lagos", status: "draft", ownership: "federal", type: "university", state: "Lagos",
    assignee: "me", published: "no", sort: "updated", page: 3,
  });

  const bad = parseCmsInstitutionFilters({
    status: "deleted", ownership: "x", type: "school", assignee: "'; drop table x; --", published: "maybe",
    sort: "score", page: "-2", state: "s".repeat(41),
  });
  assert.deepEqual(bad, {
    q: undefined, status: undefined, ownership: undefined, type: undefined, state: undefined,
    assignee: undefined, published: undefined, sort: "name", page: 1,
  });
});

test("assignee accepts me, none or a uuid only; arrays use the first value", () => {
  const id = "00000000-0000-4000-8000-0000000000E1";
  assert.equal(parseCmsInstitutionFilters({ assignee: id }).assignee, id.toLowerCase());
  assert.equal(parseCmsInstitutionFilters({ assignee: "none" }).assignee, "none");
  assert.equal(parseCmsInstitutionFilters({ assignee: "someone" }).assignee, undefined);
  assert.equal(parseCmsInstitutionFilters({ q: ["first", "second"] }).q, "first");
  assert.equal(parseCmsInstitutionFilters({ q: "x".repeat(300) }).q.length, 100);
  assert.equal(parseCmsInstitutionFilters({ page: "abc" }).page, 1);
  assert.equal(parseCmsInstitutionFilters({ page: "99999" }).page, 1);
});

test("links keep filters, leave defaults out and encode values", () => {
  const base = parseCmsInstitutionFilters({});
  assert.equal(cmsInstitutionsHref(base), CMS_PATH);
  assert.equal(hasCmsFilters(base), false);

  const f = parseCmsInstitutionFilters({ q: "Ife & co", state: "Akwa Ibom", published: "yes", sort: "updated", page: "2" });
  assert.equal(hasCmsFilters(f), true);
  const href = cmsInstitutionsHref(f);
  assert.ok(href.startsWith(`${CMS_PATH}?`));
  const sp = new URLSearchParams(href.split("?")[1]);
  assert.equal(sp.get("q"), "Ife & co");
  assert.equal(sp.get("state"), "Akwa Ibom");
  assert.equal(sp.get("published"), "yes");
  assert.equal(sp.get("sort"), "updated");
  assert.equal(sp.get("page"), "2");

  const next = new URLSearchParams(cmsInstitutionsHref(f, { page: 1, sort: "name" }).split("?")[1]);
  assert.equal(next.get("page"), null);
  assert.equal(next.get("sort"), null);
  assert.equal(hasCmsFilters({ ...base, sort: "updated", page: 4 }), false);
});

test("page range describes the rows shown", () => {
  assert.deepEqual(pageRange(1, 25, 25, 112), { from: 1, to: 25, pages: 5 });
  assert.deepEqual(pageRange(5, 25, 12, 112), { from: 101, to: 112, pages: 5 });
  assert.deepEqual(pageRange(1, 25, 0, 0), { from: 0, to: 0, pages: 1 });
  assert.deepEqual(pageRange(9, 25, 0, 30), { from: 0, to: 0, pages: 2 });
});
