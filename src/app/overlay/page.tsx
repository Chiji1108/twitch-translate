"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CaptionStackLine } from "@/components/caption-stack-line";
import {
  type CaptionEntry,
  emptySubtitleState,
  SUBTITLE_CHANNEL_NAME,
  SUBTITLE_STORAGE_KEY,
  type SubtitleState,
  useCaptionStore,
} from "@/stores/caption-store";

function JapaneseText({ entry }: { entry: CaptionEntry }) {
  if (!entry.furigana.length) return entry.japanese;
  let offset = 0;
  return entry.furigana.map((segment) => {
    const key = `${offset}-${segment.text}`;
    offset += segment.text.length;
    return segment.reading ? (
      <ruby key={key}>
        {segment.text}
        <rt>{segment.reading}</rt>
      </ruby>
    ) : (
      <span key={key}>{segment.text}</span>
    );
  });
}

export default function Overlay() {
  const [overlayReady, setOverlayReady] = useState(false);
  const {
    entries,
    targets,
    japaneseFontSize,
    japaneseColor,
    translationStyles,
    alignment,
    verticalAlignment,
    captionStyle,
    replaceSubtitleState,
  } = useCaptionStore(
    useShallow((state) => ({
      entries: state.entries,
      targets: state.targets,
      japaneseFontSize: state.japaneseFontSize,
      japaneseColor: state.japaneseColor,
      translationStyles: state.translationStyles,
      alignment: state.alignment,
      verticalAlignment: state.verticalAlignment,
      captionStyle: state.captionStyle,
      replaceSubtitleState: state.replaceSubtitleState,
    })),
  );
  const subtitle: SubtitleState = {
    entries: overlayReady ? entries : [],
    targets,
    japaneseFontSize,
    japaneseColor,
    translationStyles,
    alignment,
    verticalAlignment,
    captionStyle,
  };

  useEffect(() => {
    const saved = localStorage.getItem(SUBTITLE_STORAGE_KEY);
    replaceSubtitleState(
      saved ? (JSON.parse(saved) as SubtitleState) : emptySubtitleState(),
    );
    setOverlayReady(true);
    const channel = new BroadcastChannel(SUBTITLE_CHANNEL_NAME);
    channel.onmessage = (event) =>
      replaceSubtitleState(event.data as SubtitleState);
    const sync = (event: StorageEvent) => {
      if (event.key === SUBTITLE_STORAGE_KEY && event.newValue)
        replaceSubtitleState(JSON.parse(event.newValue) as SubtitleState);
    };
    window.addEventListener("storage", sync);
    return () => {
      channel.close();
      window.removeEventListener("storage", sync);
    };
  }, [replaceSubtitleState]);

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
