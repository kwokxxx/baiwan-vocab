import test from "node:test";
import assert from "node:assert/strict";
import { UpdateChecker, recoveryUrl } from "../src/updates.ts";

const current = { version: "0.5.1", buildId: "aaaaaaaaaaaaaaaa" };
const releaseResponse = (buildId: string) =>
  Response.json({ version: "0.5.1", buildId });
test("checking leaves loading state when the network never responds, then can retry", async () => {
  let stuck = true;
  const checker = new UpdateChecker(
    current,
    (() =>
      stuck
        ? new Promise(() => {})
        : Promise.resolve(releaseResponse(current.buildId))) as typeof fetch,
    10,
  );
  const first = checker.check();
  assert.equal(checker.getSnapshot().checking, true);
  await first;
  assert.equal(checker.getSnapshot().checking, false);
  assert.match(checker.getSnapshot().message, /超时/);
  stuck = false;
  await checker.check();
  assert.equal(checker.getSnapshot().failed, false);
  assert.match(checker.getSnapshot().message, /最新版本/);
});
test("late completion of a cancelled check cannot overwrite a newer result", async () => {
  let resolveFirst: (response: Response) => void = () => {};
  let call = 0;
  const request = (() =>
    ++call === 1
      ? new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve(releaseResponse(current.buildId))) as typeof fetch;
  const checker = new UpdateChecker(current, request);
  const first = checker.check();
  checker.cancel();
  assert.equal(checker.getSnapshot().checking, false);
  await checker.check();
  resolveFirst(releaseResponse("bbbbbbbbbbbbbbbb"));
  await first;
  assert.equal(checker.getSnapshot().available, false);
  assert.match(checker.getSnapshot().message, /最新版本/);
});
test("checks need no auth API and detect same-version rebuilds", async () => {
  const request = (async (_url, init) => {
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return releaseResponse("bbbbbbbbbbbbbbbb");
  }) as typeof fetch;
  const checker = new UpdateChecker(current, request);
  await checker.check();
  assert.equal(checker.getSnapshot().available, true);
  assert.equal(checker.getSnapshot().checking, false);
});

test("when the JSON path fails, the working update document provides a fallback", async () => {
  const paths: string[] = [];
  const request = (async (url, init) => {
    paths.push(String(url));
    assert.equal(init?.credentials, "same-origin");
    if (String(url).startsWith("/version.json"))
      return new Response("<html>old cached app</html>");
    return new Response(
      '<meta name="shici-build" content="bbbbbbbbbbbbbbbb" /><meta name="shici-version" content="0.5.2" />',
    );
  }) as typeof fetch;
  const checker = new UpdateChecker(current, request);
  await checker.check();
  assert.equal(checker.getSnapshot().failed, false);
  assert.equal(checker.getSnapshot().available, true);
  assert.equal(checker.getSnapshot().latest?.version, "0.5.2");
  assert.equal(paths.length, 2);
  assert(paths[1].startsWith("/api/update?check="));
});
test("a cached HTML page cannot be reported as the latest version", async () => {
  const checker = new UpdateChecker(
    current,
    (async () => new Response("<html>examine</html>")) as typeof fetch,
  );
  await checker.check();
  assert.equal(checker.getSnapshot().failed, true);
  assert.equal(checker.getSnapshot().checking, false);
});
test("the recovery URL stays on the same origin and does not forward sensitive parameters", () => {
  const url = new URL(
    recoveryUrl(
      "https://vocab-practice-dun.vercel.app/?mode=phone&token=private",
    ),
  );
  assert.equal(url.origin, "https://vocab-practice-dun.vercel.app");
  assert.equal(url.pathname, "/api/update");
  assert.equal(url.searchParams.get("mode"), "phone");
  assert.equal(url.searchParams.has("token"), false);
});
