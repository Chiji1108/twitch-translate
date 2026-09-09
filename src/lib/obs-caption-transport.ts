import type { SubtitleState } from "@/stores/caption-store";

export const OBS_CAPTION_EVENT_NAME = "miri-caption-state";

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
