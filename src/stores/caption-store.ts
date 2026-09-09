import { create } from "zustand";
import type { FuriganaFailureDetails, FuriganaSegment } from "@/lib/furigana";
import {
  MAX_TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES,
} from "@/lib/languages";

export type SessionStatus = "idle" | "connecting" | "live" | "error";
export type CaptionAlignment = "left" | "center" | "right";
export type CaptionVerticalAlignment = "top" | "center" | "bottom";
export type CaptionStyle = "simple" | "labeled";
export type TranslationStyle = { fontSize: number; color: string };
export type ProcessingStage =
  | "idle"
  | "uploading"
  | "transcribing"
  | "generating"
  | "completed";

export type AppSettings = {
  targets: string[];
  context: string;
  sentencePauseMs: number;
  japaneseFontSize: number;
  japaneseColor: string;
  translationStyles: Record<string, TranslationStyle>;
  alignment: CaptionAlignment;
  verticalAlignment: CaptionVerticalAlignment;
  captionStyle: CaptionStyle;
  captionHoldMs: number;
};

export type CaptionEntry = {
  id: number;
  japanese: string;
  furigana: FuriganaSegment[];
  translations: Record<string, string>;
  provisional: boolean;
  completed: boolean;
  completedAt?: number;
  demo?: boolean;
};

export type SubtitleState = {
  entries: CaptionEntry[];
  targets: string[];
  japaneseFontSize: number;
  japaneseColor: string;
  translationStyles: Record<string, TranslationStyle>;
  alignment: CaptionAlignment;
  verticalAlignment: CaptionVerticalAlignment;
  captionStyle: CaptionStyle;
  captionHoldMs: number;
};

export type CaptionErrorState = {
  message: string;
  details?: FuriganaFailureDetails;
};

type StateUpdate<T> = T | ((current: T) => T);

export type CaptionStore = AppSettings & {
  status: SessionStatus;
  entries: CaptionEntry[];
  captionError: CaptionErrorState | null;
  showingDemo: boolean;
  isSpeaking: boolean;
  pendingTurns: number;
  processingStage: ProcessingStage;
  setStatus: (update: StateUpdate<SessionStatus>) => void;
  setEntries: (update: StateUpdate<CaptionEntry[]>) => void;
  setCaptionError: (update: StateUpdate<CaptionErrorState | null>) => void;
  setShowingDemo: (update: StateUpdate<boolean>) => void;
  setTargets: (update: StateUpdate<string[]>) => void;
  setContext: (update: StateUpdate<string>) => void;
  setSentencePauseMs: (update: StateUpdate<number>) => void;
  setJapaneseFontSize: (update: StateUpdate<number>) => void;
  setJapaneseColor: (update: StateUpdate<string>) => void;
  setTranslationStyles: (
    update: StateUpdate<Record<string, TranslationStyle>>,
  ) => void;
  setAlignment: (update: StateUpdate<CaptionAlignment>) => void;
  setVerticalAlignment: (update: StateUpdate<CaptionVerticalAlignment>) => void;
  setCaptionStyle: (update: StateUpdate<CaptionStyle>) => void;
  setCaptionHoldMs: (update: StateUpdate<number>) => void;
  setIsSpeaking: (update: StateUpdate<boolean>) => void;
  setPendingTurns: (update: StateUpdate<number>) => void;
  setProcessingStage: (update: StateUpdate<ProcessingStage>) => void;
  applySettings: (settings: AppSettings) => void;
  replaceSubtitleState: (subtitle: SubtitleState) => void;
  restoreDemo: () => void;
};

