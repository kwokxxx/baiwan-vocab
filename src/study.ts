import { CATALOG_VERSION } from "./libraryVersion.ts";
export type EntryKind = "word" | "phrase";
export type Entry = {
  id: string;
  kind: EntryKind;
  term: string;
  phonetic: string;
  part: string;
  meaning: string;
  example: string;
  translation: string;
  context: string;
  contextTranslation: string;
  related: { term: string; meaning: string }[];
  source?: string;
};
export type Progress = {
  stage: number;
  dueAt: number;
  lastReviewedAt: number;
  reviews: number;
  lapses: number;
  suspended: boolean;
};
export type ReviewEvent = {
  id: string;
  entryId: string;
  at: number;
  rating: "known" | "forgot" | "easy";
  isNew: boolean;
  hinted: boolean;
  practice?: boolean;
};
export type LearningSession = {
  id: string;
  day: string;
  kind: EntryKind | "all";
  round: string[];
  pending: string[];
  index: number;
  results: Record<string, boolean>;
  everMissed: string[];
  extra: boolean;
  updatedAt: number;
};
export type StudyData = {
  version: 1;
  customEntries: Entry[];
  progress: Record<string, Progress>;
  favorites: string[];
  notes: Record<string, string>;
  events: ReviewEvent[];
  activeSeconds: Record<string, number>;
  dailyGoal: number;
  reviewGoal?: number;
  catalogVersion?: string;
  library?: Entry[];
  session?: LearningSession | null;
  sessionSlots?: Partial<Record<EntryKind | "all", LearningSession>>;
  settingsUpdatedAt?: number;
  voiceURI?: string;
  autoSpeak?: boolean;
  // Explicit false restores a deletion. Missing keys in older clients never undo it.
  deletedEntries?: Record<string, boolean>;
};

// A transparent expanding-interval schedule inspired by the spacing effect.
// These are product defaults, not an empirically universal Ebbinghaus timetable.
export const REVIEW_DAYS = [1, 2, 4, 7, 15, 30, 60, 90, 180];
export const INTERVALS = REVIEW_DAYS.map((days) => days * 86400_000);
export const INTERVAL_LABELS = REVIEW_DAYS.map((days) => `${days} 天`);
export const STORAGE_KEY = "shici-offline-v1";

