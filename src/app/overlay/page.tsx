"use client";

import { useEffect, useState } from "react";
import { CaptionStackEntry } from "@/components/caption-stack-entry";
import type { FuriganaSegment } from "@/lib/furigana";

const SUBTITLE_STORAGE_KEY = "miri-translator-subtitles-v7";
const SUBTITLE_CHANNEL_NAME = "miri-translator-subtitles-v7";

type TranslationStyle = { fontSize: number; color: string };
type CaptionEntry = {
  id: number;
  japanese: string;
  furigana: FuriganaSegment[];
  translations: Record<string, string>;
  provisional: boolean;
  completed: boolean;
  fading: boolean;
  completedAt?: number;
  demo?: boolean;
};
type SubtitleState = {
  entries: CaptionEntry[];
  targets: string[];
  japaneseFontSize: number;
  japaneseColor: string;
  translationStyles: Record<string, TranslationStyle>;
  alignment: "left" | "center" | "right";
  verticalAlignment: "top" | "center" | "bottom";
  background: boolean;
};
const initial: SubtitleState = {
  entries: [],
  targets: ["en"],
  japaneseFontSize: 24,
  japaneseColor: "#ffffff",
  translationStyles: { en: { fontSize: 20, color: "#8ee8c5" } },
  alignment: "center",
  verticalAlignment: "bottom",
  background: true,
};

function JapaneseText({ entry }: { entry: CaptionEntry }) {
  if (!entry.furigana.length) return entry.japanese;
  return entry.furigana.map((segment, index) =>
    segment.reading ? (
      <ruby key={`${segment.text}-${index}`}>
        {segment.text}
        <rt>{segment.reading}</rt>
      </ruby>
    ) : (
      <span key={`${segment.text}-${index}`}>{segment.text}</span>
    ),
  );
}

export default function Overlay() {
  const [subtitle, setSubtitle] = useState(initial);

  useEffect(() => {
    const saved = localStorage.getItem(SUBTITLE_STORAGE_KEY);
    if (saved) setSubtitle(JSON.parse(saved) as SubtitleState);
    const channel = new BroadcastChannel(SUBTITLE_CHANNEL_NAME);
    channel.onmessage = (event) => setSubtitle(event.data as SubtitleState);
    const sync = (event: StorageEvent) => {
      if (event.key === SUBTITLE_STORAGE_KEY && event.newValue)
        setSubtitle(JSON.parse(event.newValue) as SubtitleState);
    };
    window.addEventListener("storage", sync);
    return () => {
      channel.close();
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <main
      className={`overlay-page vertical-${subtitle.verticalAlignment}`}
      style={
        {
          "--japanese-caption-size": `${subtitle.japaneseFontSize}px`,
          "--japanese-caption-color": subtitle.japaneseColor,
        } as React.CSSProperties
      }
    >
      <div
        className={`caption-stack overlay-caption-log align-${subtitle.alignment}`}
      >
        {subtitle.entries.map((entry) => {
          if (!entry.japanese) return null;
          return (
            <CaptionStackEntry
              key={entry.id}
              className={`caption-stack-entry overlay-caption-entry ${subtitle.background ? "with-bg" : ""} ${entry.provisional ? "is-provisional" : ""} ${entry.fading ? "is-fading" : ""}`}
            >
              <div className="caption-line overlay-line source">
                <span className="overlay-lang-tag">JA</span>
                <span className="caption-text">
                  <JapaneseText entry={entry} />
                </span>
              </div>
              {subtitle.targets.map((language) => {
                const translation = entry.translations[language];
                const style = subtitle.translationStyles[language] ?? {
                  fontSize: 20,
                  color: "#8ee8c5",
                };
                if (!translation) return null;
                return (
                  <div
                    key={language}
                    className="caption-line overlay-line translation"
                    dir={language === "ar" ? "rtl" : undefined}
                    style={{
                      color: style.color,
                      fontSize: `${style.fontSize}px`,
                    }}
                  >
                    <span className="overlay-lang-tag">
                      {language.toUpperCase()}
                    </span>
                    <span className="caption-text">{translation}</span>
                  </div>
                );
              })}
            </CaptionStackEntry>
          );
        })}
      </div>
    </main>
  );
}