const DEMO_JA = "今日は最近あった出来事について話します！";
const DEMO_FURIGANA: FuriganaSegment[] = [
  { text: "今日", reading: "きょう" },
  { text: "は", reading: null },
  { text: "最近", reading: "さいきん" },
  { text: "あった", reading: null },
  { text: "出来事", reading: "できごと" },
  { text: "について", reading: null },
  { text: "話", reading: "はな" },
  { text: "します！", reading: null },
];
const DEMO_TRANSLATIONS: Record<string, string> = {
  en: "Today, I’ll talk about something that happened recently!",
  ko: "오늘은 최근에 있었던 일에 대해 이야기할게요!",
  zh: "今天来聊聊最近发生的事情！",
  "zh-TW": "今天想和大家聊聊最近發生的事！",
  "zh-HK": "今日想同大家講下最近發生嘅事！",
  es: "¡Hoy hablaré de algo que ocurrió recientemente!",
  fr: "Aujourd’hui, je vais parler de quelque chose qui s’est passé récemment !",
  de: "Heute erzähle ich von etwas, das kürzlich passiert ist!",
  it: "Oggi parlerò di qualcosa che è successo di recente!",
  "pt-BR": "Hoje vou falar sobre algo que aconteceu recentemente!",
  ru: "Сегодня я расскажу о том, что произошло недавно!",
  uk: "Сьогодні я розповім про те, що сталося нещодавно!",
  pl: "Dzisiaj opowiem o czymś, co wydarzyło się niedawno!",
  nl: "Vandaag vertel ik over iets wat onlangs is gebeurd!",
  sv: "I dag ska jag berätta om något som hände nyligen!",
  tr: "Bugün yakın zamanda yaşanan bir olaydan bahsedeceğim!",
  id: "Hari ini saya akan membahas sesuatu yang baru-baru ini terjadi!",
  vi: "Hôm nay tôi sẽ kể về một chuyện mới xảy ra gần đây!",
  th: "วันนี้จะมาเล่าเรื่องที่เพิ่งเกิดขึ้นเมื่อไม่นานมานี้!",
  ar: "سأتحدث اليوم عن شيء حدث مؤخرًا!",
  hi: "आज मैं हाल ही में हुई एक घटना के बारे में बात करूँगा!",
  el: "Σήμερα θα μιλήσω για κάτι που συνέβη πρόσφατα!",
  so: "Maanta waxaan ka hadli doonaa wax dhowaan dhacay!",
};

export const DEFAULT_SENTENCE_PAUSE_MS = 1000;
export const DEFAULT_CAPTION_HOLD_MS = 10000;
export const DEFAULT_JAPANESE_FONT_SIZE = 24;
export const MIN_JAPANESE_FONT_SIZE = 24;
export const MIN_TRANSLATION_FONT_SIZE = 16;
export const MAX_CAPTION_FONT_SIZE = 48;
export const CAPTION_FADE_MS = 500;
export const DEFAULT_JAPANESE_COLOR = "#ffffff";
export const SETTINGS_STORAGE_KEY = "miri-translator-settings-v2";
export const SUBTITLE_STORAGE_KEY = "miri-translator-subtitles-v7";
export const SUBTITLE_CHANNEL_NAME = "miri-translator-subtitles-v7";
export const MAX_CAPTION_ENTRIES = 30;
export const DEFAULT_TRANSLATION_STYLES: Record<string, TranslationStyle> =
  Object.fromEntries(
    TRANSLATION_LANGUAGES.map(({ code, color }) => [
      code,
      { fontSize: 20, color },
    ]),
  );

export function demoCaptionEntry(): CaptionEntry {
  return {
    id: 0,
    japanese: DEMO_JA,
    furigana: DEMO_FURIGANA,
    translations: DEMO_TRANSLATIONS,
    provisional: false,
    completed: true,
    demo: true,
  };
}

export function defaultTranslationStyles() {
  return Object.fromEntries(
    Object.entries(DEFAULT_TRANSLATION_STYLES).map(([language, style]) => [
      language,
      { ...style },
    ]),
  );
}

