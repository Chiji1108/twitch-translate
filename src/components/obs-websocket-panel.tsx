"use client";

import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createObsCaptionSender,
  OBS_CAPTION_EVENT_NAME,
} from "@/lib/obs-caption-transport";
import { selectSubtitleState, useCaptionStore } from "@/stores/caption-store";

type ObsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

const DEFAULT_OBS_URL = "ws://127.0.0.1:4455";
const OBS_URL_STORAGE_KEY = "miri-translator-obs-url-v1";

function errorMessage(reason: unknown) {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (
    reason &&
    typeof reason === "object" &&
    "message" in reason &&
    typeof reason.message === "string" &&
    reason.message.trim()
  ) {
    return reason.message;
  }
  if (
    reason &&
    typeof reason === "object" &&
    "code" in reason &&
    (typeof reason.code === "number" || typeof reason.code === "string")
  ) {
    return `OBSへ接続できませんでした（エラーコード: ${reason.code}）`;
  }
  return "OBSへ接続できませんでした";
}

function normalizedObsUrl(input: string) {
  const value = input.trim();
  const withProtocol = /^wss?:\/\//i.test(value) ? value : `ws://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("OBSの接続先は ws:// または wss:// で入力してください");
  }
  return url.toString().replace(/\/$/, "");
}

export function ObsWebSocketPanel({
  overlayWidth,
  overlayHeight,
}: {
  overlayWidth: number;
  overlayHeight: number;
}) {
  const subtitle = useCaptionStore(useShallow(selectSubtitleState));
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(DEFAULT_OBS_URL);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<ObsConnectionStatus>("disconnected");
  const [error, setError] = useState("");
  const [version, setVersion] = useState("");
  const obsRef = useRef<OBSWebSocket | null>(null);
  const senderRef = useRef<ReturnType<typeof createObsCaptionSender> | null>(
    null,
  );
  const generationRef = useRef(0);
  const subtitleRef = useRef(subtitle);

  useEffect(() => {
    subtitleRef.current = subtitle;
    const sender = senderRef.current;
    if (!sender) return;
    void sender.publish(subtitle).catch((reason) => {
      setStatus("error");
      setError(`字幕をOBSへ送信できませんでした: ${errorMessage(reason)}`);
    });
  }, [subtitle]);

  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem(OBS_URL_STORAGE_KEY);
      if (savedUrl) setUrl(savedUrl);
    } catch {
      // Keep the default address when browser storage is unavailable.
    }
  }, []);

  const disconnect = useCallback(async () => {
    generationRef.current += 1;
    senderRef.current?.close();
    senderRef.current = null;
    const obs = obsRef.current;
    obsRef.current = null;
    if (obs) {
      try {
        await obs.disconnect();
      } catch {
        // The socket may already be closed by OBS.
      }
    }
    setStatus("disconnected");
    setError("");
    setVersion("");
  }, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
      senderRef.current?.close();
      void obsRef.current?.disconnect();
      senderRef.current = null;
      obsRef.current = null;
    },
    [],
  );

  const connect = async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    senderRef.current?.close();
    senderRef.current = null;
    if (obsRef.current) {
      try {
        await obsRef.current.disconnect();
      } catch {
        // Continue with a fresh connection.
      }
      obsRef.current = null;
    }

    setStatus("connecting");
    setError("");
    setVersion("");

    let connectionUrl: string;
    try {
      connectionUrl = normalizedObsUrl(url);
    } catch (reason) {
      setStatus("error");
      setError(errorMessage(reason));
      return;
    }

    const obs = new OBSWebSocket();
    obsRef.current = obs;
    obs.on("ConnectionClosed", () => {
      if (obsRef.current !== obs) return;
      senderRef.current?.close();
      senderRef.current = null;
      obsRef.current = null;
      setStatus("disconnected");
      setVersion("");
    });

    try {
      const connection = await obs.connect(
        connectionUrl,
        password || undefined,
        { rpcVersion: 1 },
      );
      if (generation !== generationRef.current) {
        await obs.disconnect();
        return;
      }

      const sender = createObsCaptionSender((state) =>
        obs.call("CallVendorRequest", {
          vendorName: "obs-browser",
          requestType: "emit_event",
          requestData: JSON.parse(
            JSON.stringify({
              event_name: OBS_CAPTION_EVENT_NAME,
              event_data: state,
            }),
          ),
        }),
      );
      senderRef.current = sender;
      setUrl(connectionUrl);
      setVersion(connection.obsWebSocketVersion);
      setStatus("connected");
      try {
        localStorage.setItem(OBS_URL_STORAGE_KEY, connectionUrl);
      } catch {
        // A remembered address is optional.
      }
      await sender.publish(subtitleRef.current);
    } catch (reason) {
      if (generation !== generationRef.current) return;
      senderRef.current?.close();
      senderRef.current = null;
      obsRef.current = null;
      try {
        await obs.disconnect();
      } catch {
        // Preserve the original connection error.
      }
      setStatus("error");
      setError(errorMessage(reason));
    }
  };

  const copyOverlayUrl = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/overlay`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const statusLabel =
    status === "connected"
      ? "接続済み"
      : status === "connecting"
        ? "接続中"
        : status === "error"
          ? "接続エラー"
          : "未接続";

  return (
    <div className="obs-websocket-panel">
      <div className="obs-websocket-heading">
        <span>
          <b>OBS WebSocket</b>
          <small>
            接続中は字幕と字幕表示設定をOBSのブラウザソースへ自動送信します
          </small>
        </span>
        <span className={`obs-connection-status ${status}`}>
          <i /> {statusLabel}
        </span>
      </div>
      <div className="obs-browser-source-row">
        <span>
          <b>ブラウザソース</b>
          <small>
            /overlay URLを登録してください。推奨サイズ：{overlayWidth} ×{" "}
            {overlayHeight}px （字幕が切れる場合は、幅や高さを広げてください）
          </small>
        </span>
        <button type="button" onClick={() => void copyOverlayUrl()}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {copied ? (
              <path d="m5 12 4 4L19 6" />
            ) : (
              <>
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </>
            )}
          </svg>
          {copied ? "コピー済み" : "OBS URLをコピー"}
        </button>
      </div>
      <div className="obs-websocket-controls">
        <label>
          <span>接続先</span>
          <input
            type="text"
            inputMode="url"
            value={url}
            disabled={isConnected || isConnecting}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={DEFAULT_OBS_URL}
            aria-label="OBS WebSocketの接続先"
          />
        </label>
        <label>
          <span>パスワード</span>
          <input
            type="password"
            value={password}
            disabled={isConnected || isConnecting}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="OBSで設定したパスワード"
            aria-label="OBS WebSocketのパスワード"
          />
        </label>
        <button
          type="button"
          className={isConnected ? "disconnect" : ""}
          disabled={isConnecting}
          onClick={() => void (isConnected ? disconnect() : connect())}
        >
          {isConnecting ? "接続中…" : isConnected ? "切断" : "OBSに接続"}
        </button>
      </div>
      <div className="obs-websocket-note">
        <small>
          OBSの「ツール →
          WebSocketサーバー設定」でサーバーを有効にしてください。接続先はこのブラウザに保存します。パスワードはOBSへの接続にのみ使用し、Miri
          Translatorのサーバーには送信・保存しません。
        </small>
        {version && <small>obs-websocket {version}</small>}
      </div>
      {error && (
        <p className="obs-websocket-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
