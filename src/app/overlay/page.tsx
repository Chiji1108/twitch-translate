"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CaptionRenderer } from "@/components/caption-renderer";
import {
  decodeObsCaptionEventData,
  OBS_CAPTION_EVENT_NAME,
} from "@/lib/obs-caption-transport";
import {
  emptySubtitleState,
  parseSubtitleState,
  SUBTITLE_CHANNEL_NAME,
  SUBTITLE_STORAGE_KEY,
  selectSubtitleState,
  useCaptionStore,
} from "@/stores/caption-store";

function readStoredSubtitle() {
  try {
    const saved = localStorage.getItem(SUBTITLE_STORAGE_KEY);
    return saved ? parseSubtitleState(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export default function Overlay() {
  const [overlayReady, setOverlayReady] = useState(false);
  const storedSubtitle = useCaptionStore(useShallow(selectSubtitleState));
  const replaceSubtitleState = useCaptionStore(
    (state) => state.replaceSubtitleState,
  );
  const subtitle = overlayReady
    ? storedSubtitle
    : { ...storedSubtitle, entries: [] };

  useEffect(() => {
    replaceSubtitleState(readStoredSubtitle() ?? emptySubtitleState());
    setOverlayReady(true);

    const channel = new BroadcastChannel(SUBTITLE_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const nextState = parseSubtitleState(event.data);
      if (nextState) replaceSubtitleState(nextState);
    };
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== SUBTITLE_STORAGE_KEY || !event.newValue) return;
      try {
        const nextState = parseSubtitleState(JSON.parse(event.newValue));
        if (nextState) replaceSubtitleState(nextState);
      } catch {
        // Ignore incomplete or invalid cross-window updates.
      }
    };
    const syncFromObs = (event: Event) => {
      const nextState = decodeObsCaptionEventData(
        (event as CustomEvent<unknown>).detail,
      );
      if (nextState) replaceSubtitleState(nextState);
    };

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener(OBS_CAPTION_EVENT_NAME, syncFromObs);
    return () => {
      channel.close();
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener(OBS_CAPTION_EVENT_NAME, syncFromObs);
    };
  }, [replaceSubtitleState]);

  return (
    <main className="overlay-page">
      <CaptionRenderer subtitle={subtitle} variant="overlay" />
    </main>
  );
}