export function defaultSettings(): AppSettings {
  return {
    targets: ["en"],
    context: "",
    sentencePauseMs: DEFAULT_SENTENCE_PAUSE_MS,
    japaneseFontSize: DEFAULT_JAPANESE_FONT_SIZE,
    japaneseColor: DEFAULT_JAPANESE_COLOR,
    translationStyles: defaultTranslationStyles(),
    alignment: "center",
    verticalAlignment: "bottom",
    captionStyle: "labeled",
    captionHoldMs: DEFAULT_CAPTION_HOLD_MS,
  };
}

export function emptySubtitleState(): SubtitleState {
  const defaults = defaultSettings();
  return {
    entries: [],
    targets: defaults.targets,
    japaneseFontSize: defaults.japaneseFontSize,
    japaneseColor: defaults.japaneseColor,
    translationStyles: defaults.translationStyles,
    alignment: defaults.alignment,
    verticalAlignment: defaults.verticalAlignment,
    captionStyle: defaults.captionStyle,
    captionHoldMs: defaults.captionHoldMs,
  };
}

export function selectSubtitleState(state: CaptionStore): SubtitleState {
  return {
    entries: state.entries,
    targets: state.targets,
    japaneseFontSize: state.japaneseFontSize,
    japaneseColor: state.japaneseColor,
    translationStyles: state.translationStyles,
    alignment: state.alignment,
    verticalAlignment: state.verticalAlignment,
    captionStyle: state.captionStyle,
    captionHoldMs: state.captionHoldMs,
  };
}

export function parseSubtitleState(value: unknown): SubtitleState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleState>;
  if (
    !Array.isArray(candidate.entries) ||
    !Array.isArray(candidate.targets) ||
    typeof candidate.japaneseFontSize !== "number" ||
    typeof candidate.japaneseColor !== "string" ||
    !candidate.translationStyles ||
    typeof candidate.translationStyles !== "object" ||
    !["left", "center", "right"].includes(candidate.alignment ?? "") ||
    !["top", "center", "bottom"].includes(candidate.verticalAlignment ?? "") ||
    !["simple", "labeled"].includes(candidate.captionStyle ?? "") ||
    typeof candidate.captionHoldMs !== "number"
  ) {
    return null;
  }
  return candidate as SubtitleState;
}

export function parseStoredSettings(value: string | null): AppSettings | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as Partial<AppSettings>;
    if (!stored || typeof stored !== "object") return null;
    const defaults = defaultSettings();
    const supportedLanguages = new Set<string>(
      TRANSLATION_LANGUAGES.map(({ code }) => code),
    );
    const targets = Array.isArray(stored.targets)
      ? Array.from(
          new Set(
            stored.targets.filter(
              (language): language is string =>
                typeof language === "string" &&
                supportedLanguages.has(language),
            ),
          ),
        ).slice(0, MAX_TRANSLATION_LANGUAGES)
      : defaults.targets;
    const numberInRange = (
      candidate: unknown,
      minimum: number,
      maximum: number,
      fallback: number,
    ) =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= minimum &&
      candidate <= maximum
        ? candidate
        : fallback;
    const colorOrDefault = (candidate: unknown, fallback: string) =>
      typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate)
        ? candidate
        : fallback;
    const translationStyles = Object.fromEntries(
      TRANSLATION_LANGUAGES.map(({ code }) => {
        const savedStyle = stored.translationStyles?.[code];
        const fallback = defaults.translationStyles[code];
        return [
          code,
          {
            fontSize: numberInRange(
              savedStyle?.fontSize,
              MIN_TRANSLATION_FONT_SIZE,
              MAX_CAPTION_FONT_SIZE,
              fallback.fontSize,
            ),
            color: colorOrDefault(savedStyle?.color, fallback.color),
          },
        ];
      }),
    );

    return {
      targets: targets.length ? targets : defaults.targets,
      context:
        typeof stored.context === "string"
          ? stored.context.slice(0, 500)
          : defaults.context,
      sentencePauseMs: numberInRange(
        stored.sentencePauseMs,
        500,
        3000,
        defaults.sentencePauseMs,
      ),
      japaneseFontSize: numberInRange(
        stored.japaneseFontSize,
        MIN_JAPANESE_FONT_SIZE,
        MAX_CAPTION_FONT_SIZE,
        defaults.japaneseFontSize,
      ),
      japaneseColor: colorOrDefault(
        stored.japaneseColor,
        defaults.japaneseColor,
      ),
      translationStyles,
      alignment: ["left", "center", "right"].includes(stored.alignment ?? "")
        ? (stored.alignment as CaptionAlignment)
        : defaults.alignment,
      verticalAlignment: ["top", "center", "bottom"].includes(
        stored.verticalAlignment ?? "",
      )
        ? (stored.verticalAlignment as CaptionVerticalAlignment)
        : defaults.verticalAlignment,
      captionStyle: ["simple", "labeled"].includes(stored.captionStyle ?? "")
        ? (stored.captionStyle as CaptionStyle)
        : defaults.captionStyle,
      captionHoldMs: numberInRange(
        stored.captionHoldMs,
        3000,
        30000,
        defaults.captionHoldMs,
      ),
    };
  } catch {
    return null;
  }
}

