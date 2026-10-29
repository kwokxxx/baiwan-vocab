import {
  createId,
  emptyData,
  parseBackup,
  applyEntryDeletions,
  STORAGE_KEY,
  upgradeDefaultGoals,
  type Entry,
  type StudyData,
} from "./study.ts";
import { mergeImport, mergeStudyData, same } from "./sync.ts";
import { SEED_ENTRIES } from "./entries.ts";
import { LEGACY_ENTRIES } from "./legacyEntries.ts";
import { CATALOG_VERSION } from "./libraryVersion.ts";
import { migrateCatalog, withLibraryAdditions } from "./catalog.ts";
import {
  requestJson,
  InvalidResponseError,
  RequestTimeoutError,
  RequestCancelledError,
  browserRequest,
} from "./network.ts";

export type CloudUser = { id: string; email: string; name: string };
type Pending = { revision: number; mutationId: string; data: StudyData };
type Envelope = {
  data: StudyData;
  base: StudyData;
  revision: number;
  pending?: Pending;
  lastSynced: number;
};
type CloudState = {
  data: StudyData;
  user: CloudUser | null;
  status: "guest" | "syncing" | "synced" | "pending" | "error";
  error: string;
  storageError: string;
  lastSynced: number;
  library: Entry[];
};
const ACTIVE_KEY = "shici-active-account-v1";
const LIBRARY_KEY = `shici-cloud-library-v1:${CATALOG_VERSION}`;
const accountKey = (id: string) => `shici-account-v1:${id}`;
const blankEnvelope = (): Envelope => ({
  data: emptyData(),
  base: emptyData(),
  revision: 0,
  lastSynced: 0,
});
const isUser = (u: CloudUser | null): u is CloudUser =>
  Boolean(
    u &&
    typeof u.id === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(u.id) &&
    typeof u.email === "string" &&
    typeof u.name === "string",
  );
