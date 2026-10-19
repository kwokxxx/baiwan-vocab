import {
  buildQueue,
  createId,
  localDay,
  type Entry,
  type EntryKind,
  type LearningSession,
  type StudyData,
} from "./study.ts";

export const GROUP_SIZE = 7;

function latestToday(data: StudyData, now: number) {
  const latest = new Map<string, StudyData["events"][number]>();
  const today = localDay(now);
  for (const event of data.events)
    if (
      localDay(event.at) === today &&
      event.at >= (latest.get(event.entryId)?.at ?? 0)
    )
      latest.set(event.entryId, event);
  return latest;
}
function outstanding(
  entries: Entry[],
  data: StudyData,
  kind: EntryKind | "all",
  now: number,
) {
  const events = latestToday(data, now);
  return entries
    .filter(
      (e) =>
        (kind === "all" || e.kind === kind) &&
        !data.deletedEntries?.[e.id] &&
        !data.progress[e.id]?.suspended &&
        (events.get(e.id)?.rating === "forgot" || events.get(e.id)?.hinted),
    )
    .map((e) => e.id);
}
export function taskQueue(
  entries: Entry[],
  data: StudyData,
  kind: EntryKind | "all",
  now: number,
  extra = false,
) {
  return [
    ...new Set([
      ...outstanding(entries, data, kind, now),
      ...buildQueue(entries, data, kind, now, extra),
    ]),
  ];
}
export function mergeSessionSlots(
  ...values: StudyData[]
): StudyData["sessionSlots"] {
  const slots: NonNullable<StudyData["sessionSlots"]> = {};
  for (const data of values)
    for (const candidate of [
      ...Object.values(data.sessionSlots ?? {}),
      data.session,
    ]) {
      if (!candidate) continue;
      const old = slots[candidate.kind];
      if (!old || candidate.updatedAt >= old.updatedAt)
        slots[candidate.kind] = candidate;
    }
  return Object.keys(slots).length ? slots : undefined;
}
export function rememberSession(data: StudyData): StudyData {
  const slots = mergeSessionSlots(data);
  return slots ? { ...data, sessionSlots: slots } : data;
}
export function reconcileSession(
  session: LearningSession,
  entries: Entry[],
  data: StudyData,
  now: number,
): LearningSession {
  const visible = new Set(
    entries
      .filter(
        (e) =>
          !data.deletedEntries?.[e.id] &&
          (session.kind === "all" || e.kind === session.kind),
      )
      .map((e) => e.id),
  );
  const latest = latestToday(data, now);
  const results = { ...session.results };
  const round = session.round.filter((id) => visible.has(id));
  const everMissed = new Set(session.everMissed);
  for (const id of round) {
    const event = latest.get(id);
    if (event && event.at > session.updatedAt) {
      results[id] =
        event.rating === "easy" || (event.rating === "known" && !event.hinted);
      if (!results[id]) everMissed.add(id);
    }
  }
  let index = 0;
  while (index < round.length && results[round[index]] !== undefined) index++;
  const pending = session.extra
    ? session.pending.filter((id) => visible.has(id))
    : [
        ...new Set([
          ...outstanding(entries, data, session.kind, now),
          ...buildQueue(entries, data, session.kind, now),
        ]),
      ].filter((id) => !round.includes(id));
  return {
    ...session,
    round,
    index,
    results,
    pending,
    everMissed: [...everMissed],
    updatedAt: now,
  };
}
export function selectSession(
  entries: Entry[],
  data: StudyData,
  kind: EntryKind | "all",
  now: number,
  extra = false,
): StudyData {
  const slots = mergeSessionSlots(data);
  const saved = slots?.[kind];
  const fresh = createSession(entries, data, kind, now, extra);
  let session =
    !extra &&
    saved?.day === localDay(now) &&
    !(sessionFinished(saved) && fresh.round.length)
      ? reconcileSession(saved, entries, data, now)
      : fresh;
  if (
    !extra &&
    session.index >= session.round.length &&
    session.pending.length &&
    !session.round.length
  )
    session = advanceSession(session, entries, now);
  return rememberSession({ ...data, sessionSlots: slots, session });
}
export function createSession(
  entries: Entry[],
  data: StudyData,
  kind: EntryKind | "all",
  now: number,
  extra = false,
): LearningSession {
  let ids = taskQueue(entries, data, kind, now, extra);
  if (extra && !ids.length)
    ids = entries
      .filter(
        (e) =>
          (kind === "all" || e.kind === kind) &&
          !data.deletedEntries?.[e.id] &&
          !data.progress[e.id]?.suspended,
      )
      .sort(
        (a, b) =>
          (data.progress[a.id]?.lastReviewedAt ?? 0) -
          (data.progress[b.id]?.lastReviewedAt ?? 0),
      )
      .map((e) => e.id);
  if (extra) ids = ids.slice(0, GROUP_SIZE);
  return {
    id: createId(),
    day: localDay(now),
    kind,
    round: ids.slice(0, GROUP_SIZE),
    pending: ids.slice(GROUP_SIZE),
    index: 0,
    results: {},
    everMissed: outstanding(entries, data, kind, now),
    extra,
    updatedAt: now,
  };
}
export function answerSession(
  session: LearningSession,
  id: string,
  known: boolean,
  now: number,
): LearningSession {
  if (session.round[session.index] !== id) return session;
  return {
    ...session,
    index: session.index + 1,
    results: { ...session.results, [id]: known },
    everMissed: known
      ? session.everMissed
      : [...new Set([...session.everMissed, id])],
    updatedAt: now,
  };
}
export function missedInRound(session: LearningSession) {
  return session.round.filter((id) => session.results[id] === false);
}
export function advanceSession(
  session: LearningSession,
  entries: Entry[],
  now: number,
): LearningSession {
  const visible = new Set(entries.map((e) => e.id));
  const missed = missedInRound(session).filter((id) => visible.has(id));
  const pending = session.pending.filter((id) => visible.has(id));
  return {
    ...session,
    round: missed.length ? missed : pending.slice(0, GROUP_SIZE),
    pending: missed.length ? pending : pending.slice(GROUP_SIZE),
    index: 0,
    results: {},
    updatedAt: now,
  };
}
export function sessionFinished(session: LearningSession | null | undefined) {
  return (
    !!session &&
    session.index >= session.round.length &&
    !session.pending.length &&
    !missedInRound(session).length
  );
}

export function calendarDays(year: number, month: number) {
  const start = new Date(year, month, 1);
  const padding = (start.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  return [
    ...Array(padding).fill(null),
    ...Array.from({ length: count }, (_, i) =>
      localDay(new Date(year, month, i + 1).getTime()),
    ),
  ] as (string | null)[];
}

export function estimatedFinish(
  remaining: number,
  learnedToday: number,
  goal: number,
  now: number,
) {
  const offset = Math.max(
    0,
    Math.ceil((remaining + Math.min(learnedToday, goal)) / goal) - 1,
  );
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  return { date, days: remaining ? offset + 1 : 0 };
}
