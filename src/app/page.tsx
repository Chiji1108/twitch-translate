"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CaptionRenderer } from "@/components/caption-renderer";
import { ObsWebSocketPanel } from "@/components/obs-websocket-panel";
import type { FuriganaFailureDetails, FuriganaSegment } from "@/lib/furigana";
import { normalizeJapanesePunctuation } from "@/lib/japanese-text";
import {
  MAX_TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES,
} from "@/lib/languages";
import {
  addCaptionUsage,
  addLiveTranscriptionUsage,
  type CaptionUsagePayload,
  emptySessionUsage,
  estimateSessionCost,
  formatEstimatedUsd,
  type OpenAIUsage,
} from "@/lib/usage-cost";
import {
  type AppSettings,
  type CaptionErrorState,
  DEFAULT_TRANSLATION_STYLES,
  defaultSettings,
  MAX_CAPTION_ENTRIES,
  parseStoredSettings,
  SETTINGS_STORAGE_KEY,
  SUBTITLE_CHANNEL_NAME,
  SUBTITLE_STORAGE_KEY,
  type SubtitleState,
  type TranslationStyle,
  useCaptionStore,
} from "@/stores/caption-store";

type QueuedAudioTurn = { id: number; audio: Blob };
type CaptionPipelineErrorDetails = FuriganaFailureDetails & {
  stage?: "transcription" | "caption_generation";
};
type CaptionStreamEvent = {
  type?:
    | "progress"
    | "transcription"
    | "translation"
    | "furigana"
    | "completed"
    | "skipped"
    | "error";
  stage?: "transcribing" | "generating";
  japanese?: string;
  language?: string;
  text?: string;
  translations?: Record<string, string>;
  furigana?: FuriganaSegment[];
  reason?: string;
  error?: string;
  details?: CaptionPipelineErrorDetails;
  usage?: CaptionUsagePayload;
};
type RealtimeTranscriptionPeer = {
  connection: RTCPeerConnection;
  events: RTCDataChannel;
};
type RealtimeTranscriptionEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  usage?: OpenAIUsage;
  error?: { message?: string };
};
type AudioCaptureWorkletMessage =
  | { type: "speech-start" }
  | { type: "discard" }
  | { type: "turn"; samples: ArrayBuffer; sampleRate: number };
const LANGUAGES = TRANSLATION_LANGUAGES;
const PREVIEW_WIDTH = 800;
const PREVIEW_HEIGHT = 400;
const API_KEY_STORAGE_KEY = "miri-translator-openai-api-key-v1";

function waitForRealtimePeer(
  connection: RTCPeerConnection,
  events: RTCDataChannel,
  signal: AbortSignal,
) {
  if (
    connection.connectionState === "connected" &&
    events.readyState === "open"
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      connection.removeEventListener("connectionstatechange", check);
      events.removeEventListener("open", check);
      signal.removeEventListener("abort", handleAbort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const check = () => {
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "closed"
      ) {
        fail("Realtime文字起こしへ接続できませんでした");
      } else if (
        connection.connectionState === "connected" &&
        events.readyState === "open"
      ) {
        finish();
      }
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(
      () => fail("Realtime文字起こしの接続がタイムアウトしました"),
      8000,
    );

    connection.addEventListener("connectionstatechange", check);
    events.addEventListener("open", check);
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }
    check();
  });
}

async function createRealtimeTranscriptionPeer({
  audioTrack,
  apiKey,
  context,
  signal,
  onTranscript,
  onUsage,
}: {
  audioTrack: MediaStreamTrack;
  apiKey: string;
  context: string;
  signal: AbortSignal;
  onTranscript: (itemId: string, transcript: string) => void;
  onUsage: (usage: OpenAIUsage) => void;
}) {
  const secretResponse = await fetch("/api/realtime-transcription-session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ context }),
    signal,
  });
  const secretData = (await secretResponse.json()) as {
    value?: string;
    error?: string;
  };
  if (!secretResponse.ok || !secretData.value) {
    throw new Error(
      secretData.error ?? "Realtime文字起こしの認証情報を取得できませんでした",
    );
  }

  const connection = new RTCPeerConnection();
  try {
    connection.addTrack(audioTrack);
    connection.ontrack = ({ track }) => {
      track.enabled = false;
    };
    const events = connection.createDataChannel("oai-events");
    const transcripts = new Map<string, string>();
    events.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(String(data)) as RealtimeTranscriptionEvent;
        if (
          event.type === "conversation.item.input_audio_transcription.delta" &&
          typeof event.item_id === "string" &&
          typeof event.delta === "string"
        ) {
          const transcript =
            (transcripts.get(event.item_id) ?? "") + event.delta;
          transcripts.set(event.item_id, transcript);
          onTranscript(event.item_id, transcript);
        } else if (
          event.type ===
            "conversation.item.input_audio_transcription.completed" &&
          typeof event.item_id === "string" &&
          typeof event.transcript === "string"
        ) {
          transcripts.set(event.item_id, event.transcript);
          onTranscript(event.item_id, event.transcript);
          if (event.usage) onUsage(event.usage);
        } else if (event.type === "error") {
          console.warn(
            "Realtime transcription event:",
            event.error?.message ?? event,
          );
        }
      } catch (reason) {
        console.warn("Realtime transcription event parse failed:", reason);
      }
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const sdpResponse = await fetch(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretData.value}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
        signal,
      },
    );
    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }
    await connection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text(),
    });
    await waitForRealtimePeer(connection, events, signal);

    return { connection, events } satisfies RealtimeTranscriptionPeer;
  } catch (reason) {
    connection.close();
    throw reason;
  }
}