export function createId(
  random: Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">> = globalThis.crypto,
) {
  if (random.randomUUID) return random.randomUUID();
  // randomUUID is unavailable on a plain-HTTP LAN preview. getRandomValues
  // remains available and gives our local records stable, collision-safe IDs.
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyData(): StudyData {
  return {
    version: 1,
    customEntries: [],
    progress: {},
    favorites: [],
    notes: {},
    events: [],
    activeSeconds: {},
    dailyGoal: 15,
    reviewGoal: 45,
    catalogVersion: CATALOG_VERSION,
    session: null,
    autoSpeak: true,
    deletedEntries: {},
  };
}

export function upgradeDefaultGoals(data: StudyData): StudyData {
  if (
    !data.settingsUpdatedAt &&
    data.dailyGoal === 20 &&
    (data.reviewGoal === undefined || data.reviewGoal === 60)
  ) {
    return { ...data, dailyGoal: 15, reviewGoal: 45 };
  }
  return data;
}

export type DeletedEntryBackup = {
  entry: Entry;
  wasCustom: boolean;
  progress?: Progress;
  note?: string;
  favorite: boolean;
};

export function visibleEntries(entries: Entry[], data: StudyData) {
  return entries.filter((entry) => !data.deletedEntries?.[entry.id]);
}

export function applyEntryDeletions(data: StudyData): StudyData {
  const deleted = data.deletedEntries ?? {};
  if (!Object.values(deleted).some(Boolean)) return data;
  return {
    ...data,
    customEntries: visibleEntries(data.customEntries, data),
    progress: Object.fromEntries(
      Object.entries(data.progress).filter(([id]) => !deleted[id]),
    ),
    favorites: data.favorites.filter((id) => !deleted[id]),
    notes: Object.fromEntries(
      Object.entries(data.notes).filter(([id]) => !deleted[id]),
    ),
  };
}

export function removeEntry(data: StudyData, entry: Entry) {
  const backup: DeletedEntryBackup = {
    entry,
    wasCustom: data.customEntries.some((item) => item.id === entry.id),
    progress: data.progress[entry.id],
    note: data.notes[entry.id],
    favorite: data.favorites.includes(entry.id),
  };
  return {
    backup,
    data: applyEntryDeletions({
      ...data,
      deletedEntries: { ...data.deletedEntries, [entry.id]: true },
    }),
  };
}

export function restoreEntry(
  data: StudyData,
  backup: DeletedEntryBackup,
): StudyData {
  const id = backup.entry.id;
  if (!data.deletedEntries?.[id]) return data;
  return {
    ...data,
    deletedEntries: { ...data.deletedEntries, [id]: false },
    customEntries:
      backup.wasCustom && !data.customEntries.some((entry) => entry.id === id)
        ? [...data.customEntries, backup.entry]
        : data.customEntries,
    progress: backup.progress
      ? { ...data.progress, [id]: backup.progress }
      : data.progress,
    notes:
      backup.note !== undefined
        ? { ...data.notes, [id]: backup.note }
        : data.notes,
    favorites: backup.favorite
      ? [...new Set([...data.favorites, id])]
      : data.favorites,
  };
}

export function scheduleReview(
  previous: Progress | undefined,
  rating: ReviewEvent["rating"],
  now: number,
  hinted = false,
): Progress {
  const old = previous ?? {
    stage: -1,
    dueAt: 0,
    lastReviewedAt: 0,
    reviews: 0,
    lapses: 0,
    suspended: false,
  };
  const failed = rating === "forgot" || hinted;
  const stage =
    rating === "easy"
      ? old.stage
      : failed
        ? 0
        : Math.min(
            old.reviews > 0 && localDay(old.lastReviewedAt) === localDay(now)
              ? Math.max(0, old.stage)
              : old.stage + 1,
            INTERVALS.length - 1,
          );
  const due = new Date(now);
  due.setDate(due.getDate() + REVIEW_DAYS[Math.max(0, stage)]);
  due.setHours(0, 0, 0, 0);
  return {
    stage,
    dueAt: rating === "easy" ? 0 : due.getTime(),
    lastReviewedAt: now,
    reviews: old.reviews + 1,
    lapses: old.lapses + (failed ? 1 : 0),
    suspended: rating === "easy",
  };
}

export function localDay(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildQueue(
  entries: Entry[],
  data: StudyData,
  kind: EntryKind | "all",
  now: number,
  extra = false,
): string[] {
  const pool = visibleEntries(entries, data).filter(
    (e) => kind === "all" || e.kind === kind,
  );
  const today = localDay(now);
  const activeIds = new Set(visibleEntries(entries, data).map((e) => e.id));
  const todayEvents = data.events.filter(
    (e) => localDay(e.at) === today && !e.practice && activeIds.has(e.entryId),
  );
  const reviewed = new Set(
    todayEvents.filter((e) => !e.isNew).map((e) => e.entryId),
  ).size;
  const due = pool
    .filter(
      (e) =>
        data.progress[e.id] &&
        !data.progress[e.id].suspended &&
        data.progress[e.id].dueAt <= now &&
        localDay(data.progress[e.id].lastReviewedAt) !== today,
    )
    .sort((a, b) => data.progress[a.id].dueAt - data.progress[b.id].dueAt);
  const learnedToday = new Set(
    todayEvents.filter((e) => e.isNew).map((e) => e.entryId),
  ).size;
  const newEntries = pool.filter((e) => !data.progress[e.id]);
  const balance = (items: Entry[]) => {
    if (kind !== "all") return items;
    const words = items.filter((e) => e.kind === "word"),
      phrases = items.filter((e) => e.kind === "phrase");
    const result: Entry[] = [];
    // Keep each type's original order while making both types reachable today.
    for (let i = 0; i < Math.max(words.length, phrases.length); i++) {
      if (words[i]) result.push(words[i]);
      if (phrases[i]) result.push(phrases[i]);
    }
    return result;
  };
  return [
    ...balance(due).slice(
      0,
      Math.max(
        0,
        (data.reviewGoal ?? data.dailyGoal * 3) - (extra ? 0 : reviewed),
      ),
    ),
    ...balance(newEntries).slice(
      0,
      Math.max(0, data.dailyGoal - (extra ? 0 : learnedToday)),
    ),
  ].map((e) => e.id);
}

export function nextDueLabel(progress: Progress | undefined, now: number) {
  if (!progress) return "未学习";
  if (progress.suspended) return "已标记太简单";
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const days = Math.round((progress.dueAt - date.getTime()) / 86400_000);
  if (days <= 0)
    return localDay(progress.lastReviewedAt) === localDay(now)
      ? "明天继续复习"
      : "今日待复习";
  return days === 1 ? "明天复习" : `${days} 天后复习`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const safeId = (v: unknown) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
export function parseBackup(value: unknown): StudyData {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.customEntries) ||
    value.customEntries.length > 5000 ||
    !isRecord(value.progress) ||
    !isRecord(value.notes) ||
    !isRecord(value.activeSeconds) ||
    !Array.isArray(value.favorites) ||
    !Array.isArray(value.events) ||
    value.events.length > 100000
  )
    throw new Error("这不是有效的百万背单词备份文件");
  if (
    value.deletedEntries !== undefined &&
    (!isRecord(value.deletedEntries) ||
      Object.keys(value.deletedEntries).length > 10000 ||
      Object.entries(value.deletedEntries).some(
        ([id, deleted]) => !safeId(id) || typeof deleted !== "boolean",
      ))
  )
    throw new Error("备份中的删除记录无效");
  if (
    !Number.isInteger(value.dailyGoal) ||
    Number(value.dailyGoal) < 1 ||
    Number(value.dailyGoal) > 200
  )
    throw new Error("备份中的每日学习目标无效");
  if (
    (value.reviewGoal !== undefined &&
      (!Number.isInteger(value.reviewGoal) ||
        Number(value.reviewGoal) < 0 ||
        Number(value.reviewGoal) > 1000)) ||
    (value.catalogVersion !== undefined &&
      (typeof value.catalogVersion !== "string" ||
        value.catalogVersion.length > 100)) ||
    (value.library !== undefined &&
      (!Array.isArray(value.library) || value.library.length > 5000)) ||
    (value.settingsUpdatedAt !== undefined &&
      (!finite(value.settingsUpdatedAt) ||
        Number(value.settingsUpdatedAt) < 0)) ||
    (value.voiceURI !== undefined &&
      (typeof value.voiceURI !== "string" || value.voiceURI.length > 500)) ||
    (value.autoSpeak !== undefined && typeof value.autoSpeak !== "boolean")
  )
    throw new Error("备份中的词库或任务设置无效");
  if (
    value.sessionSlots !== undefined &&
    (!isRecord(value.sessionSlots) ||
      Object.entries(value.sessionSlots).some(
        ([kind, s]) =>
          !["all", "word", "phrase"].includes(kind) ||
          !isRecord(s) ||
          s.kind !== kind,
      ))
  )
    throw new Error("备份中的分类型学习记录无效");
  const sessions = [
    value.session,
    ...Object.values((value.sessionSlots ?? {}) as Record<string, unknown>),
  ].filter((s) => s !== undefined && s !== null);
  for (const s of sessions) {
    if (
      !isRecord(s) ||
      !safeId(s.id) ||
      typeof s.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.day) ||
      !["word", "phrase", "all"].includes(String(s.kind)) ||
      ![s.round, s.pending, s.everMissed].every(
        (a) =>
          Array.isArray(a) &&
          a.length <= 5000 &&
          a.every(safeId) &&
          new Set(a).size === a.length,
      ) ||
      !Number.isInteger(s.index) ||
      Number(s.index) < 0 ||
      Number(s.index) > (s.round as unknown[]).length ||
      !isRecord(s.results) ||
      Object.entries(s.results).some(
        ([id, known]) => !safeId(id) || typeof known !== "boolean",
      ) ||
      typeof s.extra !== "boolean" ||
      !finite(s.updatedAt) ||
      Number(s.updatedAt) < 0
    )
      throw new Error("备份中的学习分组无效");
  }
  const ids = new Set<string>();
  for (const [entry, custom] of [
    ...value.customEntries.map((entry) => [entry, true] as const),
    ...((value.library ?? []) as unknown[]).map(
      (entry) => [entry, false] as const,
    ),
  ]) {
    if (
      !isRecord(entry) ||
      !safeId(entry.id) ||
      (custom && !String(entry.id).startsWith("custom-")) ||
      ids.has(String(entry.id)) ||
      !["word", "phrase"].includes(String(entry.kind)) ||
      ![
        "term",
        "phonetic",
        "part",
        "meaning",
        "example",
        "translation",
        "context",
        "contextTranslation",
      ].every(
        (k) => typeof entry[k] === "string" && String(entry[k]).length <= 5000,
      ) ||
      !String(entry.term).trim() ||
      !String(entry.meaning).trim() ||
      !Array.isArray(entry.related) ||
      (entry.source !== undefined &&
        (typeof entry.source !== "string" || entry.source.length > 500)) ||
      entry.related.some(
        (r) =>
          !isRecord(r) ||
          typeof r.term !== "string" ||
          typeof r.meaning !== "string",
      )
    )
      throw new Error("备份中的词条格式无效");
    ids.add(String(entry.id));
  }
  for (const [id, p] of Object.entries(value.progress)) {
    if (
      !safeId(id) ||
      !isRecord(p) ||
      !Number.isInteger(p.stage) ||
      Number(p.stage) < -1 ||
      Number(p.stage) >= INTERVALS.length ||
      !["dueAt", "lastReviewedAt", "reviews", "lapses"].every(
        (k) => finite(p[k]) && Number(p[k]) >= 0,
      ) ||
      typeof p.suspended !== "boolean"
    )
      throw new Error("备份中的复习记录无效");
  }
  if (
    Object.entries(value.notes).some(
      ([id, note]) =>
        !safeId(id) || typeof note !== "string" || note.length > 10000,
    ) ||
    value.favorites.some((id) => !safeId(id))
  )
    throw new Error("备份中的笔记或收藏无效");
  const eventIds = new Set<string>();
  for (const event of value.events) {
    if (
      !isRecord(event) ||
      !safeId(event.id) ||
      eventIds.has(String(event.id)) ||
      !safeId(event.entryId) ||
      !finite(event.at) ||
      Number(event.at) < 0 ||
      !["known", "forgot", "easy"].includes(String(event.rating)) ||
      typeof event.isNew !== "boolean" ||
      typeof event.hinted !== "boolean" ||
      (event.practice !== undefined && typeof event.practice !== "boolean")
    )
      throw new Error("备份中的学习事件无效");
    eventIds.add(String(event.id));
  }
  if (
    Object.entries(value.activeSeconds).some(
      ([day, seconds]) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !finite(seconds) ||
        Number(seconds) < 0,
    )
  )
    throw new Error("备份中的学习时长无效");
  return applyEntryDeletions(value as StudyData);
}
