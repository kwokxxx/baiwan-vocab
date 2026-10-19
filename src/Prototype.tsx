import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  BookOpenIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  SpeakerHighIcon,
  StarIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import "@fontsource/barlow-condensed/600.css";
import {
  BottomSheet,
  Carousel,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
  useScreenPortal,
} from "./mobile";
import { StudyStore } from "./cloud";
import {
  createSession,
  selectSession,
  rememberSession,
  reconcileSession,
  taskQueue,
  answerSession,
  advanceSession,
  missedInRound,
  sessionFinished,
  calendarDays,
  estimatedFinish,
} from "./session";
import { cloudBackup, newBackupCode } from "./backup";
import { chooseVoice, playStudyAudio } from "./speech";
import { withBundledExamples } from "./catalog";
import { UpdateChecker, recoveryUrl } from "./updates";
import {
  withDeadline,
  RequestCancelledError,
  RequestTimeoutError,
  browserRequest,
} from "./network";
import { version as APP_VERSION } from "../package.json";
import { useRuntimeMode } from "./mobile/RuntimeMode";
import {
  buildQueue,
  createId,
  INTERVAL_LABELS,
  localDay,
  nextDueLabel,
  parseBackup,
  removeEntry,
  restoreEntry,
  visibleEntries,
  scheduleReview,
  type Entry,
  type EntryKind,
  type ReviewEvent,
  type StudyData,
  type DeletedEntryBackup,
} from "./study";

type Screen = "study" | "home" | "library" | "profile" | "plan" | "complete";
type Sheet =
  | "plan"
  | "menu"
  | "note"
  | "add"
  | "import"
  | "install"
  | "auth"
  | "backup"
  | "voice"
  | null;
function Highlight({ text, entry }: { text: string; entry: Entry }) {
  const tokens =
    entry.kind === "word"
      ? [
          entry.term,
          entry.term + "d",
          entry.term.endsWith("e")
            ? entry.term.slice(0, -1) + "ing"
            : entry.term + "ing",
        ]
      : [entry.term];
  const escaped = tokens
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return (
    <>
      {text
        .split(new RegExp(`(\\b(?:${escaped.join("|")})\\b)`, "gi"))
        .map((part, i) =>
          tokens.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
            <strong className="highlight-word" key={i}>
              {part}
            </strong>
          ) : (
            part
          ),
        )}
    </>
  );
}
const initialDraft = {
  term: "",
  meaning: "",
  phonetic: "",
  example: "",
  translation: "",
  kind: "phrase" as EntryKind,
};

