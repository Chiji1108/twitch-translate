import { CAPTION_FADE_MS, type CaptionEntry } from "@/stores/caption-store";

export type VisibleCaptionEntry = CaptionEntry & { fading: boolean };

export function getVisibleCaptionEntries(
  entries: CaptionEntry[],
  captionHoldMs: number,
  now: number,
): VisibleCaptionEntry[] {
  const visibleEntries: VisibleCaptionEntry[] = [];
  for (const entry of entries) {
    if (!entry.japanese) continue;
    if (entry.demo || !entry.completedAt) {
      visibleEntries.push({ ...entry, fading: false });
      continue;
    }
    const fadeAt = entry.completedAt + captionHoldMs;
    const removeAt = fadeAt + CAPTION_FADE_MS;
    if (now < removeAt) {
      visibleEntries.push({ ...entry, fading: now >= fadeAt });
    }
  }
  return visibleEntries;
}

export function getNextCaptionDeadline(
  entries: CaptionEntry[],
  captionHoldMs: number,
  now: number,
) {
  let nextDeadline = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (entry.demo || !entry.completedAt) continue;
    const fadeAt = entry.completedAt + captionHoldMs;
    const removeAt = fadeAt + CAPTION_FADE_MS;
    if (now < fadeAt) {
      nextDeadline = Math.min(nextDeadline, fadeAt);
    } else if (now < removeAt) {
      nextDeadline = Math.min(nextDeadline, removeAt);
    }
  }
  return Number.isFinite(nextDeadline) ? nextDeadline : null;
}