function resolveUpdate<T>(update: StateUpdate<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

const initialSettings = defaultSettings();

export const useCaptionStore = create<CaptionStore>((set) => ({
  ...initialSettings,
  status: "idle",
  entries: [demoCaptionEntry()],
  captionError: null,
  showingDemo: true,
  isSpeaking: false,
  pendingTurns: 0,
  processingStage: "idle",
  setStatus: (update) =>
    set((state) => ({ status: resolveUpdate(update, state.status) })),
  setEntries: (update) =>
    set((state) => ({ entries: resolveUpdate(update, state.entries) })),
  setCaptionError: (update) =>
    set((state) => ({
      captionError: resolveUpdate(update, state.captionError),
    })),
  setShowingDemo: (update) =>
    set((state) => ({
      showingDemo: resolveUpdate(update, state.showingDemo),
    })),
  setTargets: (update) =>
    set((state) => ({ targets: resolveUpdate(update, state.targets) })),
  setContext: (update) =>
    set((state) => ({ context: resolveUpdate(update, state.context) })),
  setSentencePauseMs: (update) =>
    set((state) => ({
      sentencePauseMs: resolveUpdate(update, state.sentencePauseMs),
    })),
  setJapaneseFontSize: (update) =>
    set((state) => ({
      japaneseFontSize: resolveUpdate(update, state.japaneseFontSize),
    })),
  setJapaneseColor: (update) =>
    set((state) => ({
      japaneseColor: resolveUpdate(update, state.japaneseColor),
    })),
  setTranslationStyles: (update) =>
    set((state) => ({
      translationStyles: resolveUpdate(update, state.translationStyles),
    })),
  setAlignment: (update) =>
    set((state) => ({ alignment: resolveUpdate(update, state.alignment) })),
  setVerticalAlignment: (update) =>
    set((state) => ({
      verticalAlignment: resolveUpdate(update, state.verticalAlignment),
    })),
  setCaptionStyle: (update) =>
    set((state) => ({
      captionStyle: resolveUpdate(update, state.captionStyle),
    })),
  setCaptionHoldMs: (update) =>
    set((state) => ({
      captionHoldMs: resolveUpdate(update, state.captionHoldMs),
    })),
  setIsSpeaking: (update) =>
    set((state) => ({
      isSpeaking: resolveUpdate(update, state.isSpeaking),
    })),
  setPendingTurns: (update) =>
    set((state) => ({
      pendingTurns: resolveUpdate(update, state.pendingTurns),
    })),
  setProcessingStage: (update) =>
    set((state) => ({
      processingStage: resolveUpdate(update, state.processingStage),
    })),
  applySettings: (settings) => set(settings),
  replaceSubtitleState: (subtitle) => set(subtitle),
  restoreDemo: () =>
    set({
      entries: [demoCaptionEntry()],
      showingDemo: true,
      captionError: null,
    }),
}));
