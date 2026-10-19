import {
  requestJson,
  RequestCancelledError,
  RequestTimeoutError,
  InvalidResponseError,
  requestText,
  browserRequest,
} from "./network.ts";

export type Release = { version: string; buildId: string };
type UpdateState = {
  checking: boolean;
  available: boolean;
  message: string;
  failed: boolean;
  latest: Release | null;
};

function validRelease(value: unknown): value is Release {
  if (!value || typeof value !== "object") return false;
  const release = value as Release;
  return (
    typeof release.version === "string" &&
    /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(release.version) &&
    typeof release.buildId === "string" &&
    /^[a-f0-9]{16}$/.test(release.buildId)
  );
}
function failureDetail(error: unknown) {
  if (error instanceof RequestTimeoutError) return "请求超时";
  if (error instanceof InvalidResponseError)
    return `返回了非 JSON 内容（HTTP ${error.status}）`;
  if (error instanceof Error)
    return `${error.name}: ${error.message.slice(0, 120)}`;
  return "请求失败";
}

// App-version checks do not await service-worker installation, login or cloud sync.
export class UpdateChecker {
  private current: { version: string; buildId: string | null };
  private request: typeof fetch;
  private timeoutMs: number;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  private state: UpdateState = {
    checking: false,
    available: false,
    message: "",
    failed: false,
    latest: null,
  };
  constructor(
    current: { version: string; buildId: string | null },
    request: typeof fetch = browserRequest,
    timeoutMs = 8000,
  ) {
    this.current = current;
    this.request = (input, init) => request(input, init);
    this.timeoutMs = timeoutMs;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(next: Partial<UpdateState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    this.controller?.abort();
    this.controller = null;
    this.set({
      checking: false,
      failed: false,
      message: "已取消检查，可以稍后重试",
    });
  };
  check = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent && this.controller) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.set({
      checking: !silent,
      ...(silent
        ? {}
        : { failed: false, message: "正在检查新版本，可随时取消…" }),
    });
    try {
      const started = Date.now();
      const options = {
        cache: "no-store" as RequestCache,
        credentials: "same-origin" as RequestCredentials,
        signal: controller.signal,
      };
      let value: Release;
      try {
        const result = await requestJson(
          `/version.json?t=${started}`,
          options,
          this.request,
          Math.max(1, Math.floor(this.timeoutMs / 2)),
        );
        if (!result.response.ok)
          throw new Error(`HTTP ${result.response.status}`);
        if (!validRelease(result.value)) throw new Error("版本文件格式不正确");
        value = result.value;
      } catch (firstError) {
        if (firstError instanceof RequestCancelledError) throw firstError;
        try {
          // This endpoint already serves the fresh document without app-cache fallback.
          // It also avoids depending on a single .json path on mobile networks.
          const remaining = Math.max(
            1,
            this.timeoutMs - (Date.now() - started),
          );
          const result = await requestText(
            `/api/update?check=${Date.now()}`,
            options,
            this.request,
            remaining,
          );
          if (!result.response.ok)
            throw new Error(`HTTP ${result.response.status}`);
          const release = {
            version: result.value.match(
              /<meta\s+name=["']shici-version["']\s+content=["']([^"']+)["']/,
            )?.[1],
            buildId: result.value.match(
              /<meta\s+name=["']shici-build["']\s+content=["']([^"']+)["']/,
            )?.[1],
          };
          if (!validRelease(release))
            throw new Error("更新入口没有返回新版标识");
          value = release;
        } catch (secondError) {
          if (secondError instanceof RequestCancelledError) throw secondError;
          if (
            firstError instanceof RequestTimeoutError &&
            secondError instanceof RequestTimeoutError
          )
            throw secondError;
          throw new Error(
            `版本文件：${failureDetail(firstError)}；更新入口：${failureDetail(secondError)}`,
          );
        }
      }
      if (this.controller !== controller) return;
      const available = this.current.buildId
        ? value.buildId !== this.current.buildId
        : value.version !== this.current.version;
      this.set({
        available,
        latest: value,
        ...(silent
          ? {}
          : {
              failed: false,
              message: available
                ? `发现新版本 ${value.version}，可以更新`
                : `当前已是最新版本 ${this.current.version}`,
            }),
      });
    } catch (error) {
      if (
        this.controller !== controller ||
        silent ||
        error instanceof RequestCancelledError
      )
        return;
      this.set({
        failed: true,
        message:
          error instanceof RequestTimeoutError
            ? "检查超时，请稍后重试。已保存的学习记录不受影响。"
            : `暂时无法获取版本信息。${failureDetail(error)}`,
      });
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.set({ checking: false });
      }
    }
  };
}

export function recoveryUrl(currentUrl: string) {
  const current = new URL(currentUrl);
  const destination = new URL("/api/update", current.origin);
  const mode = current.searchParams.get("mode");
  if (mode === "phone" || mode === "preview")
    destination.searchParams.set("mode", mode);
  destination.searchParams.set("t", String(Date.now()));
  return destination.href;
}
