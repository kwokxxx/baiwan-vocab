import test from "node:test";
import assert from "node:assert/strict";
import {
  withDeadline,
  requestJson,
  RequestTimeoutError,
  RequestCancelledError,
  InvalidResponseError,
  browserRequest,
} from "../src/network.ts";

test("a transport that ignores abort cannot hold a request forever", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    withDeadline((value) => {
      signal = value;
      return new Promise(() => {});
    }, 10),
    RequestTimeoutError,
  );
  assert.equal(signal?.aborted, true);
});
test("the timeout includes stalled JSON response bodies", async () => {
  const request = (async () => ({
    status: 200,
    ok: true,
    json: () => new Promise(() => {}),
  })) as typeof fetch;
  await assert.rejects(
    requestJson("/api/study", {}, request, 10),
    RequestTimeoutError,
  );
});
test("cancelling is immediate even when the underlying promise never settles", async () => {
  const controller = new AbortController();
  const pending = withDeadline(
    () => new Promise(() => {}),
    10_000,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, RequestCancelledError);
});
test("HTML in place of a JSON API response is distinguished from an offline error", async () => {
  const request = (async () =>
    new Response("<html>old cached app</html>", {
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch;
  await assert.rejects(
    requestJson("/api/study", {}, request),
    (error) => error instanceof InvalidResponseError && error.status === 200,
  );
});
test("no AbortSignal.timeout API is needed, and browser fetch has no store receiver", async () => {
  const request = function (this: unknown, _url: unknown, init?: RequestInit) {
    assert.equal(this, undefined);
    assert(init?.signal instanceof AbortSignal);
    return Promise.resolve(Response.json({ ok: true }));
  } as typeof fetch;
  assert.deepEqual((await requestJson("/version.json", {}, request)).value, {
    ok: true,
  });
});

test("the default browser adapter preserves the native global receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function (this: unknown) {
    assert.equal(this, globalThis);
    return Promise.resolve(Response.json({ ok: true }));
  } as typeof fetch;
  try {
    assert.equal((await browserRequest("/version.json")).status, 200);
  } finally {
    globalThis.fetch = original;
  }
});
