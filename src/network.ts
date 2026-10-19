export class RequestTimeoutError extends Error {
  constructor() {
    super("请求超时");
    this.name = "RequestTimeoutError";
  }
}
export class RequestCancelledError extends Error {
  constructor() {
    super("请求已取消");
    this.name = "RequestCancelledError";
  }
}
export class InvalidResponseError extends Error {
  status: number;
  constructor(status: number) {
    super("服务器没有返回有效数据");
    this.name = "InvalidResponseError";
    this.status = status;
  }
}

// Keep the Window/global receiver even if a browser or webview wraps fetch.
export const browserRequest: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

// Bound the whole operation, including response-body reading. An abort signal alone
// cannot release the UI if the browser or a transport fails to settle its promise.
export function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", cancel);
      callback();
    };
    const cancel = () => {
      finish(() => reject(new RequestCancelledError()));
      controller.abort();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new RequestTimeoutError()));
      controller.abort();
    }, timeoutMs);
    if (externalSignal?.aborted) {
      cancel();
      return;
    }
    externalSignal?.addEventListener("abort", cancel, { once: true });
    try {
      operation(controller.signal).then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function requestJson(
  url: string,
  init: RequestInit = {},
  request: typeof fetch = browserRequest,
  timeoutMs = 12_000,
) {
  return withDeadline(
    async (signal) => {
      const response = await request(url, { ...init, signal });
      let value;
      try {
        value = await response.json();
      } catch {
        throw new InvalidResponseError(response.status);
      }
      return { response, value };
    },
    timeoutMs,
    init.signal ?? undefined,
  );
}

export function requestText(
  url: string,
  init: RequestInit = {},
  request: typeof fetch = browserRequest,
  timeoutMs = 12_000,
) {
  return withDeadline(
    async (signal) => {
      const response = await request(url, { ...init, signal });
      return { response, value: await response.text() };
    },
    timeoutMs,
    init.signal ?? undefined,
  );
}