function encodeMonoWav(chunks: Float32Array[], sampleRate: number) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function formatPauseDuration(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}秒`;
}

const FURIGANA_ERROR_CATEGORY_LABELS: Record<
  FuriganaFailureDetails["category"],
  string
> = {
  openai_api: "OpenAI APIリクエスト",
  openai_response: "OpenAI応答状態",
  structured_output: "Structured Outputsの解析",
  validation: "サーバー側の出力検証",
  client_validation: "ブラウザ側の出力検証",
  network: "ネットワーク通信",
  server: "アプリサーバー",
};

function CaptionErrorPanel({ error }: { error: CaptionErrorState }) {
  const details = error.details;
  const rows: Array<[string, string | number | undefined]> = details
    ? [
        ["分類", FURIGANA_ERROR_CATEGORY_LABELS[details.category]],
        ["HTTP", details.httpStatus],
        ["エラーコード", details.code],
        ["エラー種別", details.type],
        ["対象パラメータ", details.param],
        ["応答状態", details.responseStatus],
        ["未完了理由", details.incompleteReason],
        ["検証コード", details.validationCode],
        ["対象言語", details.language],
        [
          "検証位置",
          details.validationIndex === undefined
            ? undefined
            : `${details.validationIndex + 1}番目`,
        ],
        ["モデル", details.model],
        ["Request ID", details.requestId],
        ["Response ID", details.responseId],
        ["モデル出力", details.modelOutput],
      ]
    : [];

  return (
    <div className="furigana-error" role="alert">
      <b>字幕生成エラー</b>
      <p>{error.message}</p>
      {rows.some(([, value]) => value !== undefined) && (
        <dl>
          {rows.map(([label, value]) =>
            value === undefined ? null : (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ),
          )}
        </dl>
      )}
    </div>
  );
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    external: (
      <>
        <path d="M15 3h6v6M10 14 21 3" />
        <path d="M18 13v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h7" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Z" />
        <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [rememberApiKey, setRememberApiKey] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const {
    status,
    setStatus,
    targets,
    setTargets,
    entries: captionEntries,
    setEntries: setCaptionEntries,
    captionError,
    setCaptionError,
    showingDemo,
    setShowingDemo,
    japaneseFontSize,
    setJapaneseFontSize,
    japaneseColor,
    setJapaneseColor,
    translationStyles,
    setTranslationStyles,
    alignment,
    setAlignment,
    verticalAlignment,
    setVerticalAlignment,
    captionStyle,
    setCaptionStyle,
    captionHoldMs,
    setCaptionHoldMs,
    context,
    setContext,
    sentencePauseMs,
    setSentencePauseMs,
    isSpeaking,
    setIsSpeaking,
    pendingTurns,
    setPendingTurns,
    processingStage,
    setProcessingStage,
    applySettings,
    restoreDemo,
  } = useCaptionStore(
    useShallow((state) => ({
      status: state.status,
      setStatus: state.setStatus,
      targets: state.targets,
      setTargets: state.setTargets,
      entries: state.entries,
      setEntries: state.setEntries,
      captionError: state.captionError,
      setCaptionError: state.setCaptionError,
      showingDemo: state.showingDemo,
      setShowingDemo: state.setShowingDemo,
      japaneseFontSize: state.japaneseFontSize,
      setJapaneseFontSize: state.setJapaneseFontSize,
      japaneseColor: state.japaneseColor,
      setJapaneseColor: state.setJapaneseColor,
      translationStyles: state.translationStyles,
      setTranslationStyles: state.setTranslationStyles,
      alignment: state.alignment,
      setAlignment: state.setAlignment,
      verticalAlignment: state.verticalAlignment,
      setVerticalAlignment: state.setVerticalAlignment,
      captionStyle: state.captionStyle,
      setCaptionStyle: state.setCaptionStyle,
      captionHoldMs: state.captionHoldMs,
      setCaptionHoldMs: state.setCaptionHoldMs,
      context: state.context,
      setContext: state.setContext,
      sentencePauseMs: state.sentencePauseMs,
      setSentencePauseMs: state.setSentencePauseMs,
      isSpeaking: state.isSpeaking,
      setIsSpeaking: state.setIsSpeaking,
      pendingTurns: state.pendingTurns,
      setPendingTurns: state.setPendingTurns,
      processingStage: state.processingStage,
      setProcessingStage: state.setProcessingStage,
      applySettings: state.applySettings,
      restoreDemo: state.restoreDemo,
    })),
  );
  const [error, setError] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasCostSession, setHasCostSession] = useState(false);
  const [sessionUsage, setSessionUsage] = useState(emptySessionUsage);
  const [liveConnectionSeconds, setLiveConnectionSeconds] = useState(0);
  const [trackingRealtimeCost, setTrackingRealtimeCost] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioCaptureWorkletRef = useRef<AudioWorkletNode | null>(null);
  const audioTurnQueueRef = useRef<QueuedAudioTurn[]>([]);
  const processingQueueRef = useRef(false);
  const pipelineGenerationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const nextTurnIdRef = useRef(0);
  const realtimeTranscriptionRef = useRef<RealtimeTranscriptionPeer | null>(
    null,
  );
  const realtimeAbortRef = useRef<AbortController | null>(null);
  const realtimeCommitTimerRef = useRef<number | null>(null);
  const realtimeSpeechInBufferRef = useRef(false);
  const realtimeItemTurnMapRef = useRef(new Map<string, number>());
  const pendingRealtimeTurnIdsRef = useRef<number[]>([]);
  const realtimeCostStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY)?.trim();
      if (savedApiKey) {
        setApiKey(savedApiKey);
        setRememberApiKey(true);
      }
    } catch {
      // Storage may be unavailable in private or restricted browser contexts.
    }

    try {
      const saved = parseStoredSettings(
        localStorage.getItem(SETTINGS_STORAGE_KEY),
      );
      if (saved) {
        applySettings(saved);
      }
    } catch {
      // Use defaults when storage is unavailable.
    } finally {
      setSettingsLoaded(true);
    }
  }, [applySettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const settings: AppSettings = {
      targets,
      context,
      sentencePauseMs,
      japaneseFontSize,
      japaneseColor,
      translationStyles,
      alignment,
      verticalAlignment,
      captionStyle,
      captionHoldMs,
    };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // The app remains usable when storage is unavailable.
    }
  }, [
    settingsLoaded,
    targets,
    context,
    sentencePauseMs,
    japaneseFontSize,
    japaneseColor,
    translationStyles,
    alignment,
    verticalAlignment,
    captionStyle,
    captionHoldMs,
  ]);

  const closeRealtimeTranscription = useCallback(() => {
    realtimeAbortRef.current?.abort();
    realtimeAbortRef.current = null;
    const peer = realtimeTranscriptionRef.current;
    realtimeTranscriptionRef.current = null;
    peer?.events.close();
    peer?.connection.close();
    if (realtimeCommitTimerRef.current !== null) {
      window.clearInterval(realtimeCommitTimerRef.current);
      realtimeCommitTimerRef.current = null;
    }
    realtimeSpeechInBufferRef.current = false;
    realtimeItemTurnMapRef.current.clear();
    pendingRealtimeTurnIdsRef.current = [];
  }, []);

  const commitRealtimeTranscription = useCallback(() => {
    const events = realtimeTranscriptionRef.current?.events;
    if (events?.readyState !== "open") return;
    events.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }, []);

  const hasCompletedCaption = captionEntries.some(
    (entry) => entry.completed && Boolean(entry.japanese),
  );

  const updateProvisionalJapanese = useCallback(
    (itemId: string, transcript: string) => {
      let turnId = realtimeItemTurnMapRef.current.get(itemId);
      if (turnId === undefined) {
        turnId = pendingRealtimeTurnIdsRef.current.shift();
        if (turnId === undefined) return;
        realtimeItemTurnMapRef.current.set(itemId, turnId);
      }
      const trimmed = transcript.trim();
      if (!trimmed) return;
      const normalized = normalizeJapanesePunctuation(trimmed).slice(0, 700);
      setCaptionEntries((current) =>
        current.map((entry) =>
          entry.id === turnId && entry.provisional
            ? { ...entry, japanese: normalized }
            : entry,
        ),
      );
    },
    [setCaptionEntries],
  );

  useEffect(() => {
    audioCaptureWorkletRef.current?.port.postMessage({
      type: "configure",
      pauseMs: sentencePauseMs,
    });
  }, [sentencePauseMs]);

  useEffect(() => {
    if (!trackingRealtimeCost) return;
    const updateElapsedTime = () => {
      const startedAt = realtimeCostStartedAtRef.current;
      if (startedAt === null) return;
      setLiveConnectionSeconds((performance.now() - startedAt) / 1000);
    };
    updateElapsedTime();
    const timer = window.setInterval(updateElapsedTime, 500);
    return () => window.clearInterval(timer);
  }, [trackingRealtimeCost]);

  const recordLiveUsage = useCallback((usage: OpenAIUsage) => {
    setSessionUsage((current) => addLiveTranscriptionUsage(current, usage));
  }, []);

  const recordCaptionUsage = useCallback((usage?: CaptionUsagePayload) => {
    setSessionUsage((current) => addCaptionUsage(current, usage));
  }, []);

  useEffect(() => {
    const state: SubtitleState = {
      entries: captionEntries,
      targets,
      japaneseFontSize,
      japaneseColor,
      translationStyles,
      alignment,
      verticalAlignment,
      captionStyle,
      captionHoldMs,
    };
    try {
      localStorage.setItem(SUBTITLE_STORAGE_KEY, JSON.stringify(state));
      const channel = new BroadcastChannel(SUBTITLE_CHANNEL_NAME);
      channel.postMessage(state);
      channel.close();
    } catch {
      // Preview remains usable when cross-window storage is unavailable.
    }
  }, [
    captionEntries,
    targets,
    japaneseFontSize,
    japaneseColor,
    translationStyles,
    alignment,
    verticalAlignment,
    captionStyle,
    captionHoldMs,
  ]);

  const stop = useCallback(
    (shouldRestoreDemo = false) => {
      const realtimeCostStartedAt = realtimeCostStartedAtRef.current;
      if (realtimeCostStartedAt !== null) {
        setLiveConnectionSeconds(
          (performance.now() - realtimeCostStartedAt) / 1000,
        );
      }
      realtimeCostStartedAtRef.current = null;
      setTrackingRealtimeCost(false);
      pipelineGenerationRef.current += 1;
      activeRequestRef.current?.abort();
      closeRealtimeTranscription();
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      audioCaptureWorkletRef.current?.port.postMessage({ type: "stop" });
      audioCaptureWorkletRef.current?.port.close();
      audioCaptureWorkletRef.current?.disconnect();
      void audioContextRef.current?.close();
      streamRef.current = null;
      audioContextRef.current = null;
      audioCaptureWorkletRef.current = null;
      activeRequestRef.current = null;
      audioTurnQueueRef.current = [];
      processingQueueRef.current = false;
      realtimeItemTurnMapRef.current.clear();
      pendingRealtimeTurnIdsRef.current = [];
      setPendingTurns(0);
      setIsSpeaking(false);
      setProcessingStage("idle");
      setStatus("idle");

      if (shouldRestoreDemo) {
        restoreDemo();
      }
    },
    [
      closeRealtimeTranscription,
      restoreDemo,
      setIsSpeaking,
      setPendingTurns,
      setProcessingStage,
      setStatus,
    ],
  );

  useEffect(() => () => stop(false), [stop]);

  const toggleTarget = (language: string) => {
    if (isLive) return;
    setTargets((current) => {
      if (current.includes(language)) {
        return current.length === 1
          ? current
          : current.filter((code) => code !== language);
      }
      if (current.length >= MAX_TRANSLATION_LANGUAGES) return current;
      return [...current, language];
    });
  };

  const updateTranslationStyle = (
    language: string,
    patch: Partial<TranslationStyle>,
  ) => {
    setTranslationStyles((current) => ({
      ...current,
      [language]: {
        ...(DEFAULT_TRANSLATION_STYLES[language] ??
          DEFAULT_TRANSLATION_STYLES.en),
        ...current[language],
        ...patch,
      },
    }));
  };

  const resetSettings = () => {
    if (isLive) return;
    const defaults = defaultSettings();
    applySettings(defaults);
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // State is still reset even when storage is unavailable.
    }
  };

  const start = async () => {
    const requestedApiKey = apiKey.trim();
    if (requestedApiKey.length < 20) {
      setError("OpenAI API Keyを入力してください");
      return;
    }
    stop();
    setHasCostSession(true);
    setSessionUsage(emptySessionUsage());
    setLiveConnectionSeconds(0);
    setStatus("connecting");
    setError("");
    if (showingDemo) {
      setCaptionEntries([]);
    }
    setShowingDemo(false);
    setCaptionError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const generation = pipelineGenerationRef.current;
      const forgetRealtimeTurn = (turnId: number) => {
        for (const [itemId, mappedTurnId] of realtimeItemTurnMapRef.current) {
          if (mappedTurnId === turnId) {
            realtimeItemTurnMapRef.current.delete(itemId);
          }
        }
      };

      const processQueue = async () => {
        if (processingQueueRef.current) return;
        processingQueueRef.current = true;

        while (
          audioTurnQueueRef.current.length &&
          generation === pipelineGenerationRef.current
        ) {
          const turn = audioTurnQueueRef.current.shift();
          if (!turn) break;

          const controller = new AbortController();
          activeRequestRef.current = controller;
          setPendingTurns(audioTurnQueueRef.current.length + 1);

          const formData = new FormData();
          formData.append("audio", turn.audio, `subtitle-turn-${turn.id}.wav`);
          formData.append("targetLanguages", JSON.stringify(targets));
          formData.append("context", context.trim());

          try {
            setProcessingStage("uploading");
            const response = await fetch("/api/captions", {
              method: "POST",
              headers: { Authorization: `Bearer ${requestedApiKey}` },
              body: formData,
              signal: controller.signal,
            });
            if (!response.ok || !response.body) {
              throw new Error(`字幕APIエラー（HTTP ${response.status}）`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let turnFinished = false;

            const handleEvent = (event: CaptionStreamEvent) => {
              if (
                (event.type === "completed" || event.type === "skipped") &&
                event.usage
              ) {
                recordCaptionUsage(event.usage);
              }
              if (event.type === "progress" && event.stage) {
                setProcessingStage(event.stage);
                return;
              }
              if (event.type === "transcription" && event.japanese) {
                setCaptionEntries((current) =>
                  current.map((entry) =>
                    entry.id === turn.id
                      ? {
                          ...entry,
                          japanese: event.japanese ?? entry.japanese,
                          furigana: [],
                          provisional: false,
                        }
                      : entry,
                  ),
                );
                setError("");
                return;
              }
              if (
                event.type === "translation" &&
                event.language &&
                event.text
              ) {
                setCaptionEntries((current) =>
                  current.map((entry) =>
                    entry.id === turn.id
                      ? {
                          ...entry,
                          translations: {
                            ...entry.translations,
                            [event.language as string]: event.text as string,
                          },
                        }
                      : entry,
                  ),
                );
                return;
              }
              if (event.type === "furigana" && event.furigana) {
                setCaptionEntries((current) =>
                  current.map((entry) =>
                    entry.id === turn.id
                      ? { ...entry, furigana: event.furigana ?? [] }
                      : entry,
                  ),
                );
                return;
              }
              if (event.type === "skipped" && event.reason === "no_speech") {
                turnFinished = true;
                forgetRealtimeTurn(turn.id);
                setCaptionEntries((current) =>
                  current.filter((entry) => entry.id !== turn.id),
                );
                setProcessingStage("idle");
                setError("");
                setCaptionError(null);
                return;
              }
              if (
                event.type === "completed" &&
                event.japanese &&
                event.translations
              ) {
                turnFinished = true;
                forgetRealtimeTurn(turn.id);
                setCaptionEntries((current) =>
                  current.map((entry) =>
                    entry.id === turn.id
                      ? {
                          ...entry,
                          japanese: event.japanese ?? entry.japanese,
                          translations:
                            event.translations ?? entry.translations,
                          furigana: event.furigana ?? entry.furigana,
                          provisional: false,
                          completed: true,
                          completedAt: Date.now(),
                        }
                      : entry,
                  ),
                );
                setProcessingStage("completed");
                setCaptionError(null);
                setError("");
                return;
              }
              if (event.type === "error") {
                turnFinished = true;
                forgetRealtimeTurn(turn.id);
                setProcessingStage("idle");
                setCaptionEntries((current) =>
                  current
                    .map((entry) =>
                      entry.id === turn.id && entry.japanese
                        ? {
                            ...entry,
                            completed: true,
                            completedAt: Date.now(),
                          }
                        : entry,
                    )
                    .filter((entry) => entry.id !== turn.id || entry.japanese),
                );
                setError(event.error ?? "字幕の生成に失敗しました");
                setCaptionError({
                  message: event.error ?? "字幕の生成に失敗しました",
                  details: event.details ?? { category: "server" },
                });
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              buffer += decoder.decode(value, { stream: !done });
              const lines = buffer.split("\n");
              buffer = done ? "" : (lines.pop() ?? "");
              for (const line of lines) {
                if (line.trim()) handleEvent(JSON.parse(line));
              }
              if (done) break;
            }

            if (generation !== pipelineGenerationRef.current) break;
            if (!turnFinished) {
              throw new Error("字幕APIの応答が途中で終了しました");
            }
          } catch (reason) {
            if (
              reason instanceof DOMException &&
              reason.name === "AbortError"
            ) {
              break;
            }
            forgetRealtimeTurn(turn.id);
            setCaptionEntries((current) =>
              current
                .map((entry) =>
                  entry.id === turn.id && entry.japanese
                    ? {
                        ...entry,
                        provisional: false,
                        completed: true,
                        completedAt: Date.now(),
                      }
                    : entry,
                )
                .filter((entry) => entry.id !== turn.id || entry.japanese),
            );
            setProcessingStage("idle");
            setError(
              reason instanceof Error
                ? reason.message
                : "字幕APIへ接続できませんでした",
            );
            setCaptionError({
              message:
                reason instanceof Error
                  ? reason.message
                  : "字幕APIへ接続できませんでした",
              details: { category: "network" },
            });
          } finally {
            activeRequestRef.current = null;
            setPendingTurns(audioTurnQueueRef.current.length);
          }
        }

        processingQueueRef.current = false;
        setPendingTurns(0);
      };

      const enqueueTurn = (id: number, audio: Blob) => {
        audioTurnQueueRef.current.push({
          id,
          audio,
        });
        setPendingTurns(
          audioTurnQueueRef.current.length +
            (processingQueueRef.current ? 1 : 0),
        );
        void processQueue();
      };

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      if (
        !audioContext.audioWorklet ||
        typeof AudioWorkletNode === "undefined"
      ) {
        throw new Error(
          "このブラウザはバックグラウンド録音に必要なAudioWorkletに対応していません",
        );
      }
      await audioContext.audioWorklet.addModule("/audio-capture-worklet.js");
      if (generation !== pipelineGenerationRef.current) return;
      const source = audioContext.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(audioContext, "miri-audio-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          pauseMs: sentencePauseMs,
          threshold: 0.025,
          preRollMs: 400,
          minimumVoiceMs: 80,
        },
      });
      source.connect(capture);
      capture.connect(audioContext.destination);
      audioCaptureWorkletRef.current = capture;
      if (audioContext.state === "suspended") await audioContext.resume();

      const realtimeTrack = stream.getAudioTracks()[0];
      if (realtimeTrack) {
        const realtimeController = new AbortController();
        realtimeAbortRef.current = realtimeController;
        try {
          const peer = await createRealtimeTranscriptionPeer({
            audioTrack: realtimeTrack,
            apiKey: requestedApiKey,
            context: context.trim(),
            signal: realtimeController.signal,
            onTranscript: updateProvisionalJapanese,
            onUsage: recordLiveUsage,
          });
          if (generation !== pipelineGenerationRef.current) {
            peer.events.close();
            peer.connection.close();
            return;
          }
          realtimeTranscriptionRef.current = peer;
          realtimeCostStartedAtRef.current = performance.now();
          setTrackingRealtimeCost(true);
          realtimeCommitTimerRef.current = window.setInterval(() => {
            if (!realtimeSpeechInBufferRef.current) {
              commitRealtimeTranscription();
            }
          }, 30000);
        } catch (reason) {
          if (
            !(reason instanceof DOMException) ||
            reason.name !== "AbortError"
          ) {
            console.warn(
              "Realtime provisional transcription setup failed:",
              reason,
            );
          }
        } finally {
          if (realtimeAbortRef.current === realtimeController) {
            realtimeAbortRef.current = null;
          }
        }
      }

      if (generation !== pipelineGenerationRef.current) return;
      let currentTurnId: number | null = null;
      capture.port.onmessage = (
        event: MessageEvent<AudioCaptureWorkletMessage>,
      ) => {
        if (generation !== pipelineGenerationRef.current) return;
        const message = event.data;

        if (message.type === "speech-start") {
          if (currentTurnId === null) {
            const newTurnId = ++nextTurnIdRef.current;
            currentTurnId = newTurnId;
            pendingRealtimeTurnIdsRef.current.push(newTurnId);
            setCaptionEntries((current) =>
              [
                ...current.filter((entry) => !entry.demo),
                {
                  id: newTurnId,
                  japanese: "",
                  furigana: [],
                  translations: {},
                  provisional: true,
                  completed: false,
                },
              ].slice(-MAX_CAPTION_ENTRIES),
            );
            setIsSpeaking(true);
          }
          realtimeSpeechInBufferRef.current = true;
          return;
        }

        if (message.type === "turn" && currentTurnId !== null) {
          const audioSamples = new Float32Array(message.samples);
          if (audioSamples.length > 0) {
            enqueueTurn(
              currentTurnId,
              encodeMonoWav([audioSamples], message.sampleRate),
            );
          }
        } else if (message.type === "discard" && currentTurnId !== null) {
          const discardedTurnId = currentTurnId;
          forgetRealtimeTurn(discardedTurnId);
          setCaptionEntries((current) =>
            current.filter((entry) => entry.id !== discardedTurnId),
          );
        }

        currentTurnId = null;
        setIsSpeaking(false);
        commitRealtimeTranscription();
        realtimeSpeechInBufferRef.current = false;
      };
      setStatus("live");
    } catch (reason) {
      stop();
      setStatus("error");
      setError(
        reason instanceof Error
          ? reason.message
          : "マイクを開始できませんでした",
      );
    }
  };
  const isLive = status === "live" || status === "connecting";
  const hasApiKey = apiKey.trim().length >= 20;
  const sessionCosts = estimateSessionCost(sessionUsage, liveConnectionSeconds);
  const normalizedLanguageQuery = languageQuery.trim().toLocaleLowerCase();
  const visibleLanguageOptions = [...LANGUAGES]
    .sort(
      (left, right) =>
        Number(targets.includes(right.code)) -
        Number(targets.includes(left.code)),
    )
    .filter((language) =>
      `${language.name} ${language.code} ${language.short}`
        .toLocaleLowerCase()
        .includes(normalizedLanguageQuery),
    );
  const queuedTurns = Math.max(0, pendingTurns - 1);
  const queueLabel = queuedTurns > 0 ? ` · あと${queuedTurns}文` : "";
  const processingLabel = (() => {
    if (isSpeaking && !hasCompletedCaption) {
      return "音声をリアルタイム認識中";
    }
    if (isSpeaking && hasCompletedCaption) {
      return "前の字幕を残したまま、次の発話を収録中";
    }
    switch (processingStage) {
      case "uploading":
        return `音声を送信中${queueLabel}`;
      case "transcribing":
        return `日本語を文字起こし中${queueLabel}`;
      case "generating":
        return `翻訳・ふりがなを生成中${queueLabel}`;
      case "completed":
        return `字幕を表示しました${queueLabel}`;
      default:
        return "前の字幕を残したまま、次の発話を待っています";
    }
  })();
  const previewSubtitle: SubtitleState = {
    entries: captionEntries,
    targets,
    japaneseFontSize,
    japaneseColor,
    translationStyles,
    alignment,
    verticalAlignment,
    captionStyle,
    captionHoldMs,
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="Miri Translator by ミリちゃんねる ホーム"
        >
          <span className="brand-mark">
            <Icon name="spark" size={21} />
          </span>
          <span className="brand-copy">
            <strong>Miri Translator</strong>
            <small>by ミリちゃんねる</small>
          </span>
          <span className="beta">BETA</span>
        </a>
        <div className="model-pill">
          <span className="model-dot" /> GPT-Live-Transcribe + GPT-Transcribe
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span /> FOR JAPANESE STREAMERS
        </div>
        <h1>
          日本語の配信に、
          <br />
          <em>精度重視の翻訳字幕を。</em>
        </h1>
        <p>
          日本語を学ぶ海外の視聴者に見てもらいたい。
          <br />
          ふりがな付き日本語字幕と翻訳を届ける、精度重視の配信字幕ツール。
        </p>
      </section>

      <section className="workspace">
        <div className="studio-card">
          <div className="card-header">
            <div>
              <span className="step">01</span>
              <h2>AI・翻訳設定</h2>
            </div>
          </div>

          <div className="controls-grid">
            <div className="field wide-field api-key-field">
              <label htmlFor="openai-api-key" className="api-key-label">
                OpenAI API Key <small>必須</small>
              </label>
              <input
                id="openai-api-key"
                type="password"
                name="openai-api-key"
                value={apiKey}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKey(value);
                  setError("");
                  if (rememberApiKey) {
                    try {
                      if (value.trim()) {
                        localStorage.setItem(API_KEY_STORAGE_KEY, value.trim());
                      } else {
                        localStorage.removeItem(API_KEY_STORAGE_KEY);
                        setRememberApiKey(false);
                      }
                    } catch {
                      setRememberApiKey(false);
                      setError("このブラウザにAPIキーを保存できませんでした");
                    }
                  }
                }}
                placeholder="sk-..."
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={isLive}
              />
              <small>
                APIキーはOpenAIへの接続にのみ使用し、Miri
                Translatorのサーバーには保存しません。
              </small>
              <label className="api-key-remember">
                <input
                  type="checkbox"
                  checked={rememberApiKey}
                  disabled={!apiKey.trim()}
                  onChange={(event) => {
                    const remember = event.target.checked;
                    try {
                      if (remember && apiKey.trim()) {
                        localStorage.setItem(
                          API_KEY_STORAGE_KEY,
                          apiKey.trim(),
                        );
                      } else if (!remember) {
                        localStorage.removeItem(API_KEY_STORAGE_KEY);
                      }
                      setRememberApiKey(remember);
                      setError("");
                    } catch {
                      setRememberApiKey(false);
                      setError("このブラウザにAPIキーを保存できませんでした");
                    }
                  }}
                />
                <span>
                  <b>このブラウザにAPIキーを保存</b>
                  <small>
                    共有端末では使用しないでください。チェックを外すと保存済みキーを削除します
                  </small>
                </span>
              </label>
              <div className="api-key-actions">
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  OpenAI PlatformでAPIキーを作成
                  <Icon name="external" size={13} />
                </a>
              </div>
            </div>
            <fieldset className="field wide-field language-picker">
              <legend>翻訳先</legend>
              <div className="language-search">
                <input
                  type="search"
                  value={languageQuery}
                  onChange={(event) => setLanguageQuery(event.target.value)}
                  placeholder="言語を検索"
                  aria-label="翻訳先の言語を検索"
                  disabled={isLive}
                />
                <span>{LANGUAGES.length}言語に対応</span>
              </div>
              <div className="language-options">
                {visibleLanguageOptions.map((language) => {
                  const selected = targets.includes(language.code);
                  const reachedLimit =
                    !selected && targets.length >= MAX_TRANSLATION_LANGUAGES;
                  const unavailable = isLive || reachedLimit;
                  return (
                    <label
                      key={language.code}
                      className={`language-option ${selected ? "selected" : ""} ${unavailable ? "disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={
                          unavailable || (selected && targets.length === 1)
                        }
                        onChange={() => toggleTarget(language.code)}
                      />
                      <span>{language.name}</span>
                      <b>{language.short}</b>
                    </label>
                  );
                })}
                {!visibleLanguageOptions.length && (
                  <p className="language-empty">一致する言語がありません</p>
                )}
              </div>
              <small aria-live="polite">
                選択中: {targets.length} / {MAX_TRANSLATION_LANGUAGES}言語 ·
                最大3言語まで同時に翻訳できます
              </small>
            </fieldset>
            <label className="field wide-field">
              <span>配信コンテキスト</span>
              <div className="context-benefit">
                <b>入力するメリット</b>
                <p>
                  配信のテーマや固有名詞を伝えると、AIが話の内容を判断しやすくなります。
                </p>
              </div>
              <textarea
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="例：Deadlockのゲーム配信。"
                maxLength={500}
                rows={3}
                disabled={isLive}
              />
              <small>
                空欄でも利用できます。入力内容は音声認識と翻訳の両方に反映されます
              </small>
            </label>
            <div className="sentence-timing-setting wide-field">
              <div className="sentence-timing-title">
                <b>字幕を区切るまでの無音時間</b>
                <small>
                  AIへ一文として送るタイミングです。短いほど素早く、長いほど話の途中で切れにくくなります
                </small>
              </div>
              <div className="range-control">
                <span>無音時間</span>
                <input
                  type="range"
                  min="500"
                  max="3000"
                  step="50"
                  value={sentencePauseMs}
                  onChange={(event) =>
                    setSentencePauseMs(Number(event.target.value))
                  }
                  aria-label="字幕を切り替えるまでの無音時間"
                />
                <b>{formatPauseDuration(sentencePauseMs)}</b>
              </div>
            </div>
          </div>

          <button
            className={`record-button ${isLive ? "recording" : ""} ${status === "connecting" ? "connecting" : ""} ${!isLive && !hasApiKey ? "missing-api-key" : ""}`}
            onClick={isLive ? () => stop(true) : start}
            disabled={status === "connecting" || (!isLive && !hasApiKey)}
            type="button"
          >
            <span className="record-icon">
              <Icon name={isLive ? "stop" : "mic"} size={24} />
            </span>
            <span>
              <b>
                {status === "connecting"
                  ? "マイクを準備中..."
                  : isLive
                    ? "字幕を停止"
                    : hasApiKey
                      ? "この設定でマイクを開始"
                      : "APIキーを入力してください"}
              </b>
              <small>
                {isLive
                  ? processingLabel
                  : hasApiKey
                    ? "日本語字幕を表示し、翻訳とふりがなを順次追加します"
                    : "最初にOpenAI API Keyを入力してください"}
              </small>
            </span>
          </button>
          {hasCostSession && (
            <section className="session-cost" aria-label="今回の推定API料金">
              <div className="session-cost-total">
                <span>
                  今回の推定料金
                  <small>{isLive ? "計測中" : "停止時点"}</small>
                </span>
                <strong>{formatEstimatedUsd(sessionCosts.total)}</strong>
              </div>
              <dl>
                <div>
                  <dt>Live文字起こし</dt>
                  <dd>{formatEstimatedUsd(sessionCosts.liveTranscription)}</dd>
                </div>
                <div>
                  <dt>高精度文字起こし</dt>
                  <dd>{formatEstimatedUsd(sessionCosts.transcription)}</dd>
                </div>
                <div>
                  <dt>翻訳・ふりがな</dt>
                  <dd>{formatEstimatedUsd(sessionCosts.terra)}</dd>
                </div>
              </dl>
              <p>APIの使用量から算出した概算です</p>
            </section>
          )}
          {error && (
            <div className="error-box">
              {error}
              {/OpenAI API Key|API key|authentication|401/i.test(error) && (
                <small>
                  入力したキーが有効で、OpenAI
                  APIを利用できる状態か確認してください。
                </small>
              )}
            </div>
          )}
          {captionError && <CaptionErrorPanel error={captionError} />}
        </div>

        <div className="preview-card">
          <div className="card-header preview-heading">
            <div>
              <span className="step">02</span>
              <h2>字幕プレビュー</h2>
            </div>
            <span className={`status ${status}`}>
              <i />
              {status === "live"
                ? "LIVE"
                : status === "connecting"
                  ? "CONNECTING"
                  : "STANDBY"}
            </span>
          </div>
          <div className="screen">
            <div className="screen-noise" />
            <div className="preview-content">
              <CaptionRenderer
                subtitle={previewSubtitle}
                variant="preview"
                previewWidth={PREVIEW_WIDTH}
              />
            </div>
            <span className="preview-resolution-label">
              {PREVIEW_WIDTH} × {PREVIEW_HEIGHT}
            </span>
          </div>
          <div className="preview-tools">
            <div className="preview-tools-title">
              <b>字幕表示設定</b>
              <span>プレビューとOBSに反映</span>
            </div>
            <div className="caption-appearance-settings">
              <section className="caption-setting-group">
                <h3>文字サイズ</h3>
                <div className="caption-size-controls">
                  <div className="range-control">
                    <span>日本語</span>
                    <input
                      type="range"
                      min="24"
                      max="48"
                      value={japaneseFontSize}
                      onChange={(event) =>
                        setJapaneseFontSize(Number(event.target.value))
                      }
                      aria-label="日本語字幕の文字サイズ"
                    />
                    <b>{japaneseFontSize}px</b>
                  </div>
                  {targets.map((language) => {
                    const item = LANGUAGES.find(
                      (candidate) => candidate.code === language,
                    );
                    const style =
                      translationStyles[language] ??
                      DEFAULT_TRANSLATION_STYLES.en;
                    return (
                      <div className="range-control" key={language}>
                        <span>{item?.name}</span>
                        <input
                          type="range"
                          min="16"
                          max="48"
                          value={style.fontSize}
                          onChange={(event) =>
                            updateTranslationStyle(language, {
                              fontSize: Number(event.target.value),
                            })
                          }
                          aria-label={`${item?.name}字幕の文字サイズ`}
                        />
                        <b>{style.fontSize}px</b>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="caption-setting-group">
                <h3>文字色</h3>
                <div className="caption-color-controls">
                  <label className="color-control">
                    <span>日本語</span>
                    <span className="color-value">
                      <input
                        type="color"
                        value={japaneseColor}
                        onChange={(event) =>
                          setJapaneseColor(event.target.value)
                        }
                        aria-label="日本語字幕の文字色"
                      />
                      <b>{japaneseColor.toUpperCase()}</b>
                    </span>
                  </label>
                  {targets.map((language) => {
                    const item = LANGUAGES.find(
                      (candidate) => candidate.code === language,
                    );
                    const style =
                      translationStyles[language] ??
                      DEFAULT_TRANSLATION_STYLES.en;
                    return (
                      <label className="color-control" key={language}>
                        <span>{item?.name}</span>
                        <span className="color-value">
                          <input
                            type="color"
                            value={style.color}
                            onChange={(event) =>
                              updateTranslationStyle(language, {
                                color: event.target.value,
                              })
                            }
                            aria-label={`${item?.name}字幕の文字色`}
                          />
                          <b>{style.color.toUpperCase()}</b>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
              <section className="caption-setting-group">
                <h3>配置</h3>
                <div className="placement-controls">
                  <div className="placement-control">
                    <fieldset
                      className="alignment-toggle"
                      aria-label="字幕の横位置"
                    >
                      <button
                        type="button"
                        className={alignment === "left" ? "active" : ""}
                        aria-pressed={alignment === "left"}
                        onClick={() => setAlignment("left")}
                      >
                        左
                      </button>
                      <button
                        type="button"
                        className={alignment === "center" ? "active" : ""}
                        aria-pressed={alignment === "center"}
                        onClick={() => setAlignment("center")}
                      >
                        中央
                      </button>
                      <button
                        type="button"
                        className={alignment === "right" ? "active" : ""}
                        aria-pressed={alignment === "right"}
                        onClick={() => setAlignment("right")}
                      >
                        右
                      </button>
                    </fieldset>
                  </div>
                  <div className="placement-control">
                    <fieldset
                      className="alignment-toggle"
                      aria-label="字幕の縦位置"
                    >
                      <button
                        type="button"
                        className={verticalAlignment === "top" ? "active" : ""}
                        aria-pressed={verticalAlignment === "top"}
                        onClick={() => setVerticalAlignment("top")}
                      >
                        上
                      </button>
                      <button
                        type="button"
                        className={
                          verticalAlignment === "center" ? "active" : ""
                        }
                        aria-pressed={verticalAlignment === "center"}
                        onClick={() => setVerticalAlignment("center")}
                      >
                        中央
                      </button>
                      <button
                        type="button"
                        className={
                          verticalAlignment === "bottom" ? "active" : ""
                        }
                        aria-pressed={verticalAlignment === "bottom"}
                        onClick={() => setVerticalAlignment("bottom")}
                      >
                        下
                      </button>
                    </fieldset>
                  </div>
                </div>
              </section>
              <section className="caption-setting-group compact-setting-group">
                <h3>字幕スタイル</h3>
                <fieldset
                  className="alignment-toggle caption-style-toggle"
                  aria-label="字幕スタイル"
                >
                  <button
                    type="button"
                    className={captionStyle === "simple" ? "active" : ""}
                    aria-pressed={captionStyle === "simple"}
                    onClick={() => setCaptionStyle("simple")}
                  >
                    シンプル
                  </button>
                  <button
                    type="button"
                    className={captionStyle === "labeled" ? "active" : ""}
                    aria-pressed={captionStyle === "labeled"}
                    onClick={() => setCaptionStyle("labeled")}
                  >
                    ラベル付き
                  </button>
                </fieldset>
              </section>
            </div>
            <div className="range-control caption-duration-control">
              <span>字幕の表示時間</span>
              <input
                type="range"
                min="3000"
                max="30000"
                step="1000"
                value={captionHoldMs}
                onChange={(event) =>
                  setCaptionHoldMs(Number(event.target.value))
                }
                aria-label="字幕を表示する時間"
              />
              <b>{captionHoldMs / 1000}秒</b>
            </div>
          </div>
          <ObsWebSocketPanel
            overlayWidth={PREVIEW_WIDTH}
            overlayHeight={PREVIEW_HEIGHT}
          />
        </div>
        <div className="settings-storage-row">
          <span>字幕・AI設定は、このブラウザに自動保存されます</span>
          <button
            type="button"
            onClick={resetSettings}
            disabled={isLive}
            title={
              isLive ? "字幕を停止してから初期状態に戻してください" : undefined
            }
          >
            設定を初期状態に戻す
          </button>
        </div>
      </section>

      <section className="feature-strip">
        <div>
          <b>01</b>
          <span>
            <strong>字幕の精度を優先</strong>
            <small>一文の音声をまとめて高精度に認識</small>
          </span>
        </div>
        <div>
          <b>02</b>
          <span>
            <strong>漢字にふりがな</strong>
            <small>日本語を学ぶ海外の視聴者にも読みやすく</small>
          </span>
        </div>
        <div>
          <b>03</b>
          <span>
            <strong>OBS READY</strong>
            <small>URLをブラウザソースに登録するだけ</small>
          </span>
        </div>
      </section>

      <footer>
        <span>MIRI TRANSLATOR by ミリちゃんねる · FOR JAPANESE STREAMERS</span>
        <a
          href="https://developers.openai.com/api/docs/models/gpt-5.6-terra"
          target="_blank"
          rel="noreferrer"
        >
          OpenAI API <Icon name="external" size={14} />
        </a>
      </footer>
    </main>
  );
}