export default function Prototype() {
  useEffect(() => {
    if (window.location.pathname !== "/api/update") return;
    const current = new URL(window.location.href);
    const destination = new URL("/", current.origin);
    const mode = current.searchParams.get("mode");
    if (mode === "phone" || mode === "preview")
      destination.searchParams.set("mode", mode);
    // Keep the freshly loaded document, but restore the offline-capable app URL.
    window.history.replaceState(window.history.state, "", destination.href);
  }, []);
  const [store] = useState(
    () =>
      new StudyStore(
        localStorage,
        browserRequest,
        window.location.protocol !== "file:",
      ),
  );
  const cloud = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const data = cloud.data;
  const dataRef = useRef(data);
  dataRef.current = data;
  const storageError = cloud.storageError;
  const [screen, setScreen] = useState<Screen>("home");
  const [kind, setKind] = useState<EntryKind | "all">("all");
  const entries = useMemo(
    () =>
      visibleEntries(
        [
          ...withBundledExamples(data.library ?? cloud.library),
          ...data.customEntries,
        ],
        data,
      ),
    [cloud.library, data.library, data.customEntries, data.deletedEntries],
  );
  const [deletedUndo, setDeletedUndo] = useState<{
    backup: DeletedEntryBackup;
    account: string;
  } | null>(null);
  useEffect(() => {
    if (!deletedUndo) return;
    const timer = setTimeout(() => setDeletedUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [deletedUndo]);
  const session = data.session;
  const queue = session?.round ?? [];
  const index = session?.index ?? 0;
  const [authMode, setAuthMode] = useState<
    "login" | "register" | "manage" | "password"
  >("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [importLocal, setImportLocal] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  useEffect(() => store.start(), [store]);
  const [planReturn, setPlanReturn] = useState<Screen>("home");
  const [newGoal, setNewGoal] = useState(data.dailyGoal);
  const [reviewGoal, setReviewGoal] = useState(
    data.reviewGoal ?? data.dailyGoal * 3,
  );
  const [summaryMasked, setSummaryMasked] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState(localDay(Date.now()));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingText, setSpeakingText] = useState("");
  const speechSequence = useRef(0);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [restoreCode, setRestoreCode] = useState("");
  const [backupRevision, setBackupRevision] = useState(0);
  const [cloudPreview, setCloudPreview] = useState<StudyData | null>(null);
  const backupKey = `shici-anonymous-backup-v1:${cloud.user?.id ?? "guest"}`;
  const backupOwner = useRef(backupKey);
  backupOwner.current = backupKey;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(backupKey) ?? "null");
      setBackupCode(stored?.code ?? "");
      setBackupRevision(stored?.revision ?? 0);
      setBackupMessage(
        stored?.at
          ? `上次备份：${new Date(stored.at).toLocaleString("zh-CN")}`
          : "",
      );
    } catch {
      setBackupCode("");
      setBackupRevision(0);
    }
    setCloudPreview(null);
    setRestoreCode("");
  }, [backupKey]);
  const [phase, setPhase] = useState<"recall" | "detail">("recall");
  const [hinted, setHinted] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [rating, setRating] = useState<ReviewEvent["rating"]>("known");
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "word" | "phrase" | "favorite">(
    "all",
  );
  const [detailTab, setDetailTab] = useState<"meaning" | "related">("meaning");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateChecker] = useState(
    () =>
      new UpdateChecker({
        version: APP_VERSION,
        buildId:
          document
            .querySelector('meta[name="shici-build"]')
            ?.getAttribute("content") ?? null,
      }),
  );
  const updateState = useSyncExternalStore(
    updateChecker.subscribe,
    updateChecker.getSnapshot,
  );
  const updateAvailable = updateState.available;
  const checkingUpdate = updateState.checking;
  const workerUpdateRef = useRef<Promise<void> | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionReport, setConnectionReport] = useState("");
  const connectionCheckRef = useRef<AbortController | null>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const [importDraft, setImportDraft] = useState<StudyData | null>(null);
  const [formError, setFormError] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const importRef = useRef<HTMLInputElement>(null);
  const commitLock = useRef(false);
  const lastActivity = useRef(Date.now());
  const keyboard = useKeyboard();
  const runtime = useRuntimeMode();
  const { screenRef } = useScreenPortal();
  useEffect(() => {
    if (runtime.native) return;
    // A focused control can make the browser scroll an overflow-hidden parent.
    // Only the app's MobileScroll regions should move, never device chrome.
    const screenElement = screenRef.current;
    if (!screenElement) return;
    const keepScreenStill = () => {
      screenElement.scrollTop = 0;
      screenElement.scrollLeft = 0;
    };
    keepScreenStill();
    screenElement.addEventListener("scroll", keepScreenStill);
    return () => screenElement.removeEventListener("scroll", keepScreenStill);
  }, [screenRef, runtime.native]);
  const current = entries.find((e) => e.id === (browseId ?? queue[index]));
  useEffect(() => {
    if (
      screen !== "study" ||
      browseId ||
      !session ||
      session.index >= session.round.length
    )
      return;
    if (entries.some((e) => e.id === session.round[session.index])) return;
    const next = {
      ...session,
      index: session.index + 1,
      updatedAt: Date.now(),
    };
    save({ ...dataRef.current, session: next });
  }, [entries, session, screen, browseId]);
  const today = localDay(now);
  const todayEvents = data.events.filter(
    (e) =>
      localDay(e.at) === today &&
      !e.practice &&
      entries.some((entry) => entry.id === e.entryId),
  );
  const learnedToday = new Set(
    todayEvents.filter((e) => e.isNew).map((e) => e.entryId),
  ).size;
  const reviewedIds = todayEvents.filter((e) => !e.isNew).map((e) => e.entryId);
  const reviewedToday = new Set(reviewedIds).size;
  const due = entries.filter(
    (e) =>
      data.progress[e.id] &&
      !data.progress[e.id].suspended &&
      data.progress[e.id].dueAt <= now &&
      localDay(data.progress[e.id].lastReviewedAt) !== today,
  );
  const unseen = entries.filter((e) => !data.progress[e.id]);
  const dailyRemaining = taskQueue(entries, data, "all", now).length;
  const nextReview = Object.values(data.progress)
    .filter((p) => !p.suspended && p.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt)[0];
  const seconds = data.activeSeconds[today] ?? 0;
  const isDetail = phase === "detail" || !!browseId;

  function save(next: StudyData) {
    store.save(rememberSession(next));
    dataRef.current = store.getSnapshot().data;
  }
  function deleteFromLibrary(entry: Entry) {
    keyboard.hide();
    if (storageError) return setToast("本地记录暂时无法保存，请先导出备份");
    const deleted = removeEntry(dataRef.current, entry);
    save(deleted.data);
    setToast("");
    setDeletedUndo({
      backup: deleted.backup,
      account: cloud.user?.id ?? "guest",
    });
  }
  function undoDelete() {
    if (!deletedUndo || deletedUndo.account !== (cloud.user?.id ?? "guest"))
      return;
    save(restoreEntry(dataRef.current, deletedUndo.backup));
    setDeletedUndo(null);
    setToast("词条已恢复");
  }
  const syncLabel =
    cloud.status === "syncing"
      ? "正在同步"
      : cloud.status === "synced"
        ? "已同步到云端"
        : cloud.user
          ? "记录已在本机，等待同步"
          : "登录后可跨设备同步";
  function openAccount() {
    setAuthMode(cloud.user ? "manage" : "login");
    setAuthEmail(cloud.user?.email ?? "");
    setAuthError("");
    setAuthPassword("");
    setNewPassword("");
    openSheet("auth");
  }
  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    keyboard.hide();
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "password") {
        await store.changePassword(authPassword, newPassword);
        setAuthMode("manage");
        setToast("密码已更新，其他设备需重新登录");
      } else if (authMode === "login" || authMode === "register") {
        await store.authenticate(
          authMode,
          authEmail,
          authPassword,
          authName,
          importLocal,
        );
        navigate("profile");
        setToast("登录成功，学习记录将自动同步");
      }
      setAuthPassword("");
      setNewPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "暂时无法登录";
      setAuthError(
        /invalid email or password|invalid password/i.test(message)
          ? "邮箱或密码不正确"
          : /already exists|already registered/i.test(message)
            ? "这个邮箱已注册，请直接登录"
            : /fetch|network|timeout/i.test(message)
              ? "网络连接失败，请稍后再试"
              : message,
      );
    } finally {
      setAuthBusy(false);
    }
  }
  function openSheet(next: Sheet) {
    keyboard.hide();
    if (next === "plan") {
      setNewGoal(dataRef.current.dailyGoal);
      setReviewGoal(
        dataRef.current.reviewGoal ?? dataRef.current.dailyGoal * 3,
      );
      setPlanReturn(screen);
      setScreen("plan");
      setSheet(null);
      return;
    }
    setSheet(next);
  }
  function navigate(next: Screen) {
    keyboard.hide();
    stopSpeech();
    setBrowseId(null);
    setSheet(null);
    setScreen(next);
  }
  function openAddEntry(
    nextKind: EntryKind = filter === "word" ? "word" : "phrase",
  ) {
    setFormError("");
    setDraft({ ...initialDraft, kind: nextKind });
    openSheet("add");
  }
  function startLearning(nextKind: EntryKind | "all" = "all", extra = false) {
    keyboard.hide();
    if (nextKind !== "all" && !entries.some((e) => e.kind === nextKind)) {
      openAddEntry(nextKind);
      setToast(`还没有${nextKind === "word" ? "单词" : "短语"}，先添加一个`);
      return;
    }
    const nextData = selectSession(
      entries,
      dataRef.current,
      nextKind,
      Date.now(),
      extra,
    );
    showSession(nextData);
  }
  function showSession(nextData: StudyData) {
    keyboard.hide();
    const next = nextData.session!;
    save(nextData);
    setKind(next.kind);
    setPhase("recall");
    setHinted(false);
    setHintVisible(false);
    setBrowseId(null);
    setSheet(null);
    setScreen("study");
    setNow(Date.now());
    autoRead(entries.find((e) => e.id === next.round[next.index]));
  }
  function nextGroup() {
    if (!dataRef.current.session) return;
    const next = advanceSession(
      reconcileSession(
        dataRef.current.session,
        entries,
        dataRef.current,
        Date.now(),
      ),
      entries,
      Date.now(),
    );
    save({ ...dataRef.current, session: next });
    setPhase("recall");
    setHinted(false);
    setHintVisible(false);
    autoRead(entries.find((e) => e.id === next.round[0]));
  }
  function favorite(id: string) {
    const old = dataRef.current;
    const exists = old.favorites.includes(id);
    save({
      ...old,
      favorites: exists
        ? old.favorites.filter((f) => f !== id)
        : [...old.favorites, id],
    });
    setToast(exists ? "已取消收藏" : "已加入收藏");
  }
  function reveal(value: ReviewEvent["rating"]) {
    if (!current || browseId || phase === "detail") return;
    setRating(value);
    setPhase("detail");
    setDetailTab("meaning");
    autoRead(current, "detail");
  }
  function toggleHint() {
    setHintVisible((visible) => !visible);
    // Hiding a hint must not erase the fact that this answer was assisted.
    setHinted(true);
  }
  function commit(value: ReviewEvent["rating"] = rating) {
    if (!current || browseId || commitLock.current) return;
    commitLock.current = true;
    const at = Date.now(),
      old = dataRef.current;
    const progress = scheduleReview(
      old.progress[current.id],
      value,
      at,
      hinted,
    );
    const event: ReviewEvent = {
      id: createId(),
      entryId: current.id,
      at,
      rating: value,
      isNew: !old.progress[current.id],
      hinted,
      practice:
        !!old.progress[current.id] &&
        localDay(old.progress[current.id].lastReviewedAt) === localDay(at),
    };
    const nextSession = old.session
      ? answerSession(
          old.session,
          current.id,
          value === "easy" || (value === "known" && !hinted),
          at,
        )
      : null;
    save({
      ...old,
      progress: { ...old.progress, [current.id]: progress },
      events: [...old.events, event],
      session: nextSession,
    });
    autoRead(
      entries.find((e) => e.id === nextSession?.round[nextSession.index]),
    );
    setPhase("recall");
    setHinted(false);
    setHintVisible(false);
    setNow(at);
    setTimeout(() => {
      commitLock.current = false;
    }, 250);
    if (value === "easy") setToast("已暂停该词复习，可在词库中恢复");
  }
  function stopSpeech() {
    speechSequence.current++;
    setSpeakingText("");
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  function autoRead(
    entry: Entry | undefined,
    phase: "recall" | "detail" = "recall",
  ) {
    playStudyAudio(entry, phase, dataRef.current.autoSpeak, speak, stopSpeech);
  }
  function speak(text: string) {
    if (!("speechSynthesis" in window)) return setToast("当前浏览器不支持朗读");
    stopSpeech();
    const voice = chooseVoice(
      speechSynthesis.getVoices(),
      dataRef.current.voiceURI,
    );
    if (!voice)
      return setToast(
        "未找到英语女声，请在朗读设置中选择语音，或在 iPhone 设置中下载 Samantha 英语语音",
      );
    const sequence = speechSequence.current;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.88;
    u.pitch = 1;
    u.onstart = () => {
      if (sequence === speechSequence.current) setSpeakingText(text);
    };
    u.onend = () => {
      if (sequence === speechSequence.current) setSpeakingText("");
    };
    u.onerror = (e) => {
      if (sequence !== speechSequence.current) return;
      setSpeakingText("");
      if (!["canceled", "interrupted"].includes(e.error))
        setToast("朗读未能播放，请点喇叭重试");
    };
    speechSynthesis.speak(u);
  }
  function downloadSnapshot(raw: string, name: string) {
    const url = URL.createObjectURL(
      new Blob([raw], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function uploadBackup(fresh = false) {
    if (backupBusy) return;
    const ownerKey = backupKey;
    const code = fresh || !backupCode ? newBackupCode() : backupCode;
    const revision = fresh ? 0 : backupRevision;
    setBackupCode(code);
    setBackupRevision(revision);
    setBackupBusy(true);
    setBackupMessage("正在上传完整学习备份…");
    try {
      localStorage.setItem(ownerKey, JSON.stringify({ code, revision }));
      const result = await cloudBackup(code, store.fullSnapshot(), revision);
      localStorage.setItem(
        ownerKey,
        JSON.stringify({
          code,
          revision: result.revision,
          at: result.updatedAt,
        }),
      );
      if (backupOwner.current !== ownerKey) return;
      setBackupRevision(result.revision);
      setBackupMessage(
        `备份成功：${new Date(result.updatedAt).toLocaleString("zh-CN")}。请保存恢复码。`,
      );
    } catch (e) {
      setBackupMessage(
        e instanceof Error ? e.message : "备份失败，本地记录仍保留",
      );
    } finally {
      setBackupBusy(false);
    }
  }
  async function previewBackup(code = restoreCode) {
    if (backupBusy) return;
    const ownerKey = backupKey;
    keyboard.hide();
    setBackupBusy(true);
    setCloudPreview(null);
    try {
      const result = await cloudBackup(code.trim());
      if (backupOwner.current !== ownerKey) return;
      if (code.trim() === backupCode) {
        setBackupRevision(result.revision);
        localStorage.setItem(
          ownerKey,
          JSON.stringify({
            code: backupCode,
            revision: result.revision,
            at: result.updatedAt,
          }),
        );
      }
      setCloudPreview(result.snapshot!);
      setBackupMessage(
        `云端备份时间：${new Date(result.updatedAt).toLocaleString("zh-CN")}`,
      );
    } catch (e) {
      setBackupMessage(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBackupBusy(false);
    }
  }
  function exportBackup() {
    const raw = store.exportText();
    const url = URL.createObjectURL(
      new Blob([raw], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `百万背单词备份-${localDay(Date.now())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("备份已导出，包含词条、笔记和学习记录");
  }
  async function readImport(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setToast("文件不能超过 10 MB");
    try {
      setImportDraft(parseBackup(JSON.parse(await file.text())));
      openSheet("import");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法读取备份");
    }
    if (importRef.current) importRef.current.value = "";
  }
  function addEntry(event: FormEvent) {
    event.preventDefault();
    const term = draft.term.trim().replace(/\s+/g, " ");
    if (!term || !draft.meaning.trim())
      return setFormError("请填写英文和中文释义");
    if (
      entries.some(
        (e) =>
          e.kind === draft.kind && e.term.toLowerCase() === term.toLowerCase(),
      )
    )
      return setFormError("词库里已经有这个词条了");
    const entry: Entry = {
      id: `custom-${createId()}`,
      kind: draft.kind,
      term,
      phonetic: draft.phonetic.trim(),
      part: draft.kind === "phrase" ? "phr." : "",
      meaning: draft.meaning.trim(),
      example: draft.example.trim(),
      translation: draft.translation.trim(),
      context: "",
      contextTranslation: "",
      related: [],
    };
    const nextData = {
      ...dataRef.current,
      customEntries: [...dataRef.current.customEntries, entry],
    };
    if (
      nextData.session?.day === localDay(Date.now()) &&
      !nextData.session.extra
    )
      nextData.session = reconcileSession(
        nextData.session,
        [...entries, entry],
        nextData,
        Date.now(),
      );
    save(nextData);
    setDraft(initialDraft);
    setFilter(entry.kind);
    setQuery("");
    navigate("library");
    setToast("已加入词库，可以开始学习了");
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (screen !== "study" || !current || browseId) return;
    let last = Date.now();
    const t = setInterval(() => {
      const at = Date.now(),
        delta = Math.min(5, Math.floor((at - last) / 1000));
      last = at;
      if (
        document.visibilityState !== "visible" ||
        delta < 1 ||
        at - lastActivity.current > 60_000
      )
        return;
      const old = dataRef.current,
        day = localDay(at);
      save({
        ...old,
        activeSeconds: {
          ...old.activeSeconds,
          [day]: (old.activeSeconds[day] ?? 0) + delta,
        },
      });
    }, 1000);
    return () => clearInterval(t);
  }, [screen, !!current, browseId]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refresh = () =>
      setVoices(
        speechSynthesis
          .getVoices()
          .filter((v) => /^en(?:[-_]|$)/i.test(v.lang)),
      );
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      speechSynthesis.cancel();
      speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, []);
  function requestWorkerUpdate() {
    const registration = serviceWorkerRef.current;
    if (!registration || workerUpdateRef.current) return;
    const task = withDeadline(() => registration.update(), 8000).then(
      () => {},
      () => {},
    );
    workerUpdateRef.current = task;
    void task.finally(() => {
      if (workerUpdateRef.current === task) workerUpdateRef.current = null;
    });
  }
  useEffect(() => {
    if (window.location.protocol === "file:") {
      setOfflineReady(true);
      return;
    }
    if (!window.isSecureContext || !import.meta.env.PROD) return;
    let active = true,
      lastCheck = 0;
    const cleanup: (() => void)[] = [];
    const checkWhenVisible = () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        Date.now() - lastCheck < 60_000
      )
        return;
      lastCheck = Date.now();
      void updateChecker.check({ silent: true });
      requestWorkerUpdate();
    };
    const onControllerChange = () => {
      if (!active) return;
      setOfflineReady(true);
      void updateChecker.check({ silent: true });
    };
    const observe = (registration: ServiceWorkerRegistration) => {
      if (!active) return;
      serviceWorkerRef.current = registration;
      if (registration.active?.state === "activated") setOfflineReady(true);
      const watch = () => {
        const worker = registration.installing;
        if (!worker) return;
        const changed = () => {
          if (active && worker.state === "activated") onControllerChange();
        };
        worker.addEventListener("statechange", changed);
        cleanup.push(() => worker.removeEventListener("statechange", changed));
      };
      registration.addEventListener("updatefound", watch);
      cleanup.push(() =>
        registration.removeEventListener("updatefound", watch),
      );
      watch();
      requestWorkerUpdate();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
      );
      cleanup.push(() =>
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onControllerChange,
        ),
      );
      void withDeadline(
        () => navigator.serviceWorker.getRegistration("/"),
        8000,
      )
        .then(
          async (registration) =>
            registration ??
            (await withDeadline(
              () =>
                navigator.serviceWorker.register("/sw.js", {
                  updateViaCache: "none",
                }),
              8000,
            )),
        )
        .then(observe)
        .catch(() => {
          if (active) setToast("离线资源暂未准备好，联网后重新打开可重试");
        });
    }
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    checkWhenVisible();
    return () => {
      active = false;
      cleanup.forEach((dispose) => dispose());
      updateChecker.cancel();
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
    };
  }, [updateChecker]);
  useEffect(() => {
    setConnectionReport("");
    setCheckingConnection(false);
    connectionCheckRef.current?.abort();
    connectionCheckRef.current = null;
    return () => {
      connectionCheckRef.current?.abort();
    };
  }, [cloud.user?.id]);
  async function checkForUpdates() {
    if (checkingUpdate) {
      updateChecker.cancel();
      return;
    }
    if (window.location.protocol === "file:")
      return setToast("请在 HTTPS 网页版中检查更新");
    if (!navigator.onLine) return setToast("当前处于离线状态，请联网后重试");
    requestWorkerUpdate();
    await updateChecker.check();
  }
  async function checkCloudConnection() {
    if (connectionCheckRef.current) {
      connectionCheckRef.current.abort();
      connectionCheckRef.current = null;
      setCheckingConnection(false);
      setConnectionReport("已取消连接检查");
      return;
    }
    const controller = new AbortController();
    connectionCheckRef.current = controller;
    setCheckingConnection(true);
    setConnectionReport("正在检查服务器、数据库和登录状态…");
    try {
      const report = await store.checkConnection(controller.signal);
      if (connectionCheckRef.current === controller)
        setConnectionReport(
          `检查时间 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}：${report}`,
        );
    } catch (error) {
      if (
        connectionCheckRef.current !== controller ||
        error instanceof RequestCancelledError
      )
        return;
      setConnectionReport(
        error instanceof RequestTimeoutError
          ? "连接检查超时。记录已保存在本机，可以稍后重试。"
          : "接口返回异常，请重新加载应用后重试。记录已保留。",
      );
    } finally {
      if (connectionCheckRef.current === controller) {
        connectionCheckRef.current = null;
        setCheckingConnection(false);
      }
    }
  }
  function applyUpdate() {
    if (!store.persistForReload())
      return setToast("请先导出当前记录，再更新应用");
    if (!navigator.onLine) return setToast("请联网后更新，当前记录已保留");
    window.location.assign(recoveryUrl(window.location.href));
  }
  const icon = (
    label: string,
    content: ReactNode,
    action: () => void,
    cls = "",
  ) => (
    <button
      type="button"
      className={`icon-button ${cls}`}
      aria-label={label}
      title={label}
      onClick={action}
    >
      {content}
    </button>
  );
  const filtered = entries.filter(
    (e) =>
      (filter === "all" ||
        (filter === "favorite"
          ? data.favorites.includes(e.id)
          : e.kind === filter)) &&
      `${e.term} ${e.meaning}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const planned = current
    ? scheduleReview(data.progress[current.id], rating, now, hinted)
    : undefined;

  return (
    <div
      className="vocab-app"
      data-hint-open={hintVisible ? "true" : "false"}
      data-summary={screen === "study" && !current ? "true" : "false"}
      onPointerDownCapture={() => {
        lastActivity.current = Date.now();
      }}
      onKeyDownCapture={() => {
        lastActivity.current = Date.now();
      }}
    >
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="file-input"
        aria-label="选择备份文件"
        onChange={(e) => void readImport(e.target.files?.[0])}
      />
      {storageError && (
        <div className="storage-warning" role="alert">
          {storageError}
        </div>
      )}
      {screen === "complete" ? (
        <>
          <MobileScroll className="celebration-scroll">
            <div className="celebration-content">
              <p className="eyebrow">今天，也有认真记住</p>
              <img
                src="/assets/app/baiwan-celebration-v1.png"
                alt="金渐层猫猫举起爪子夸你真棒"
                width={218}
                height={218}
                draggable={false}
              />
              <h1>你真棒！</h1>
              <h2>
                {session?.extra ? "加练的一组也完成啦" : "今天的任务完成啦"}
              </h2>
              <p>
                把每一点坚持，变成明天的进步。
                <br />
                猫猫已经把你的努力记在日历上了。
              </p>
              <div className="celebration-stats">
                <span>
                  <strong>{learnedToday}</strong> 个新词
                </span>
                <span>
                  <strong>{reviewedToday}</strong> 个复习
                </span>
              </div>
            </div>
          </MobileScroll>
          <footer className="task-footer">
            <button className="primary-button" onClick={() => navigate("home")}>
              完成
            </button>
          </footer>
        </>
      ) : screen === "plan" ? (
        <>
          <header className="study-toolbar task-toolbar">
            {icon("返回", <ArrowLeftIcon size={24} />, () =>
              navigate(planReturn),
            )}
            <h1>设置任务量</h1>
            <span />
          </header>
          <MobileScroll className="task-scroll">
            <section className="task-library-card">
              <img
                src="/assets/app/baiwan-cat-192-v1.png"
                alt="百万背单词"
                width={78}
                height={92}
              />
              <div>
                <h2>单词与短语词库</h2>
                <p>每日任务混合学习，单词与短语都安排</p>
                <strong>
                  {entries.filter((e) => e.kind === "word").length} 个单词 ·{" "}
                  {entries.filter((e) => e.kind === "phrase").length} 个短语
                </strong>
              </div>
            </section>
            <section className="task-card">
              <h2>每日学习任务量</h2>
              <p>新词与复习额度由单词、短语共同使用；巩固不额外占名额</p>
              <div className="task-controls">
                <label>
                  学习新词
                  <select
                    aria-label="每日新词数量"
                    value={newGoal}
                    onChange={(e) => setNewGoal(Number(e.target.value))}
                  >
                    {Array.from(
                      new Set([
                        1,
                        3,
                        5,
                        7,
                        10,
                        15,
                        20,
                        25,
                        30,
                        40,
                        50,
                        100,
                        200,
                        newGoal,
                      ]),
                    )
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n} 个
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  复习旧词
                  <select
                    aria-label="每日复习数量"
                    value={reviewGoal}
                    onChange={(e) => setReviewGoal(Number(e.target.value))}
                  >
                    {Array.from(
                      new Set([
                        0,
                        1,
                        3,
                        5,
                        7,
                        10,
                        15,
                        20,
                        30,
                        45,
                        60,
                        75,
                        100,
                        150,
                        200,
                        reviewGoal,
                      ]),
                    )
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n} 个
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="task-estimate">
                新词预计学完{" "}
                <strong>
                  {estimatedFinish(
                    unseen.length,
                    learnedToday,
                    newGoal,
                    now,
                  ).date.toLocaleDateString("zh-CN")}
                </strong>
              </div>
              <div
                className="task-presets"
                role="group"
                aria-label="常用任务量"
              >
                {[5, 10, 15, 20, 25].map((n) => (
                  <button
                    key={n}
                    className={
                      newGoal === n && reviewGoal === n * 3 ? "selected" : ""
                    }
                    aria-pressed={newGoal === n && reviewGoal === n * 3}
                    onClick={() => {
                      setNewGoal(n);
                      setReviewGoal(n * 3);
                    }}
                  >
                    <span>
                      新词 <b>{n}</b>
                    </span>
                    <span>
                      复习 <b>{n * 3}</b>
                    </span>
                    <span>
                      约{" "}
                      <b>
                        {
                          estimatedFinish(unseen.length, learnedToday, n, now)
                            .days
                        }
                      </b>{" "}
                      天
                    </span>
                  </button>
                ))}
              </div>
              <p className="plan-note">
                预计天数只计算未学新词，实际复习数量以当天到期词条为准。
              </p>
            </section>
            <p className="task-rules">
              每组最多 7 个。组末先巩固不认识的，再继续当天任务。跨天复习间隔为{" "}
              {INTERVAL_LABELS.join("、")}；不发分钟或小时提醒。
            </p>
          </MobileScroll>
          <footer className="task-footer">
            <button
              className="primary-button"
              onClick={() => {
                const changed = {
                  ...dataRef.current,
                  dailyGoal: newGoal,
                  reviewGoal,
                  settingsUpdatedAt: Date.now(),
                };
                if (changed.session?.day === today && !changed.session.extra)
                  changed.session = reconcileSession(
                    changed.session,
                    entries,
                    changed,
                    Date.now(),
                  );
                save(changed);
                navigate(planReturn);
                setToast("任务量已保存；当前组保留，后续按新设置安排");
              }}
            >
              完成设置
            </button>
          </footer>
        </>
      ) : screen === "study" || browseId ? (
        <>
          <header className="study-toolbar">
            {icon(
              browseId ? "返回词库" : "返回学习首页",
              <ArrowLeftIcon size={24} weight="light" />,
              () => (browseId ? setBrowseId(null) : navigate("home")),
            )}
            <div className="toolbar-actions">
              {icon(
                "复习计划",
                <SparkleIcon size={24} weight="duotone" />,
                () => openSheet("plan"),
                "plan-icon",
              )}
              {icon("搜索词库", <MagnifyingGlassIcon size={25} />, () =>
                navigate("library"),
              )}
              {icon(
                current && data.favorites.includes(current.id)
                  ? "取消收藏"
                  : "收藏词条",
                <StarIcon
                  size={25}
                  weight={
                    current && data.favorites.includes(current.id)
                      ? "fill"
                      : "regular"
                  }
                />,
                () => current && favorite(current.id),
                current && data.favorites.includes(current.id)
                  ? "is-favorite"
                  : "",
              )}
              {icon("更多选项", <DotsThreeIcon size={29} weight="bold" />, () =>
                openSheet("menu"),
              )}
            </div>
          </header>
          {!current ? (
            <>
              <MobileScroll className="summary-scroll">
                <div className="summary-heading">
                  <h1>
                    {kind === "word"
                      ? "单词小结"
                      : kind === "phrase"
                        ? "短语小结"
                        : "学习小结"}
                  </h1>
                  <button
                    className="mask-button"
                    aria-pressed={summaryMasked}
                    onClick={() => setSummaryMasked((v) => !v)}
                  >
                    {summaryMasked ? "显示释义" : "遮挡释义"}
                  </button>
                </div>
                {!queue.length && (
                  <p className="summary-empty">
                    今天的任务已完成。明天继续，也可以手动再学一组。
                  </p>
                )}
                {queue
                  .map((id) => entries.find((e) => e.id === id))
                  .filter((e): e is Entry => !!e)
                  .map((entry) => (
                    <article className="summary-row" key={entry.id}>
                      <div>
                        <strong
                          className={
                            session?.everMissed.includes(entry.id)
                              ? "was-unfamiliar"
                              : ""
                          }
                        >
                          {entry.term}
                        </strong>
                        {icon(
                          `朗读 ${entry.term}`,
                          <SpeakerHighIcon size={22} weight="fill" />,
                          () => speak(entry.term),
                          "audio-button",
                        )}
                      </div>
                      <p>
                        <span>{entry.part}</span>
                        <b>
                          {summaryMasked ? "点击上方显示释义" : entry.meaning}
                        </b>
                      </p>
                    </article>
                  ))}
                <p className="summary-note">
                  橙色为本次学习中标记过不认识或使用提示的词条。
                </p>
              </MobileScroll>
              <footer className="summary-footer">
                <p>
                  {session && missedInRound(session).length
                    ? `下一组先巩固 ${missedInRound(session).length} 个未掌握词条`
                    : session?.pending.length
                      ? `本组已掌握，今日任务还剩 ${session.pending.length} 个`
                      : dailyRemaining
                        ? `今日还有 ${dailyRemaining} 个词条，继续单词与短语任务`
                        : "今日这一轮已完成，下一次按天复习"}
                </p>
                <button
                  className="primary-button"
                  onClick={() =>
                    session && !sessionFinished(session)
                      ? nextGroup()
                      : dailyRemaining
                        ? startLearning("all")
                        : navigate(todayEvents.length ? "complete" : "home")
                  }
                >
                  {session && !sessionFinished(session)
                    ? "下一组"
                    : dailyRemaining
                      ? "继续每日任务"
                      : "完成今日学习"}
                </button>
                {sessionFinished(session) && (
                  <button
                    className="quiet-button"
                    onClick={() => startLearning(kind, true)}
                  >
                    再学一组
                    {kind === "word" ? "单词" : kind === "phrase" ? "短语" : ""}
                  </button>
                )}
              </footer>
            </>
          ) : isDetail ? (
            <>
              <MobileScroll
                key={`detail-${current.id}`}
                className="detail-scroll"
              >
                <article className="word-detail">
                  <div className="detail-heading">
                    <h1
                      className={current.kind === "phrase" ? "is-phrase" : ""}
                      data-unfamiliar={!browseId && rating === "forgot"}
                    >
                      {current.term}
                    </h1>
                    {icon(
                      "朗读词条",
                      <SpeakerHighIcon size={24} weight="fill" />,
                      () => speak(current.term),
                      "audio-button",
                    )}
                  </div>
                  <div className="detail-meta">
                    <p className="detail-phonetic">
                      {current.phonetic ||
                        (current.kind === "word" ? "英语单词" : "英语短语")}
                    </p>
                    {!browseId && rating === "known" && (
                      <div
                        className="detail-actions"
                        role="group"
                        aria-label="调整掌握程度"
                      >
                        <button onClick={() => setRating("forgot")}>
                          <ArrowUUpLeftIcon size={20} />
                          不认识
                        </button>
                        <button onClick={() => commit("easy")}>
                          <TrashIcon size={20} />
                          太简单
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className="dictionary-tabs"
                    role="tablist"
                    aria-label="释义内容"
                  >
                    <button
                      role="tab"
                      aria-selected={detailTab === "meaning"}
                      onClick={() => setDetailTab("meaning")}
                    >
                      核心释义
                    </button>
                    <button
                      role="tab"
                      aria-selected={detailTab === "related"}
                      onClick={() => setDetailTab("related")}
                    >
                      词组搭配
                    </button>
                  </div>
                  {detailTab === "meaning" ? (
                    <>
                      <div className="definition">
                        <span>{current.part}</span>
                        <strong>{current.meaning}</strong>
                      </div>
                      {current.example && (
                        <div className="example">
                          <span className="example-label">[例句]</span>
                          <div>
                            <p className="english-example">
                              <Highlight
                                text={current.example}
                                entry={current}
                              />
                            </p>
                            <p className="chinese-example">
                              {current.translation}
                            </p>
                          </div>
                          {icon(
                            speakingText === current.example
                              ? "正在朗读例句，点击重听"
                              : "朗读例句",
                            <SpeakerHighIcon size={21} weight="fill" />,
                            () => speak(current.example),
                            `audio-button${speakingText === current.example ? " is-playing" : ""}`,
                          )}
                        </div>
                      )}
                      {current.context && (
                        <section className="context-card">
                          <h2>
                            <span>语境例句</span>
                          </h2>
                          <div className="context-meaning">
                            <span>{current.part}</span>
                            <strong>{current.meaning.split("；")[0]}</strong>
                            {icon(
                              "朗读语境例句",
                              <SpeakerHighIcon size={21} weight="fill" />,
                              () => speak(current.context),
                              "audio-button",
                            )}
                          </div>
                          <p className="english-example">
                            <Highlight text={current.context} entry={current} />
                          </p>
                          <p className="chinese-example">
                            {current.contextTranslation}
                          </p>
                          <p className="source-label">
                            来源：百万背单词原创学习例句
                          </p>
                        </section>
                      )}
                    </>
                  ) : (
                    <section className="related-panel">
                      <p className="section-description">
                        把表达放进搭配里，一起记住。
                      </p>
                      {current.related.length ? (
                        current.related.map((r) => (
                          <div className="related-row" key={r.term}>
                            <strong>{r.term}</strong>
                            <span>{r.meaning}</span>
                            {icon(
                              `朗读 ${r.term}`,
                              <SpeakerHighIcon size={21} />,
                              () => speak(r.term),
                              "audio-button",
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="related-row">
                          <strong>{current.term}</strong>
                          <span>{current.meaning}</span>
                          <p className="chinese-example">
                            可以在笔记里补充你常用的搭配。
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                  <button
                    className="note-card"
                    onClick={() => {
                      setNote(data.notes[current.id] ?? "");
                      openSheet("note");
                    }}
                  >
                    <div>
                      <h2>我的笔记</h2>
                      <CaretRightIcon size={18} />
                    </div>
                    <p>
                      {data.notes[current.id] ||
                        "写下你的联想，让记忆更牢一点。"}
                    </p>
                  </button>
                  {browseId && (
                    <div className="schedule-info">
                      <CalendarBlankIcon size={18} />
                      <span>
                        {nextDueLabel(data.progress[current.id], now)}
                      </span>
                    </div>
                  )}
                </article>
              </MobileScroll>
              <footer className="detail-footer">
                {browseId ? (
                  <button
                    className="primary-button"
                    onClick={() => {
                      const old = dataRef.current,
                        p = old.progress[current.id];
                      if (p)
                        save({
                          ...old,
                          progress: {
                            ...old.progress,
                            [current.id]: {
                              ...p,
                              suspended: false,
                              dueAt: Date.now(),
                            },
                          },
                        });
                      const selected = selectSession(
                        entries,
                        dataRef.current,
                        current.kind,
                        Date.now(),
                        true,
                      );
                      showSession({
                        ...selected,
                        session: {
                          ...selected.session!,
                          round: [current.id],
                          pending: [],
                        },
                      });
                    }}
                  >
                    学习这个词条
                  </button>
                ) : (
                  <>
                    <div className="answer-feedback" role="status">
                      <span>
                        {rating === "forgot" || hinted
                          ? "再巩固一下"
                          : "记得不错"}{" "}
                        ·{" "}
                        {rating === "forgot" || hinted
                          ? "本组小结后继续巩固"
                          : planned
                            ? nextDueLabel(planned, now)
                            : ""}
                      </span>
                    </div>
                    <button className="primary-button" onClick={() => commit()}>
                      下一个
                      <ArrowRightIcon size={21} />
                    </button>
                  </>
                )}
              </footer>
            </>
          ) : (
            <>
              <div className="study-stats">
                <div>
                  <span>今日复习</span>
                  <strong>
                    {reviewedToday}
                    <small>
                      /{new Set([...reviewedIds, ...due.map((e) => e.id)]).size}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>今日新词</span>
                  <strong>
                    {learnedToday}
                    <small>/{data.dailyGoal}</small>
                  </strong>
                </div>
                <div>
                  <span>学习时间</span>
                  <strong>
                    {seconds < 60
                      ? `${seconds}s`
                      : `${Math.floor(seconds / 60)}min`}
                  </strong>
                </div>
              </div>
              <div className="kind-switch" aria-label="学习类型">
                {(["all", "word", "phrase"] as const).map((k) => (
                  <button
                    key={k}
                    className={kind === k ? "selected" : ""}
                    aria-pressed={kind === k}
                    onClick={() => startLearning(k)}
                  >
                    {k === "all"
                      ? "单词＋短语"
                      : k === "word"
                        ? "单词"
                        : "短语"}
                  </button>
                ))}
              </div>
              <div className="recall-content" key={current.id}>
                <h1 className={current.kind === "phrase" ? "phrase-term" : ""}>
                  {current.term}
                </h1>
                <div className="pronunciation">
                  <span>{current.phonetic || "听一听，试着完整回忆"}</span>
                  {icon(
                    "朗读词条",
                    <SpeakerHighIcon size={24} weight="fill" />,
                    () => speak(current.term),
                    "audio-button",
                  )}
                </div>
                <button className="easy-button" onClick={() => commit("easy")}>
                  <TrashIcon size={17} />
                  标记为太简单
                </button>
                <div
                  id="recall-meaning"
                  className="hint-reveal"
                  data-visible={hintVisible ? "true" : "false"}
                  aria-hidden={!hintVisible}
                >
                  <button
                    className="hint-content"
                    onClick={toggleHint}
                    tabIndex={hintVisible ? 0 : -1}
                    aria-label="收起释义"
                  >
                    <span>释义</span>
                    <p>{current.meaning}</p>
                    <small>再次点击，即可收起</small>
                  </button>
                </div>
              </div>
              <button
                className="recall-space"
                aria-label={
                  hintVisible ? "点击空白处收起释义" : "点击空白处查看释义"
                }
                aria-expanded={hintVisible}
                aria-controls="recall-meaning"
                onClick={toggleHint}
              />
              <footer className="recall-footer">
                <button
                  className="recall-help"
                  aria-expanded={hintVisible}
                  aria-controls="recall-meaning"
                  onClick={toggleHint}
                >
                  {hintVisible ? (
                    <>再次点击空白处收起释义</>
                  ) : (
                    <>
                      尝试回想释义
                      <br />
                      点击空白处查看释义
                    </>
                  )}
                </button>
                <div className="answer-buttons">
                  <button
                    className="answer-forgot"
                    onClick={() => reveal("forgot")}
                  >
                    不认识
                  </button>
                  <button
                    className="answer-known"
                    onClick={() => reveal("known")}
                  >
                    我认识
                  </button>
                </div>
              </footer>
            </>
          )}
        </>
      ) : (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">BAIWAN · 每天一点</p>
              <h1>
                {screen === "home"
                  ? "百万背单词"
                  : screen === "library"
                    ? "我的词库"
                    : "学习足迹"}
              </h1>
            </div>
            {screen === "library" ? (
              icon("添加词条", <PlusIcon size={26} />, () => openAddEntry())
            ) : (
              <span className="offline-badge">
                <span />
                {cloud.user
                  ? cloud.status === "synced"
                    ? "已同步"
                    : "待同步"
                  : "本地模式"}
              </span>
            )}
          </header>
          <MobileScroll key={screen} className="main-scroll">
            <div className="main-content">
              {screen === "home" && (
                <>
                  <p className="home-greeting">把一个词，变成你的表达。</p>
                  <section className="today-card">
                    <div className="section-heading">
                      <h2>今天，慢慢记住</h2>
                      <span>
                        {new Date(now).toLocaleDateString("zh-CN", {
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="daily-content-note">
                      单词与短语一起学 · 两类内容交替安排
                    </p>
                    <div className="home-counts">
                      <div>
                        <strong>
                          {Math.min(
                            due.length,
                            Math.max(
                              0,
                              (data.reviewGoal ?? data.dailyGoal * 3) -
                                reviewedToday,
                            ),
                          )}
                        </strong>
                        <span>待复习</span>
                      </div>
                      <div>
                        <strong>
                          {Math.min(
                            Math.max(0, data.dailyGoal - learnedToday),
                            unseen.length,
                          )}
                        </strong>
                        <span>待学新词</span>
                      </div>
                      <div>
                        <strong>{learnedToday + reviewedToday}</strong>
                        <span>今日已学</span>
                      </div>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => startLearning()}
                    >
                      {dailyRemaining
                        ? todayEvents.length || session?.day === today
                          ? "继续今日学习"
                          : "开始学习"
                        : "查看今日小结"}
                      <ArrowRightIcon size={21} />
                    </button>
                    {!dailyRemaining && todayEvents.length > 0 && (
                      <button
                        className="quiet-button extra-session"
                        onClick={() => startLearning("all", true)}
                      >
                        再学一组
                      </button>
                    )}
                  </section>
                  <div className="section-heading section-gap">
                    <h2>选一种方式，继续</h2>
                    <span>共 {entries.length} 个词条</span>
                  </div>
                  {(["word", "phrase"] as const).map((k) => (
                    <button
                      key={k}
                      className={`learning-kind-card ${k === "phrase" ? "phrase-card" : ""}`}
                      onClick={() => startLearning(k)}
                    >
                      <span className="kind-card-icon">
                        {k === "word" ? (
                          <BookOpenIcon size={25} weight="duotone" />
                        ) : (
                          <PencilSimpleIcon size={25} weight="duotone" />
                        )}
                      </span>
                      <div>
                        <h3>{k === "word" ? "单词练习" : "短语练习"}</h3>
                        <p>
                          {entries.some((e) => e.kind === k)
                            ? `${entries.filter((e) => e.kind === k).length} 个${k === "word" ? "单词" : "短语"} · 单独练习`
                            : `还没有${k === "word" ? "单词" : "短语"}，点击添加`}
                        </p>
                      </div>
                      <CaretRightIcon size={19} />
                    </button>
                  ))}
                  <button
                    className="plan-summary"
                    onClick={() => openSheet("plan")}
                  >
                    <CalendarBlankIcon size={24} />
                    <div>
                      <h3>设置任务量</h3>
                      <p>
                        每天学习 {data.dailyGoal} 个新词 · 复习{" "}
                        {data.reviewGoal ?? data.dailyGoal * 3} 个
                      </p>
                    </div>
                    <CaretRightIcon size={18} />
                  </button>
                  <section className="study-calendar" aria-label="学习日历">
                    <div className="section-heading">
                      <h2>学习日历</h2>
                      <div className="calendar-month-nav">
                        {icon("上个月", <ArrowLeftIcon size={17} />, () =>
                          setCalendarMonth(
                            (d) =>
                              new Date(d.getFullYear(), d.getMonth() - 1, 1),
                          ),
                        )}
                        <span>
                          {calendarMonth.getFullYear()} 年{" "}
                          {calendarMonth.getMonth() + 1} 月
                        </span>
                        {icon("下个月", <ArrowRightIcon size={17} />, () =>
                          setCalendarMonth(
                            (d) =>
                              new Date(d.getFullYear(), d.getMonth() + 1, 1),
                          ),
                        )}
                      </div>
                    </div>
                    <div className="calendar-grid">
                      {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                        <span className="weekday" key={day}>
                          {day}
                        </span>
                      ))}
                      {calendarDays(
                        calendarMonth.getFullYear(),
                        calendarMonth.getMonth(),
                      ).map((day, i) =>
                        day ? (
                          <button
                            key={day}
                            aria-label={`${day}${data.events.some((e) => localDay(e.at) === day) ? " 已学习" : " 未学习"}`}
                            aria-pressed={selectedDay === day}
                            className={`${data.events.some((e) => localDay(e.at) === day) ? "studied" : ""} ${day === today ? "today" : ""} ${day === selectedDay ? "selected" : ""}`}
                            onClick={() => setSelectedDay(day)}
                          >
                            {Number(day.slice(-2))}
                          </button>
                        ) : (
                          <span key={`blank-${i}`} />
                        ),
                      )}
                    </div>
                    <p>
                      {selectedDay} · 已学{" "}
                      {
                        new Set(
                          data.events
                            .filter((e) => localDay(e.at) === selectedDay)
                            .map((e) => e.entryId),
                        ).size
                      }{" "}
                      个 ·{" "}
                      {Math.floor((data.activeSeconds[selectedDay] ?? 0) / 60)}{" "}
                      分钟
                    </p>
                  </section>
                  <p className="local-caption">
                    {cloud.user
                      ? syncLabel
                      : "登录同步，或在“我的”使用免登录云备份"}
                  </p>
                </>
              )}
              {screen === "library" && (
                <>
                  <label className="search-box">
                    <MagnifyingGlassIcon size={20} />
                    <KeyboardInput
                      aria-label="搜索单词或短语"
                      placeholder="搜索单词、短语或中文释义"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query &&
                      icon("清空搜索", <XIcon size={17} />, () => setQuery(""))}
                  </label>
                  <div className="library-filters">
                    {(
                      [
                        ["all", "全部"],
                        ["word", "单词"],
                        ["phrase", "短语"],
                        ["favorite", "收藏"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={filter === value}
                        className={filter === value ? "selected" : ""}
                        onClick={() => {
                          keyboard.hide();
                          setFilter(value);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="list-count">
                    {filtered.length} 个词条 · 点击查看释义 · 左滑删除
                  </p>
                  <div className="entry-list">
                    {filtered.map((entry) => (
                      <Carousel
                        key={entry.id}
                        className="entry-swipe"
                        contentClassName="entry-swipe-track"
                        ariaLabel={`${entry.term}，左滑显示删除`}
                      >
                        <button
                          className="entry-row"
                          onClick={(event) => {
                            keyboard.hide();
                            const row =
                              event.currentTarget.closest(".mobile-carousel");
                            if (row && row.scrollLeft > 4) {
                              row.scrollTo({ left: 0, behavior: "smooth" });
                              return;
                            }
                            setBrowseId(entry.id);
                            autoRead(entry);
                            setDetailTab("meaning");
                          }}
                        >
                          <div>
                            <div className="entry-name">
                              <strong>{entry.term}</strong>
                              {data.favorites.includes(entry.id) && (
                                <StarIcon size={13} weight="fill" />
                              )}
                            </div>
                            <p>{entry.meaning}</p>
                            <span
                              className={
                                nextDueLabel(data.progress[entry.id], now) ===
                                "待复习"
                                  ? "entry-due"
                                  : "entry-status"
                              }
                            >
                              {nextDueLabel(data.progress[entry.id], now)}
                            </span>
                          </div>
                          <CaretRightIcon size={17} />
                        </button>
                        <button
                          type="button"
                          className="entry-delete"
                          aria-label={`删除 ${entry.term}`}
                          onClick={() => deleteFromLibrary(entry)}
                        >
                          <TrashIcon size={23} />
                          <span>删除</span>
                        </button>
                      </Carousel>
                    ))}
                  </div>
                  {!filtered.length && (
                    <div className="empty-state">
                      <BookOpenIcon size={36} weight="light" />
                      <h3>
                        {filter === "favorite"
                          ? "还没有收藏"
                          : "还没有找到这个表达"}
                      </h3>
                      <p>
                        {filter === "favorite"
                          ? "学习时点击星标，就能在这里找到它。"
                          : "试试其他关键词，或把它添加到词库。"}
                      </p>
                      <button
                        className="quiet-button"
                        onClick={() => openAddEntry()}
                      >
                        添加词条
                      </button>
                    </div>
                  )}
                </>
              )}
              {screen === "profile" && (
                <>
                  <div className="profile-intro">
                    <span>
                      <img
                        src="/assets/app/baiwan-cat-192-v1.png"
                        alt="百万背单词金渐层小猫头像"
                        width={55}
                        height={55}
                        draggable={false}
                      />
                    </span>
                    <div>
                      <h2>每一次回忆，都有回响。</h2>
                      <p>
                        {cloud.user
                          ? `${cloud.user.name} · 每次进步，都为你保存`
                          : "先从这里开始，登录后随处继续"}
                      </p>
                    </div>
                  </div>
                  <button className="cloud-card" onClick={openAccount}>
                    <UserCircleIcon size={28} weight="duotone" />
                    <span>
                      <strong>
                        {cloud.user ? cloud.user.email : "登录 / 注册"}
                      </strong>
                      <small>{syncLabel}</small>
                    </span>
                    <CaretRightIcon size={18} />
                  </button>
                  {cloud.user && cloud.error && (
                    <p className="cloud-error" role="status">
                      {cloud.error}
                    </p>
                  )}
                  <div className="profile-stats">
                    <div>
                      <strong>{Object.keys(data.progress).length}</strong>
                      <span>已学词条</span>
                    </div>
                    <div>
                      <strong>{data.favorites.length}</strong>
                      <span>我的收藏</span>
                    </div>
                    <div>
                      <strong>
                        {new Set(data.events.map((e) => localDay(e.at))).size}
                      </strong>
                      <span>学习天数</span>
                    </div>
                  </div>
                  <section className="profile-group">
                    <button onClick={() => openSheet("install")}>
                      <HouseIcon size={21} />
                      <span>添加到主屏幕</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={() => openSheet("plan")}>
                      <CalendarBlankIcon size={21} />
                      <span>复习计划</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button
                      onClick={() => {
                        setFilter("favorite");
                        navigate("library");
                      }}
                    >
                      <StarIcon size={21} />
                      <span>我的收藏</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={() => openSheet("voice")}>
                      <SpeakerHighIcon size={21} />
                      <span>朗读设置</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={() => openSheet("backup")}>
                      <UploadSimpleIcon size={21} />
                      <span>免登录云备份</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={exportBackup}>
                      <DownloadSimpleIcon size={21} />
                      <span>导出学习备份</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={() => importRef.current?.click()}>
                      <UploadSimpleIcon size={21} />
                      <span>从备份恢复</span>
                      <CaretRightIcon size={18} />
                    </button>
                    <button onClick={() => void checkForUpdates()}>
                      <ClockIcon
                        size={21}
                        className={checkingUpdate ? "checking-update" : ""}
                      />
                      <span>
                        {checkingUpdate ? "取消检查更新" : "检查更新"}
                      </span>
                      <CaretRightIcon size={18} />
                    </button>
                    {cloud.user && (
                      <button onClick={() => void checkCloudConnection()}>
                        <CheckCircleIcon size={21} />
                        <span>
                          {checkingConnection ? "取消连接检查" : "检查云端连接"}
                        </span>
                        <CaretRightIcon size={18} />
                      </button>
                    )}
                  </section>
                  {updateState.message && (
                    <p
                      className={`connection-report ${updateState.failed ? "is-error" : ""}`}
                      role="status"
                    >
                      {updateState.message}
                    </p>
                  )}
                  {connectionReport && (
                    <p className="connection-report" role="status">
                      {connectionReport}
                    </p>
                  )}
                  {(updateState.failed || cloud.error) && (
                    <button
                      className="quiet-button recovery-button"
                      onClick={applyUpdate}
                    >
                      重新加载应用（保留记录）
                    </button>
                  )}
                  <div className="local-info">
                    <CheckCircleIcon size={19} />
                    <div>
                      <strong>
                        {offlineReady
                          ? "已准备好离线使用"
                          : window.isSecureContext
                            ? "正在准备离线资源"
                            : "局域网预览 · 本地保存"}
                      </strong>
                      <p>
                        {cloud.user
                          ? "离线时先保存在本机，联网并打开应用后会继续同步。新增词条、笔记和学习记录仅当前账号可见。"
                          : "不登录也能学习，记录保存在当前设备。登录后可合并离线记录，并在不同设备上继续。"}{" "}
                        建议定期导出备份。
                      </p>
                    </div>
                  </div>
                  <p className="local-caption">
                    百万背单词 {APP_VERSION} · 单词与短语，都值得记住
                  </p>
                </>
              )}
            </div>
          </MobileScroll>
          <nav className="bottom-nav" aria-label="主要导航">
            {(
              [
                { value: "home", label: "学习", icon: HouseIcon },
                { value: "library", label: "词库", icon: BookOpenIcon },
                { value: "profile", label: "我的", icon: UserCircleIcon },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                className={screen === item.value ? "selected" : ""}
                aria-current={screen === item.value ? "page" : undefined}
                onClick={() => navigate(item.value)}
              >
                <item.icon
                  size={23}
                  weight={screen === item.value ? "fill" : "regular"}
                />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      <BottomSheet
        open={sheet === "voice"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="朗读设置"
        description="背诵时读词条，查看释义时读例句，各播放一次"
        snap={0.68}
      >
        <div className="backup-panel">
          <label className="toggle-setting">
            <span>自动朗读词条与例句</span>
            <input
              type="checkbox"
              checked={data.autoSpeak !== false}
              onChange={(e) =>
                save({ ...dataRef.current, autoSpeak: e.target.checked })
              }
            />
          </label>
          <label className="voice-picker">
            英语声音
            <select
              aria-label="英语声音"
              value={data.voiceURI ?? ""}
              onChange={(e) =>
                save({ ...dataRef.current, voiceURI: e.target.value })
              }
            >
              <option value="">
                自动选择女声
                {chooseVoice(voices)?.name
                  ? ` · ${chooseVoice(voices)!.name}`
                  : "（需下载英语语音）"}
              </option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
          </label>
          <p>
            优先使用 Samantha
            等英语女声，语速稍慢。系统没有可用女声时，请先下载英语语音，或在这里选择并试听。
          </p>
          <button
            className="primary-button"
            onClick={() => speak("I hear you. Keep up the good work.")}
          >
            试听声音
          </button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "backup"}
        onOpenChange={(open) => !backupBusy && !open && setSheet(null)}
        title="免登录云备份"
        description="保存词库、学习进度、任务量和当前分组"
        snap={0.9}
      >
        <div className="backup-panel">
          <p>
            恢复码是这份备份的钥匙。妥善保存，可在新设备上恢复；不需要注册账号。只有点击上传才会保存到云端。
          </p>
          <button
            className="primary-button"
            disabled={backupBusy}
            onClick={() => void uploadBackup()}
          >
            {backupBusy ? "正在处理…" : "上传完整学习备份"}
          </button>
          {backupCode && (
            <>
              <label>
                当前恢复码
                <KeyboardInput
                  aria-label="当前恢复码"
                  type="password"
                  value={backupCode}
                  readOnly
                />
              </label>
              <button
                className="quiet-button"
                onClick={() =>
                  downloadSnapshot(
                    JSON.stringify({ recoveryCode: backupCode }, null, 2),
                    "百万背单词-云备份恢复码.json",
                  )
                }
              >
                保存恢复码文件
              </button>
              <button
                className="quiet-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(backupCode);
                    setBackupMessage("恢复码已复制，请妥善保存");
                  } catch {
                    setBackupMessage("无法复制，请保存恢复码文件");
                  }
                }}
              >
                复制恢复码
              </button>
              <button
                className="quiet-button"
                disabled={backupBusy}
                onClick={() => {
                  setRestoreCode(backupCode);
                  void previewBackup(backupCode);
                }}
              >
                读取当前云备份
              </button>
              <button
                className="quiet-button"
                disabled={backupBusy}
                onClick={() => void uploadBackup(true)}
              >
                另存为一份新备份
              </button>
            </>
          )}
          {backupMessage && (
            <p className="connection-report" role="status">
              {backupMessage}
            </p>
          )}
          <div className="backup-divider" />
          <label>
            从云端恢复
            <KeyboardInput
              aria-label="云备份恢复码"
              type="password"
              placeholder="粘贴完整恢复码 bw1_…"
              value={restoreCode}
              onChange={(e) => {
                setRestoreCode(e.target.value);
                setCloudPreview(null);
              }}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <button
            className="quiet-button"
            disabled={backupBusy || !restoreCode.trim()}
            onClick={() => void previewBackup()}
          >
            读取备份并预览
          </button>
          {cloudPreview && (
            <div className="backup-preview">
              <strong>
                {(cloudPreview.library?.length ?? 0) +
                  cloudPreview.customEntries.length}{" "}
                个词条 · {Object.keys(cloudPreview.progress).length} 个学习记录
              </strong>
              <p>
                新词 {cloudPreview.dailyGoal} / 天，复习{" "}
                {cloudPreview.reviewGoal ?? cloudPreview.dailyGoal * 3} / 天；
                {cloudPreview.session
                  ? "包含未完成或最近的分组"
                  : "没有进行中的分组"}
              </p>
              <button
                className="primary-button"
                onClick={() => {
                  setImportDraft(cloudPreview);
                  openSheet("import");
                }}
              >
                继续确认恢复
              </button>
            </div>
          )}
          {store.previousRestoreBackup() && (
            <button
              className="quiet-button"
              onClick={() =>
                downloadSnapshot(
                  store.previousRestoreBackup()!,
                  "百万背单词-恢复前快照.json",
                )
              }
            >
              下载恢复前的本机快照
            </button>
          )}
          {store.previousCatalogBackup() && (
            <button
              className="quiet-button"
              onClick={() =>
                downloadSnapshot(
                  store.previousCatalogBackup()!,
                  "百万背单词-词库替换前备份.json",
                )
              }
            >
              下载本机词库替换前备份
            </button>
          )}
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "menu"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="学习工具"
        description="让每次练习更顺手"
        snap={0.53}
      >
        <div className="menu-actions">
          <button onClick={() => openSheet("plan")}>
            <CalendarBlankIcon size={22} />
            查看复习计划
            <CaretRightIcon size={18} />
          </button>
          <button onClick={() => openAddEntry(current?.kind)}>
            <PlusIcon size={22} />
            添加单词或短语
            <CaretRightIcon size={18} />
          </button>
          <button onClick={exportBackup}>
            <DownloadSimpleIcon size={22} />
            导出学习备份
            <CaretRightIcon size={18} />
          </button>
          <button onClick={() => importRef.current?.click()}>
            <UploadSimpleIcon size={22} />
            从备份恢复
            <CaretRightIcon size={18} />
          </button>
          <button onClick={() => navigate("home")}>
            <HouseIcon size={22} />
            回到学习首页
            <CaretRightIcon size={18} />
          </button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "note"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="我的笔记"
        description={current?.term ?? "记录你的联想"}
        snap={0.62}
      >
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (current)
              save({
                ...dataRef.current,
                notes: { ...dataRef.current.notes, [current.id]: note.trim() },
              });
            keyboard.hide();
            setSheet(null);
            setToast("笔记已保存");
          }}
        >
          <KeyboardTextarea
            aria-label="词条笔记"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={3000}
            rows={6}
            placeholder="一个联想、一句自己的例句……"
          />
          <button className="primary-button" type="submit">
            保存笔记
            <CheckIcon size={20} />
          </button>
        </form>
      </BottomSheet>
      <BottomSheet
        open={sheet === "add"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="收下一个新表达"
        description={
          cloud.user
            ? "保存到我的词库，并同步到当前账号"
            : "保存到本机，登录后可以同步"
        }
        snap={0.9}
      >
        <form className="entry-form" onSubmit={addEntry}>
          <div className="form-kind">
            {(["word", "phrase"] as const).map((k) => (
              <button
                type="button"
                key={k}
                className={draft.kind === k ? "selected" : ""}
                aria-pressed={draft.kind === k}
                onClick={() => setDraft({ ...draft, kind: k })}
              >
                {k === "word" ? "单词" : "短语"}
              </button>
            ))}
          </div>
          {(
            [
              {
                key: "term",
                label: "英文",
                placeholder:
                  draft.kind === "word"
                    ? "例如：discover"
                    : "例如：make the most of",
                required: true,
              },
              {
                key: "meaning",
                label: "中文释义",
                placeholder: "例如：充分利用",
                required: true,
              },
              {
                key: "phonetic",
                label: "音标",
                placeholder: "/…/",
                required: false,
              },
              {
                key: "example",
                label: "英文例句",
                placeholder: "写一句你会用到的例句",
                required: false,
              },
              {
                key: "translation",
                label: "例句翻译",
                placeholder: "中文翻译",
                required: false,
              },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              {f.label} <span>{f.required ? "必填" : "选填"}</span>
              <KeyboardInput
                aria-label={f.label}
                required={f.required}
                maxLength={f.key === "term" ? 150 : 1200}
                value={draft[f.key]}
                onChange={(e) =>
                  setDraft({ ...draft, [f.key]: e.target.value })
                }
                placeholder={f.placeholder}
              />
            </label>
          ))}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="primary-button" type="submit">
            加入词库
            <PlusIcon size={20} />
          </button>
        </form>
      </BottomSheet>
      <BottomSheet
        open={sheet === "import"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="恢复学习备份"
        description={
          cloud.user
            ? "将备份合并到当前账号，保留已有记录"
            : "恢复后将替换当前设备上的学习数据"
        }
        snap={0.56}
      >
        <div className="import-summary">
          <p>
            这份备份包含{" "}
            {(importDraft?.library?.length ?? cloud.library.length) +
              (importDraft?.customEntries.length ?? 0)}{" "}
            个词条、
            {Object.keys(importDraft?.progress ?? {}).length} 条学习进度和{" "}
            {importDraft?.favorites.length ?? 0} 个收藏。
          </p>
          <p>
            {cloud.user
              ? "学习历史会与当前账号合并；词库、任务量和当前分组使用备份设置。恢复前会保存本机快照。"
              : "确认后会用这份备份替换当前词库与学习状态，同时保留恢复前的本机快照。"}
          </p>
          <button className="quiet-button" onClick={exportBackup}>
            先导出当前备份
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (!importDraft) return;
              if (!store.restore(importDraft)) {
                setToast("恢复未执行，请先保存当前备份");
                return;
              }
              setImportDraft(null);
              navigate("home");
              setToast("已恢复备份");
            }}
          >
            确认恢复
          </button>
          <button className="quiet-button" onClick={() => setSheet(null)}>
            取消
          </button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "auth"}
        dismissible={false}
        onOpenChange={(open) => {
          if (!open && !authBusy) {
            setSheet(null);
            setAuthPassword("");
            setNewPassword("");
          }
        }}
        title={
          authMode === "manage"
            ? "账号与同步"
            : authMode === "password"
              ? "修改密码"
              : authMode === "register"
                ? "建立你的学习账号"
                : "继续你的学习"
        }
        description={
          authMode === "manage"
            ? "你的词条与进度，随处继续"
            : "使用邮箱和密码，无需第三方账号"
        }
        snap={0.88}
      >
        <button
          type="button"
          className="icon-button auth-close"
          aria-label="关闭账号窗口"
          disabled={authBusy}
          onClick={() => {
            keyboard.hide();
            setSheet(null);
            setAuthPassword("");
            setNewPassword("");
          }}
        >
          <XIcon size={22} />
        </button>
        {authMode === "manage" && cloud.user ? (
          <div className="account-content">
            <p className="account-email">{cloud.user.email}</p>
            <div className="sync-detail" role="status">
              <strong>{syncLabel}</strong>
              <p>
                {cloud.lastSynced
                  ? `最近同步：${new Date(cloud.lastSynced).toLocaleString("zh-CN")}`
                  : "还没有同步记录"}
              </p>
              {cloud.error && <p className="cloud-error">{cloud.error}</p>}
            </div>
            <button
              className="primary-button"
              disabled={cloud.status === "syncing"}
              onClick={() => void store.sync()}
            >
              {cloud.status === "syncing" ? "正在同步…" : "立即同步"}
            </button>
            <button
              className="account-action"
              onClick={() => void checkCloudConnection()}
            >
              {checkingConnection ? "取消连接检查" : "检查云端连接"}
            </button>
            {connectionReport && (
              <p className="connection-report" role="status">
                {connectionReport}
              </p>
            )}
            {cloud.error && (
              <button className="account-action" onClick={applyUpdate}>
                重新加载应用（保留记录）
              </button>
            )}
            {store.hasGuestData() && (
              <button
                className="account-action"
                onClick={() => {
                  store.importGuest();
                  void store.sync();
                  setToast("离线记录已合并，正在同步；原本地记录保留");
                }}
              >
                合并这台设备的离线记录
              </button>
            )}
            <button
              className="account-action"
              onClick={() => {
                setAuthMode("password");
                setAuthError("");
              }}
            >
              修改密码
            </button>
            <button
              className="account-action"
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              重新登录
            </button>
            <button
              className="account-action"
              disabled={authBusy}
              onClick={async () => {
                setAuthBusy(true);
                setAuthError("");
                try {
                  await store.logout();
                  navigate("profile");
                  setToast("已退出，回到本地学习模式");
                } catch (error) {
                  setAuthError(
                    error instanceof Error ? error.message : "退出失败，请重试",
                  );
                } finally {
                  setAuthBusy(false);
                }
              }}
            >
              退出账号
            </button>
            <p className="account-explainer">
              公共词库供大家学习；你添加的词条、笔记、收藏和复习进度只属于当前账号。
            </p>
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
          </div>
        ) : (
          <form className="entry-form auth-form" onSubmit={submitAuth}>
            {authMode !== "password" && (
              <>
                <div className="form-kind">
                  <button
                    type="button"
                    className={authMode === "login" ? "selected" : ""}
                    onClick={() => {
                      setAuthMode("login");
                      setAuthError("");
                    }}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className={authMode === "register" ? "selected" : ""}
                    onClick={() => {
                      setAuthMode("register");
                      setAuthError("");
                    }}
                  >
                    注册
                  </button>
                </div>
                {authMode === "register" && (
                  <label>
                    昵称
                    <KeyboardInput
                      aria-label="昵称"
                      value={authName}
                      maxLength={40}
                      required

                      onChange={(e) => setAuthName(e.target.value)}
                      autoComplete="nickname"
                      placeholder="怎么称呼你"
                    />
                  </label>
                )}
                <label>
                  邮箱
                  <KeyboardInput
                    aria-label="邮箱"
                    type="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    value={authEmail}
                    maxLength={254}
                    required

                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </label>
              </>
            )}
            <label>
              {authMode === "password" ? "当前密码" : "密码"}
              <KeyboardInput
                aria-label={authMode === "password" ? "当前密码" : "密码"}
                type="password"
                autoComplete={
                  authMode === "register" ? "new-password" : "current-password"
                }
                value={authPassword}
                minLength={authMode === "register" ? 10 : 1}
                maxLength={128}
                required

                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder={
                  authMode === "register" ? "至少 10 位" : "输入密码"
                }
              />
            </label>
            {authMode === "password" && (
              <label>
                新密码
                <KeyboardInput
                  aria-label="新密码"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  minLength={10}
                  maxLength={128}
                  required

                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 10 位"
                />
              </label>
            )}
            {authMode !== "password" && store.hasGuestData() && (
              <label className="merge-option">
                <input
                  type="checkbox"
                  checked={importLocal}
                  onChange={(e) => setImportLocal(e.target.checked)}
                />
                合并这台设备的离线记录，原记录保留
              </label>
            )}
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={authBusy}
            >
              {authBusy
                ? "请稍候…"
                : authMode === "register"
                  ? "注册并开始同步"
                  : authMode === "password"
                    ? "保存新密码"
                    : "登录并继续"}
            </button>
            <p className="account-explainer">
              {authMode === "password"
                ? "修改后其他设备需要重新登录。"
                : "当前支持邮箱密码登录，暂未开通邮件找回，请保管好密码。学习记录与笔记仅自己可见。"}
            </p>
          </form>
        )}
      </BottomSheet>
      <BottomSheet
        open={sheet === "install"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="把百万背单词放到主屏幕"
        description="使用 iPhone 的 Safari 打开"
        snap={0.65}
      >
        <div className="install-guide">
          <div className="install-app-preview">
            <img
              src="/assets/app/baiwan-cat-180-v1.png"
              alt="百万背单词主屏幕图标"
              width={72}
              height={72}
              draggable={false}
            />
            <strong>百万背单词</strong>
          </div>
          {!window.isSecureContext && (
            <p className="install-notice">
              当前是局域网 HTTP
              预览，只能在电脑服务运行时访问。主屏幕离线使用需要 HTTPS 地址。
            </p>
          )}
          <ol>
            <li>在 Safari 打开百万背单词的 HTTPS 链接。</li>
            <li>
              点“分享”，选择“添加到主屏幕”。如出现“作为网页 App
              打开”，请保持开启。
            </li>
            <li>从新图标重新打开一次，保持联网，等待“已准备好离线使用”。</li>
            <li>
              打开飞行模式，退出后重新打开，验证单词、短语和笔记都可使用。
            </li>
          </ol>
          <p>
            登录同一账号后，Safari
            和主屏幕入口都可以同步学习记录。离线期间的改动会在联网并打开应用后上传。
          </p>
          <p>
            已有图标仍显示旧名称或旧图案时，可从新版网页重新添加。先确认旧入口的记录已同步或导出备份，再移除旧图标。
          </p>
          <button className="primary-button" onClick={() => setSheet(null)}>
            知道了
          </button>
        </div>
      </BottomSheet>
      {deletedUndo &&
        !sheet &&
        deletedUndo.account === (cloud.user?.id ?? "guest") && (
          <div className="delete-notice" role="status">
            <span>已删除「{deletedUndo.backup.entry.term}」</span>
            <button type="button" onClick={undoDelete}>
              撤销
            </button>
          </div>
        )}
      {updateAvailable &&
        !deletedUndo &&
        !sheet &&
        screen !== "study" &&
        !browseId && (
          <div className="update-notice" role="status">
            <div>
              <strong>发现新版本 {updateState.latest?.version}</strong>
              <span>已保存的词库和学习记录会保留</span>
            </div>
            <button onClick={applyUpdate}>更新</button>
          </div>
        )}
      {toast && (
        <div className="app-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
