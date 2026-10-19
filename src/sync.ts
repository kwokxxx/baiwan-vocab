import {
  applyEntryDeletions,
  emptyData,
  scheduleReview,
  type StudyData,
} from "./study.ts";
import { mergeSessionSlots } from "./session.ts";

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function mergeMap<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
) {
  const result = { ...remote };
  for (const id of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (!same(base[id], local[id])) {
      if (id in local) result[id] = local[id];
      else delete result[id];
    }
  }
  return result;
}
const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

// Three-way merge: unchanged local fields never overwrite another device.
// Deletions (including un-favorite and empty notes) are changes, not missing data.
export function mergeStudyData(
  base: StudyData,
  local: StudyData,
  remote: StudyData,
): StudyData {
  if (same(local, base)) return applyEntryDeletions(remote);
  if (same(remote, base) || same(local, remote))
    return applyEntryDeletions(local);
  const events = Object.values({
    ...byId(remote.events),
    ...byId(local.events),
  }).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const progress = mergeMap(base.progress, local.progress, remote.progress);
  const baseEvents = new Set(base.events.map((event) => event.id));
  for (const id of Object.keys(progress)) {
    if (
      same(local.progress[id], base.progress[id]) ||
      same(remote.progress[id], base.progress[id]) ||
      same(local.progress[id], remote.progress[id])
    )
      continue;
    const added = events.filter(
      (event) => event.entryId === id && !baseEvents.has(event.id),
    );
    // Replay concurrent reviews in a stable order rather than losing either review.
    if (added.length) {
      let p = base.progress[id];
      for (const event of added)
        p = scheduleReview(p, event.rating, event.at, event.hinted);
      progress[id] = p;
    } else if (local.progress[id] && remote.progress[id]) {
      progress[id] =
        local.progress[id].lastReviewedAt >= remote.progress[id].lastReviewedAt
          ? local.progress[id]
          : remote.progress[id];
    }
  }
  const activeSeconds = { ...remote.activeSeconds };
  for (const day of Object.keys(local.activeSeconds)) {
    activeSeconds[day] =
      (remote.activeSeconds[day] ?? 0) +
      Math.max(0, local.activeSeconds[day] - (base.activeSeconds[day] ?? 0));
  }
  const favoriteMap = (data: StudyData) =>
    Object.fromEntries(data.favorites.map((id) => [id, true]));
  return applyEntryDeletions({
    version: 1,
    customEntries: Object.values(
      mergeMap(
        byId(base.customEntries),
        byId(local.customEntries),
        byId(remote.customEntries),
      ),
    ),
    progress,
    favorites: Object.keys(
      mergeMap(favoriteMap(base), favoriteMap(local), favoriteMap(remote)),
    ),
    notes: mergeMap(base.notes, local.notes, remote.notes),
    events,
    activeSeconds,
    dailyGoal:
      local.dailyGoal === base.dailyGoal ? remote.dailyGoal : local.dailyGoal,
    reviewGoal:
      local.reviewGoal === base.reviewGoal
        ? remote.reviewGoal
        : local.reviewGoal,
    catalogVersion: local.catalogVersion ?? remote.catalogVersion,
    library: same(local.library, base.library) ? remote.library : local.library,
    session:
      (local.session?.updatedAt ?? 0) >= (remote.session?.updatedAt ?? 0)
        ? local.session
        : remote.session,
    sessionSlots: mergeSessionSlots(local, remote),
    settingsUpdatedAt: Math.max(
      local.settingsUpdatedAt ?? 0,
      remote.settingsUpdatedAt ?? 0,
    ),
    voiceURI:
      local.voiceURI === base.voiceURI ? remote.voiceURI : local.voiceURI,
    autoSpeak:
      local.autoSpeak === base.autoSpeak ? remote.autoSpeak : local.autoSpeak,
    deletedEntries: mergeMap(
      base.deletedEntries ?? {},
      local.deletedEntries ?? {},
      remote.deletedEntries ?? {},
    ),
  });
}

// Import is non-destructive and idempotent: repeated imports do not add study time twice.
export function mergeImport(local: StudyData, remote: StudyData): StudyData {
  const merged = mergeStudyData(emptyData(), local, remote);
  for (const id of new Set([
    ...Object.keys(local.progress),
    ...Object.keys(remote.progress),
  ])) {
    const a = local.progress[id],
      b = remote.progress[id];
    merged.progress[id] = !a
      ? b
      : !b
        ? a
        : a.lastReviewedAt > b.lastReviewedAt
          ? a
          : b;
  }
  for (const day of Object.keys(merged.activeSeconds))
    merged.activeSeconds[day] = Math.max(
      local.activeSeconds[day] ?? 0,
      remote.activeSeconds[day] ?? 0,
    );
  // Importing an old backup must not silently resurrect entries already deleted here.
  merged.deletedEntries = { ...local.deletedEntries, ...remote.deletedEntries };
  return applyEntryDeletions(merged);
}
