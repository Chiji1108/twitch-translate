"use client";

import { useEffect, useState } from "react";
import { CaptionStackLine } from "@/components/caption-stack-line";
import {
  getNextCaptionDeadline,
  getVisibleCaptionEntries,
} from "@/lib/caption-lifetime";
import { TRANSLATION_LANGUAGES } from "@/lib/languages";
import {
  type CaptionEntry,
  DEFAULT_TRANSLATION_STYLES,
  type SubtitleState,
} from "@/stores/caption-store";

type CaptionRendererProps = {
  subtitle: SubtitleState;
  variant: "preview" | "overlay";
  previewWidth?: number;
};

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

function useVisibleCaptionEntries(
  entries: CaptionEntry[],
  captionHoldMs: number,
) {
  const [clock, setClock] = useState(() => Date.now());
  const now = Date.now();
  const visibleEntries = getVisibleCaptionEntries(entries, captionHoldMs, now);

  useEffect(() => {
    const currentTime = Math.max(clock, Date.now());
    const nextDeadline = getNextCaptionDeadline(
      entries,
      captionHoldMs,
      currentTime,
    );
    if (nextDeadline === null) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(16, nextDeadline - currentTime + 16),
    );
    return () => window.clearTimeout(timer);
  }, [captionHoldMs, clock, entries]);

  return visibleEntries;
}

export function CaptionRenderer({
  subtitle,
  variant,
  previewWidth = 800,
}: CaptionRendererProps) {
  const visibleEntries = useVisibleCaptionEntries(
    subtitle.entries,
    subtitle.captionHoldMs,
  );
  const size = (pixels: number) =>
    variant === "preview"
      ? `${(pixels / previewWidth) * 100}cqw`
      : `${pixels}px`;
  const layoutDependency = JSON.stringify({
    entries: visibleEntries.map((entry) => ({
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
        (subtitle.translationStyles[language] ?? DEFAULT_TRANSLATION_STYLES.en)
          .fontSize,
    ),
  });

  return (
    <div
      className={`caption-renderer caption-renderer-${variant} vertical-${subtitle.verticalAlignment}`}
      style={
        {
          "--caption-entry-gap": size(14),
          "--caption-line-gap": size(8),
          "--caption-shadow-offset": size(3),
          "--caption-shadow-blur": size(5),
          "--caption-shadow-small-offset": size(1),
          "--caption-shadow-small-blur": size(2),
          "--japanese-caption-size": size(subtitle.japaneseFontSize),
          "--japanese-caption-color": subtitle.japaneseColor,
        } as React.CSSProperties
      }
    >
      <div
        className={`caption-stack caption-renderer-log align-${subtitle.alignment}`}
      >
        {visibleEntries.map((entry) => (
          <div
            key={entry.id}
            className={`caption-stack-entry caption-renderer-entry ${subtitle.captionStyle === "labeled" ? "with-bg" : ""} ${entry.provisional ? "is-provisional" : ""} ${entry.fading ? "is-fading" : ""}`}
          >
            <CaptionStackLine
              className="caption-motion-line"
              layoutDependency={layoutDependency}
            >
              <div className="caption-line rendered-caption source">
                {subtitle.captionStyle === "labeled" && (
                  <span className="caption-lang-tag">JA</span>
                )}
                <span className="caption-text">
                  <JapaneseText entry={entry} />
                </span>
              </div>
            </CaptionStackLine>
            {subtitle.targets.map((language) => {
              const text = entry.translations[language];
              if (!text) return null;
              const style =
                subtitle.translationStyles[language] ??
                DEFAULT_TRANSLATION_STYLES.en;
              const languageLabel =
                TRANSLATION_LANGUAGES.find(
                  (candidate) => candidate.code === language,
                )?.short ?? language.toUpperCase();
              return (
                <CaptionStackLine
                  key={language}
                  className="caption-motion-line"
                  layoutDependency={layoutDependency}
                >
                  <div
                    className="caption-line rendered-caption translation"
                    dir={language === "ar" ? "rtl" : undefined}
                    style={{
                      color: style.color,
                      fontSize: size(style.fontSize),
                    }}
                  >
                    {subtitle.captionStyle === "labeled" && (
                      <span className="caption-lang-tag">{languageLabel}</span>
                    )}
                    <span className="caption-text">{text}</span>
                  </div>
                </CaptionStackLine>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
