"use client";

import { useEffect, useState } from "react";
import { CaptionStackLine } from "@/components/caption-stack-line";
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
  captionStyle: "simple" | "labeled";
};
const initial: SubtitleState = {
  entries: [],
  targets: ["en"],
  japaneseFontSize: 24,
  japaneseColor: "#ffffff",
  translationStyles: { en: { fontSize: 20, color: "#8ee8c5" } },
  alignment: "center",
  verticalAlignment: "bottom",
  captionStyle: "labeled",
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

  const captionLayoutDependency = JSON.stringify({
    entries: subtitle.entries.map((entry) => ({
      id: entry.id,
      japanese: entry.japanese,
      translations: subtitle.targets.map(
        (language) => entry.translations[language] ?? "",
      ),
    })),
    targets: subtitle.targets,
    alignment: subtitle.alignment,
    verticalAlignment: subtitle.verticalAlignment,
    japaneseFontSize: subtitle.japaneseFontSize,
    captionStyle: subtitle.captionStyle,
    translationFontSizes: subtitle.targets.map(
      (language) =>
        (subtitle.translationStyles[language] ?? { fontSize: 20 }).fontSize,
    ),
  });

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
            <div
              key={entry.id}
              className={`caption-stack-entry overlay-caption-entry ${subtitle.captionStyle === "labeled" ? "with-bg" : ""} ${entry.provisional ? "is-provisional" : ""} ${entry.fading ? "is-fading" : ""}`}
            >
              <CaptionStackLine
                className="caption-motion-line"
                layoutDependency={captionLayoutDependency}
              >
                <div className="caption-line overlay-line source">
                  {subtitle.captionStyle === "labeled" && (
                    <span className="overlay-lang-tag">JA</span>
                  )}
                  <span className="caption-text">
                    <JapaneseText entry={entry} />
                  </span>
                </div>
              </CaptionStackLine>
              {subtitle.targets.map((language) => {
                const translation = entry.translations[language];
                const style = subtitle.translationStyles[language] ?? {
                  fontSize: 20,
                  color: "#8ee8c5",
                };
                if (!translation) return null;
                return (
                  <CaptionStackLine
                    key={language}
                    className="caption-motion-line"
                    layoutDependency={captionLayoutDependency}
                  >
                    <div
                      className="caption-line overlay-line translation"
                      dir={language === "ar" ? "rtl" : undefined}
                      style={{
                        color: style.color,
                        fontSize: `${style.fontSize}px`,
                      }}
                    >
                      {subtitle.captionStyle === "labeled" && (
                        <span className="overlay-lang-tag">
                          {language.toUpperCase()}
                        </span>
                      )}
                      <span className="caption-text">{translation}</span>
                    </div>
                  </CaptionStackLine>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}