export class CloudError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export class StudyStore {
  private envelope = blankEnvelope();
  private listeners = new Set<() => void>();
  private syncing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private available: boolean;
  private state: CloudState;
  private storage: Storage;
  private request: typeof fetch;
  private requestTimeoutMs: number;
  constructor(
    storage: Storage,
    request: typeof fetch = browserRequest,
    available = true,
    requestTimeoutMs = 12_000,
  ) {
    this.storage = storage;
    // Native WebKit fetch must not receive this store instance as its receiver.
    this.request = (input, init) => request(input, init);
    this.available = available;
    this.requestTimeoutMs = requestTimeoutMs;
    this.state = {
      data: emptyData(),
      user: null,
      status: "guest",
      error: "",
      storageError: "",
      lastSynced: 0,
      library: SEED_ENTRIES,
    };
    try {
      const user = JSON.parse(storage.getItem(ACTIVE_KEY) ?? "null");
      this.switchAccount(isUser(user) ? user : null);
      const library = JSON.parse(storage.getItem(LIBRARY_KEY) ?? "null");
      if (Array.isArray(library) && library.length)
        this.state.library = this.validateLibrary(library);
    } catch {
      this.set({
        storageError: "本地记录无法读取，原数据已保留。请先导出备份。",
      });
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(update: Partial<CloudState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private readEnvelope(id: string): Envelope {
    const raw = this.storage.getItem(accountKey(id));
    if (!raw) return blankEnvelope();
    const saved = JSON.parse(raw);
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
      throw new Error("Invalid cache");
    const data = parseBackup(saved.data);
    const migrated = upgradeDefaultGoals(migrateCatalog(data));
    if (migrated !== data) {
      if (data.catalogVersion !== CATALOG_VERSION) {
        this.archiveCatalog(data, id);
        saved.pending = undefined;
      }
      saved.data = migrated;
      this.storage.setItem(accountKey(id), JSON.stringify(saved));
    }
    return {
      ...saved,
      data: migrated,
      base: parseBackup(saved.base),
    };
  }
  private archiveCatalog(data: StudyData, account: string) {
    const key = `shici-before-phrases-v1:${account}`;
    if (!this.storage.getItem(key))
      this.storage.setItem(
        key,
        JSON.stringify({ ...data, library: data.library ?? LEGACY_ENTRIES }),
      );
  }
  previousCatalogBackup = () =>
    this.storage.getItem(
      `shici-before-phrases-v1:${this.state.user?.id ?? "guest"}`,
    );
  previousRestoreBackup = () =>
    this.storage.getItem(
      `shici-before-restore-v1:${this.state.user?.id ?? "guest"}`,
    );
  fullSnapshot = (): StudyData => ({
    ...this.state.data,
    library: withLibraryAdditions(
      this.state.data.library ?? this.state.library,
      this.state.data.customEntries,
    ),
  });
  private persist() {
    if (this.state.storageError) return false;
    try {
      this.storage.setItem(
        this.state.user ? accountKey(this.state.user.id) : STORAGE_KEY,
        JSON.stringify(this.state.user ? this.envelope : this.state.data),
      );
      return true;
    } catch {
      this.set({ storageError: "设备空间不足，更改尚未保存。请先导出备份。" });
      return false;
    }
  }
  private switchAccount(user: CloudUser | null) {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.envelope = blankEnvelope();
    let data = emptyData(),
      storageError = "";
    try {
      if (user) {
        this.envelope = this.readEnvelope(user.id);
        data = this.envelope.data;
      } else {
        const raw = this.storage.getItem(STORAGE_KEY);
        data = raw ? parseBackup(JSON.parse(raw)) : emptyData();
        const migrated = upgradeDefaultGoals(migrateCatalog(data));
        if (migrated !== data) {
          if (data.catalogVersion !== CATALOG_VERSION)
            this.archiveCatalog(data, "guest");
          data = migrated;
          this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        this.envelope = blankEnvelope();
      }
      if (user) this.storage.setItem(ACTIVE_KEY, JSON.stringify(user));
      else this.storage.removeItem(ACTIVE_KEY);
    } catch {
      storageError = "本地记录无法读取，原数据已保留。请先导出备份。";
    }
    this.set({
      user,
      data,
      storageError,
      error: "",
      status: user ? "pending" : "guest",
      lastSynced: user ? this.envelope.lastSynced : 0,
    });
  }
  save = (next: StudyData) => {
    // Reconcile writes from another open tab before changing this tab's copy.
    if (!this.state.user && !this.state.storageError) {
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        const stored = raw ? parseBackup(JSON.parse(raw)) : this.state.data;
        if (
          stored.catalogVersion === CATALOG_VERSION &&
          !same(stored, this.state.data)
        )
          next = mergeStudyData(this.state.data, next, stored);
      } catch {
        this.set({ storageError: "无法读取本机最新记录，请先导出备份。" });
        return;
      }
    }
    if (this.state.user && !this.state.storageError) {
      try {
        const stored = this.readEnvelope(this.state.user.id);
        if (!same(stored.data, this.envelope.data))
          next = mergeStudyData(this.state.data, next, stored.data);
      } catch {
        this.set({ storageError: "无法读取账号缓存，请先导出备份。" });
      }
    }
    next = applyEntryDeletions(next);
    this.envelope = { ...this.envelope, data: next };
    this.set({ data: next, status: this.state.user ? "pending" : "guest" });
    if (this.persist() && this.state.user && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.sync();
      }, 5000);
    }
  };
  restore = (backup: StudyData) => {
    try {
      this.storage.setItem(
        `shici-before-restore-v1:${this.state.user?.id ?? "guest"}`,
        JSON.stringify(this.fullSnapshot()),
      );
    } catch {
      this.set({
        storageError: "无法保存恢复前快照，请先导出当前备份并释放存储空间。",
      });
      return false;
    }
    this.set({ storageError: "" });
    const restored = {
      ...backup,
      catalogVersion: CATALOG_VERSION,
      settingsUpdatedAt: Date.now(),
      session: backup.session
        ? { ...backup.session, updatedAt: Date.now() }
        : null,
    };
    this.save(
      this.state.user
        ? {
            ...mergeImport(restored, this.state.data),
            library: restored.library,
            customEntries: restored.customEntries,
            session: restored.session,
            dailyGoal: restored.dailyGoal,
            reviewGoal: restored.reviewGoal,
          }
        : restored,
    );
    return !this.state.storageError;
  };
  persistForReload = () => this.persist();
  exportText = () =>
    this.state.storageError
      ? (this.storage.getItem(
          this.state.user ? accountKey(this.state.user.id) : STORAGE_KEY,
        ) ?? JSON.stringify(this.state.data))
      : JSON.stringify(this.fullSnapshot(), null, 2);
  hasGuestData = () => {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? !same(parseBackup(JSON.parse(raw)), emptyData()) : false;
    } catch {
      return false;
    }
  };
  importGuest = () => {
    if (!this.state.user) return;
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw)
      this.save(
        mergeImport(
          migrateCatalog(parseBackup(JSON.parse(raw))),
          this.state.data,
        ),
      );
  };
  private async api(path: string, body?: unknown) {
    let response, value;
    try {
      ({ response, value } = await requestJson(
        `/api/${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "X-Shici-Protocol": "daily-v1",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(path === "study" && this.state.user
              ? { "X-Shici-Account": this.state.user.id }
              : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        this.request,
        this.requestTimeoutMs,
      ));
    } catch (error) {
      if (error instanceof RequestTimeoutError)
        throw new CloudError("云端响应超时，记录已保存在本机，稍后会重试");
      if (error instanceof InvalidResponseError)
        throw new CloudError(
          error.status >= 500
            ? `云端服务暂时异常（${error.status}），记录已保留`
            : "云端没有返回正确的数据，可能仍在使用旧缓存。请重新加载应用。",
          error.status,
        );
      if (error instanceof RequestCancelledError)
        throw new CloudError("请求已中断，记录已保存在本机");
      throw new CloudError(
        "未能连接到百万背单词服务器，记录已保存在本机。可以点击“检查云端连接”进一步确认。",
      );
    }
    if (!response.ok && response.status !== 409) {
      const message =
        response.status === 401
          ? "登录已过期，请重新登录；本地记录已保留"
          : response.status === 429
            ? "操作较频繁，请稍等一分钟再试"
            : (value.error ?? value.message ?? "连接失败，请稍后重试");
      throw new CloudError(
        typeof message === "string" ? message : "云端暂时不可用",
        response.status,
      );
    }
    return { status: response.status, value };
  }
  checkConnection = async (signal?: AbortSignal) => {
    const options = { cache: "no-store" as RequestCache, signal };
    let health;
    try {
      health = await requestJson(
        "/api/health",
        { ...options, credentials: "same-origin" },
        this.request,
        8000,
      );
    } catch (error) {
      if (error instanceof RequestCancelledError) throw error;
      if (error instanceof InvalidResponseError)
        return `接口返回了网页或异常内容（HTTP ${error.status}），请点击“重新加载应用”。`;
      try {
        const site = await requestJson(
          `/version.json?t=${Date.now()}`,
          { ...options, credentials: "same-origin" },
          this.request,
          8000,
        );
        if (site.response.ok && site.value?.buildId)
          return "网页资源可以访问，但云端接口暂未响应。记录已保留，可稍后重试同步。";
      } catch (nextError) {
        if (nextError instanceof RequestCancelledError) throw nextError;
      }
      return "手机当前未能访问百万背单词服务器；这不等于手机没有网络。记录已保留，可切换 Wi-Fi / 蜂窝网络后重试。";
    }
    if (!health.response.ok || health.value?.database !== "ok")
      return "已连接到服务器，但云数据库暂时不可用，请稍后重试。";
    const session = await requestJson(
      "/api/auth/get-session",
      { ...options, credentials: "same-origin" },
      this.request,
      8000,
    );
    if (!session.response.ok)
      return `云端可连接，但登录检查返回 ${session.response.status}，请稍后重试。`;
    if (!isUser(session.value?.user))
      return "服务器和数据库正常；当前登录已失效，请重新登录，设备上的记录会保留。";
    if (this.state.user && session.value.user.id !== this.state.user.id)
      return "云端连接正常，但当前账号会话已变化，请重新登录。";
    const study = await requestJson(
      "/api/study",
      {
        ...options,
        credentials: "same-origin",
        headers: { "X-Shici-Account": session.value.user.id },
      },
      this.request,
      8000,
    );
    if (!study.response.ok)
      return `登录状态正常，但学习数据接口返回 ${study.response.status}，请稍后重试。`;
    parseBackup(study.value.data);
    return "服务器、数据库和登录状态均正常。可以点击“立即同步”继续上传本机记录。";
  };
  authenticate = async (
    mode: "login" | "register",
    email: string,
    password: string,
    name: string,
    importLocal: boolean,
  ) => {
    if (!this.available) throw new Error("请在已发布的 HTTPS 网页中登录");
    await this.api(
      `auth/${mode === "register" ? "sign-up" : "sign-in"}/email`,
      {
        email: email.trim(),
        password,
        ...(mode === "register"
          ? { name: name.trim() || email.split("@")[0] }
          : {}),
      },
    );
    const { value } = await this.api("auth/get-session");
    if (!isUser(value?.user)) throw new Error("未能建立登录会话，请重试");
    // Preserve an expired session's pending offline edits when signing back into it.
    if (this.state.user?.id !== value.user.id) this.switchAccount(value.user);
    if (importLocal) this.importGuest();
    await this.sync();
  };
  changePassword = async (currentPassword: string, newPassword: string) => {
    await this.api("auth/change-password", {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
  };
  logout = async () => {
    await this.sync();
    if (!same(this.envelope.data, this.envelope.base) || this.envelope.pending)
      throw new Error("还有记录未同步，请联网同步成功后再退出");
    await this.api("auth/sign-out", {});
    this.switchAccount(null);
  };
  private validateLibrary(entries: Entry[]) {
    if (
      entries.length > 5000 ||
      new Set(entries.map((e) => e.id)).size !== entries.length ||
      entries.some((e) => !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id))
    )
      throw new Error("词库数据无效");
    parseBackup({
      ...emptyData(),
      customEntries: entries.map((entry, i) => ({
        ...entry,
        id: `custom-check-${i}`,
      })),
    });
    return withLibraryAdditions(entries);
  }
  refreshLibrary = async () => {
    if (!this.available) return;
    try {
      const { value } = await this.api("library");
      if (value.catalogVersion !== CATALOG_VERSION) return;
      const library = this.validateLibrary(value.entries);
      if (!library.length) return;
      this.storage.setItem(LIBRARY_KEY, JSON.stringify(library));
      this.set({ library });
    } catch {
      /* Bundled/cached library remains usable offline. */
    }
  };
  sync = (): Promise<void> => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.syncing) return this.syncing;
    this.syncing = this.syncNow().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  };
  private async syncNow() {
    if (!this.available || this.state.storageError) return;
    const startedGeneration = this.generation;
    try {
      const session = (await this.api("auth/get-session")).value;
      if (startedGeneration !== this.generation) return;
      if (!isUser(session?.user)) {
        if (this.state.user)
          throw new CloudError("登录已过期，请重新登录；本地记录已保留", 401);
        return;
      }
      if (this.state.user && this.state.user.id !== session.user.id)
        throw new CloudError("账号已在其他页面切换，请重新登录当前账号", 401);
      if (!this.state.user) this.switchAccount(session.user);
      const userId = this.state.user!.id,
        generation = this.generation;
      const stillCurrent = () =>
        this.generation === generation && this.state.user?.id === userId;
      this.set({ status: "syncing", error: "" });
      // Retry a durable in-flight mutation before pulling: a lost acknowledgement must not double-count.
      for (let attempt = 0; attempt < 4; attempt++) {
        const pending = this.envelope.pending;
        const result = await this.api("study", pending);
        if (!stillCurrent()) return;
        if (result.value.userId !== userId)
          throw new Error("账号校验失败，请重新登录");
        const rawRemote = parseBackup(result.value.data);
        const remote = upgradeDefaultGoals(rawRemote);
        const base =
          pending && result.status === 200 ? pending.data : this.envelope.base;
        const data = mergeStudyData(base, this.envelope.data, remote);
        this.envelope = {
          data,
          base: rawRemote,
          revision: result.value.revision,
          lastSynced: Date.now(),
        };
        this.set({ data, lastSynced: this.envelope.lastSynced });
        if (!this.persist()) return;
        if (same(data, rawRemote)) {
          this.set({ status: "synced", error: "" });
          return;
        }
        this.envelope.pending = {
          revision: this.envelope.revision,
          mutationId: createId(),
          data,
        };
        if (!this.persist()) return;
      }
      this.set({ status: "pending", error: "其他设备也在更新，稍后继续同步" });
    } catch (error) {
      this.set({
        status: this.state.user ? "error" : "guest",
        error:
          error instanceof CloudError ||
          (error instanceof Error &&
            !/fetch|network|timeout/i.test(error.message))
            ? (error as Error).message
            : "暂时连不上云端，记录已保存在本机，联网后会重试",
      });
    }
  }
  start = () => {
    void this.refreshLibrary();
    void this.sync();
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void this.sync();
        void this.refreshLibrary();
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (!this.state.user && event.key === STORAGE_KEY) {
        try {
          const raw = this.storage.getItem(STORAGE_KEY);
          if (!raw) return;
          const incoming = parseBackup(JSON.parse(raw));
          if (incoming.catalogVersion !== CATALOG_VERSION) {
            this.persist();
            return;
          }
          this.set({ data: incoming });
        } catch {
          /* Keep the current valid snapshot. */
        }
      } else if (event.key === ACTIVE_KEY) {
        try {
          const user = JSON.parse(this.storage.getItem(ACTIVE_KEY) ?? "null");
          this.switchAccount(isUser(user) ? user : null);
        } catch {
          /* Keep last valid state. */
        }
      } else if (
        this.state.user &&
        event.key === accountKey(this.state.user.id) &&
        !this.syncing
      ) {
        try {
          this.envelope = this.readEnvelope(this.state.user.id);
          this.set({ data: this.envelope.data });
        } catch {
          /* Keep last valid state. */
        }
      }
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", storageChanged);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && this.state.user)
        void this.sync();
    }, 30_000);
    return () => {
      clearInterval(interval);
      clearTimeout(this.timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", storageChanged);
    };
  };
}
