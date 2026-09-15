import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { legacyUrl, rootPresentationUrl } from "./legacy-url";
import { redirectLegacyFamily } from "./legacy-redirect-page";

test("compatibility pages redirect without losing encoded or repeated queries", async () => {
  for (const oldPath of ["/areas", "/areas/block-1", "/properties/building-1/prepare", "/registry/3DU-A%3AB001", "/workbench", "/sites/site-1"]) {
    const input = new URL(oldPath + "?case=c1&feature=b1&record=unit%3A1&tag=a&tag=b&name=A%20%26%20B", "http://localhost:3000");
    const [, family, ...segments] = input.pathname.split("/");
    const query = Object.fromEntries([...new Set(input.searchParams.keys())].map(key=>[key,input.searchParams.getAll(key)]));
    await assert.rejects(redirectLegacyFamily(family as Parameters<typeof redirectLegacyFamily>[0], {params:Promise.resolve({path:segments.map(decodeURIComponent)}),searchParams:Promise.resolve(query)}), error => {
      const digest = (error as Error & {digest:string}).digest;
      const redirected = new URL(digest.split(";")[2],input.origin);
      assert.equal(redirected.pathname,"/legacy"+input.pathname);
      assert.deepEqual([...redirected.searchParams],[...input.searchParams]);
      return digest.startsWith("NEXT_REDIRECT;") && digest.endsWith(";307;");
    });
  }
});

test("root defaults to V2 while case bookmarks preserve all their legacy context", () => {
  assert.equal(rootPresentationUrl({}), "/v2");
  assert.equal(rootPresentationUrl({area:"block-1"}), "/v2?area=block-1");
  const result = new URL(rootPresentationUrl({case:"c1",building:"b1",area:"a1",tag:["first","second"],name:"A & B"}), "http://local");
  assert.equal(result.pathname, "/legacy");
  assert.deepEqual(result.searchParams.getAll("tag"), ["first","second"]);
  assert.equal(result.searchParams.get("name"), "A & B");
  assert.equal(result.searchParams.get("building"), "b1");
  assert.equal(rootPresentationUrl({case:""}), "/legacy?case=");
});

test("legacy presentation URLs are idempotent and never rewrite API/evidence/external links", () => {
  assert.equal(legacyUrl("/"), "/legacy");
  assert.equal(legacyUrl("/?case=c&building=b#reference"), "/legacy?case=c&building=b#reference");
  assert.equal(legacyUrl("/properties/b/prepare?source=s#part"), "/legacy/properties/b/prepare?source=s#part");
  for (const input of ["/legacy", "/legacy/areas/a", "/api/v1/sources/s/file#page=2", "https://example.com/areas/a", "//example.com/registry/a", "/v2/workspace", "#reference", "/areas-other"])
    assert.equal(legacyUrl(input), input);
});

test("retained legacy styles affect only the legacy subtree even after its removal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="legacy-app"><div class="workbench"><button id="old">Legacy</button></div></div><main id="outside" class="workbench"><button id="new">V2 sentinel</button></main>');
    const metrics = () => page.evaluate(() => {
      const button = getComputedStyle(document.querySelector("#new")!);
      const outside = getComputedStyle(document.querySelector("#outside")!);
      return { font:button.font, border:button.border, padding:outside.paddingTop, body:getComputedStyle(document.body).margin, rootFont:getComputedStyle(document.documentElement).fontSize };
    });
    const before = await metrics();
    await page.addStyleTag({content:await readFile(new URL("../app/globals.css",import.meta.url),"utf8")});
    await page.addStyleTag({content:await readFile(new URL("../components/OfficerNavigation.css",import.meta.url),"utf8")});
    assert.deepEqual(await metrics(),before);
    assert.equal(await page.locator(".legacy-app").evaluate(element=>getComputedStyle(element).position),"fixed");
    assert.equal(await page.locator(".legacy-app .workbench").evaluate(element=>getComputedStyle(element).paddingTop),"78px");
    await page.locator(".legacy-app").evaluate(element=>element.remove());
    assert.deepEqual(await metrics(),before);
  } finally { await browser.close(); }
});
