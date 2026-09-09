import { beforeAll, describe, expect, test } from "bun:test";

let Processor;

beforeAll(async () => {
  globalThis.sampleRate = 1_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      const messages = [];
      this.port = {
        messages,
        onmessage: null,
        postMessage(message) {
          messages.push(message);
        },
      };
    }
  };
  globalThis.registerProcessor = (name, RegisteredProcessor) => {
    expect(name).toBe("miri-audio-capture");
    Processor = RegisteredProcessor;
  };
  await import("../../public/audio-capture-worklet.js");
});

function processChunk(processor, values) {
  const output = new Float32Array(values.length).fill(1);
  const running = processor.process([[Float32Array.from(values)]], [[output]]);
  expect(output.every((value) => value === 0)).toBe(true);
  return running;
}

describe("audio capture worklet", () => {
  test("プリロールを含め、指定した無音時間で音声ターンを完成させる", () => {
    const processor = new Processor({
      processorOptions: {
        threshold: 0.5,
        pauseMs: 10,
        preRollMs: 4,
        minimumVoiceMs: 2,
      },
    });

    processChunk(processor, [0, 0]);
    processChunk(processor, [1, 1]);
    for (let index = 0; index < 5; index += 1) {
      processChunk(processor, [0, 0]);
    }

    expect(processor.port.messages.map(({ type }) => type)).toEqual([
      "speech-start",
      "turn",
    ]);
    const turn = processor.port.messages[1];
    expect(turn.sampleRate).toBe(1_000);
    expect(Array.from(new Float32Array(turn.samples))).toEqual([
      0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test("短すぎる音を字幕へ送らず破棄する", () => {
    const processor = new Processor({
      processorOptions: {
        threshold: 0.5,
        pauseMs: 4,
        preRollMs: 2,
        minimumVoiceMs: 4,
      },
    });

    processChunk(processor, [1, 0]);
    processChunk(processor, [0, 0]);
    processChunk(processor, [0, 0]);

    expect(processor.port.messages.map(({ type }) => type)).toEqual([
      "speech-start",
      "discard",
    ]);
  });

  test("実行中に無音時間を変更でき、停止後は処理を終了する", () => {
    const processor = new Processor({
      processorOptions: {
        threshold: 0.5,
        pauseMs: 10,
        preRollMs: 2,
        minimumVoiceMs: 1,
      },
    });

    processor.port.onmessage({ data: { type: "configure", pauseMs: 2 } });
    processChunk(processor, [1, 1]);
    processChunk(processor, [0, 0]);
    expect(processor.port.messages.at(-1)?.type).toBe("turn");

    processor.port.onmessage({ data: { type: "stop" } });
    expect(processChunk(processor, [1, 1])).toBe(false);
  });
});
