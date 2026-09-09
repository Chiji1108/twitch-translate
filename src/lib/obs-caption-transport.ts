import { parseSubtitleState, type SubtitleState } from "@/stores/caption-store";

export const OBS_CAPTION_EVENT_NAME = "miri-caption-state";
export const OBS_CAPTION_PROTOCOL_VERSION = 1;

type ObsCaptionEventData = {
  protocolVersion: typeof OBS_CAPTION_PROTOCOL_VERSION;
  stateJson: string;
};

export function encodeObsCaptionEventData(
  state: SubtitleState,
): ObsCaptionEventData {
  return {
    protocolVersion: OBS_CAPTION_PROTOCOL_VERSION,
    stateJson: JSON.stringify(state),
  };
}

export function decodeObsCaptionEventData(
  value: unknown,
): SubtitleState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ObsCaptionEventData>;
  if (
    candidate.protocolVersion !== OBS_CAPTION_PROTOCOL_VERSION ||
    typeof candidate.stateJson !== "string"
  ) {
    return null;
  }

  try {
    return parseSubtitleState(JSON.parse(candidate.stateJson));
  } catch {
    return null;
  }
}

export type ObsCaptionRequest = (state: SubtitleState) => Promise<unknown>;

export function createObsCaptionSender(sendRequest: ObsCaptionRequest) {
  let pending: SubtitleState | null = null;
  let flushPromise: Promise<void> | null = null;
  let active = true;

  const flush = async () => {
    while (active && pending) {
      const snapshot = pending;
      pending = null;
      await sendRequest(snapshot);
    }
  };

  return {
    publish(state: SubtitleState) {
      if (!active) return Promise.resolve();
      pending = state;
      if (!flushPromise) {
        flushPromise = flush().finally(() => {
          flushPromise = null;
        });
      }
      return flushPromise;
    },
    close() {
      active = false;
      pending = null;
    },
  };
}
