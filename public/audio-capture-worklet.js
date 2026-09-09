const DEFAULT_THRESHOLD = 0.025;
const DEFAULT_PAUSE_MS = 1000;
const DEFAULT_PRE_ROLL_MS = 400;
const DEFAULT_MINIMUM_VOICE_MS = 80;

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

class MiriAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options?.processorOptions ?? {};
    this.threshold = positiveNumber(config.threshold, DEFAULT_THRESHOLD);
    this.pauseMs = positiveNumber(config.pauseMs, DEFAULT_PAUSE_MS);
    this.preRollMs = positiveNumber(config.preRollMs, DEFAULT_PRE_ROLL_MS);
    this.minimumVoiceMs = positiveNumber(
      config.minimumVoiceMs,
      DEFAULT_MINIMUM_VOICE_MS,
    );
    this.active = true;
    this.resetTurn();

    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "configure") {
        this.pauseMs = positiveNumber(message.pauseMs, this.pauseMs);
      } else if (message?.type === "stop") {
        this.active = false;
        this.resetTurn();
      }
    };
  }

  resetTurn() {
    this.preRollChunks = [];
    this.preRollSampleCount = 0;
    this.turnChunks = [];
    this.turnSampleCount = 0;
    this.voicedSampleCount = 0;
    this.silentSampleCount = 0;
    this.heardSpeech = false;
  }

  retainPreRoll(chunk) {
    this.preRollChunks.push(chunk);
    this.preRollSampleCount += chunk.length;
    const maximumSamples = Math.round((sampleRate * this.preRollMs) / 1000);
    while (
      this.preRollSampleCount > maximumSamples &&
      this.preRollChunks.length > 1
    ) {
      const removed = this.preRollChunks.shift();
      this.preRollSampleCount -= removed.length;
    }
  }

  beginTurn() {
    this.heardSpeech = true;
    this.turnChunks = this.preRollChunks;
    this.turnSampleCount = this.preRollSampleCount;
    this.preRollChunks = [];
    this.preRollSampleCount = 0;
    this.port.postMessage({ type: "speech-start" });
  }

  completeTurn() {
    const minimumSamples = Math.round(
      (sampleRate * this.minimumVoiceMs) / 1000,
    );
    if (this.voicedSampleCount >= minimumSamples) {
      const samples = new Float32Array(this.turnSampleCount);
      let offset = 0;
      for (const chunk of this.turnChunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      this.port.postMessage(
        { type: "turn", samples: samples.buffer, sampleRate },
        [samples.buffer],
      );
    } else {
      this.port.postMessage({ type: "discard" });
    }
    this.resetTurn();
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (!this.active) return false;

    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const chunk = new Float32Array(input);
    let energy = 0;
    for (const value of chunk) energy += value * value;
    const voiced = Math.sqrt(energy / chunk.length) > this.threshold;

    if (!this.heardSpeech) {
      this.retainPreRoll(chunk);
    } else {
      this.turnChunks.push(chunk);
      this.turnSampleCount += chunk.length;
    }

    if (voiced) {
      if (!this.heardSpeech) this.beginTurn();
      this.voicedSampleCount += chunk.length;
      this.silentSampleCount = 0;
    } else if (this.heardSpeech) {
      this.silentSampleCount += chunk.length;
      const pauseSamples = Math.round((sampleRate * this.pauseMs) / 1000);
      if (this.silentSampleCount >= pauseSamples) this.completeTurn();
    }

    return true;
  }
}

registerProcessor("miri-audio-capture", MiriAudioCaptureProcessor);
