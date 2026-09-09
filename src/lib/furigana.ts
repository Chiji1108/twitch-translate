export type FuriganaSegment = {
  text: string;
  reading: string | null;
};

export const CAPTION_MODEL = "gpt-5.6-luna";
export const CAPTION_SERVICE_TIER = "default";

export type KanjiRun = {
  key: string;
  text: string;
  start: number;
  end: number;
};

type FuriganaReadingGroup = {
  text: string;
  reading: string;
};

export type FuriganaFailureDetails = {
  category:
    | "openai_api"
    | "openai_response"
    | "structured_output"
    | "validation"
    | "client_validation"
    | "network"
    | "server";
  httpStatus?: number;
  code?: string;
  type?: string;
  param?: string;
  requestId?: string;
  responseId?: string;
  responseStatus?: string;
  incompleteReason?: string;
  validationCode?: string;
  validationIndex?: number;
  language?: string;
  model?: string;
  modelOutput?: string;
};

export type FuriganaValidationResult =
  | { segments: FuriganaSegment[]; error: null }
  | {
      segments: [];
      error: {
        code: string;
        message: string;
        index?: number;
      };
    };

const KANJI_PATTERN = /[\p{Script=Han}々〆ヵヶ]/u;
const KANJI_ONLY_PATTERN = /^[\p{Script=Han}々〆ヵヶ]+$/u;
const HIRAGANA_ONLY_PATTERN = /^[ぁ-ゖー]+$/u;
const KANJI_RUN_PATTERN = /[\p{Script=Han}々〆ヵヶ]+/gu;

function katakanaToHiragana(value: string) {
  return value.replace(/[ァ-ヶ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60),
  );
}

export function validateFuriganaSegments(
  source: string,
  value: unknown,
): FuriganaValidationResult {
  if (!Array.isArray(value)) {
    return {
      segments: [],
      error: {
        code: "segments_not_array",
        message: "segmentsが配列ではありません",
      },
    };
  }

  if (!value.length) {
    return {
      segments: [],
      error: {
        code: "segments_empty",
        message: "segmentsが空です",
      },
    };
  }

  const segments: FuriganaSegment[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      return {
        segments: [],
        error: {
          code: "segment_not_object",
          message: `${index + 1}番目のsegmentがオブジェクトではありません`,
          index,
        },
      };
    }

    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    if (!text) {
      return {
        segments: [],
        error: {
          code: "segment_text_empty",
          message: `${index + 1}番目のsegmentのtextが空です`,
          index,
        },
      };
    }

    const hasKanji = KANJI_PATTERN.test(text);
    const rawReading =
      typeof record.reading === "string" ? record.reading.trim() : "";
    if (hasKanji) {
      if (!rawReading) {
        return {
          segments: [],
          error: {
            code: "kanji_reading_missing",
            message: `${index + 1}番目の漢字segmentにreadingがありません`,
            index,
          },
        };
      }

      if (!KANJI_ONLY_PATTERN.test(text)) {
        return {
          segments: [],
          error: {
            code: "kanji_text_contains_non_kanji",
            message: `${index + 1}番目の読み付きtextに、漢字以外の文字が含まれています`,
            index,
          },
        };
      }

      const reading = katakanaToHiragana(rawReading);
      if (!HIRAGANA_ONLY_PATTERN.test(reading)) {
        return {
          segments: [],
          error: {
            code: "reading_not_hiragana",
            message: `${index + 1}番目のreadingがひらがなではありません`,
            index,
          },
        };
      }

      segments.push({ text, reading });
      continue;
    }

    if (record.reading !== null) {
      return {
        segments: [],
        error: {
          code: "non_kanji_reading_present",
          message: `${index + 1}番目の漢字を含まないsegmentにreadingがあります`,
          index,
        },
      };
    }

    segments.push({ text, reading: null });
  }

  const reconstructed = segments.map((item) => item.text).join("");
  if (reconstructed !== source) {
    let mismatchIndex = 0;
    while (
      mismatchIndex < source.length &&
      source[mismatchIndex] === reconstructed[mismatchIndex]
    ) {
      mismatchIndex += 1;
    }
    return {
      segments: [],
      error: {
        code: "source_mismatch",
        message: `segmentの連結結果が原文と一致しません（最初の差分: ${mismatchIndex + 1}文字目）`,
      },
    };
  }

  return { segments, error: null };
}

export function normalizeFuriganaSegments(
  source: string,
  value: unknown,
): FuriganaSegment[] {
  return validateFuriganaSegments(source, value).segments;
}

function appendPlainSegment(segments: FuriganaSegment[], text: string) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.reading === null) {
    previous.text += text;
  } else {
    segments.push({ text, reading: null });
  }
}

function trimMatchingTrailingOkurigana(
  source: string,
  run: KanjiRun,
  groups: FuriganaReadingGroup[],
) {
  const combinedText = groups.map((group) => group.text).join("");
  if (combinedText === run.text || !combinedText.startsWith(run.text)) {
    return groups;
  }

  const trailingKana = combinedText.slice(run.text.length);
  const lastGroup = groups.at(-1);
  if (
    !trailingKana ||
    !HIRAGANA_ONLY_PATTERN.test(trailingKana) ||
    !source.slice(run.end).startsWith(trailingKana) ||
    !lastGroup?.text.endsWith(trailingKana) ||
    !lastGroup.reading.endsWith(trailingKana)
  ) {
    return groups;
  }

  const text = lastGroup.text.slice(0, -trailingKana.length);
  const reading = lastGroup.reading.slice(0, -trailingKana.length);
  if (!text || !reading || !KANJI_ONLY_PATTERN.test(text)) {
    return groups;
  }

  const repaired = [...groups.slice(0, -1), { text, reading }];
  return repaired.map((group) => group.text).join("") === run.text
    ? repaired
    : groups;
}

export function extractKanjiRuns(source: string): KanjiRun[] {
  return Array.from(source.matchAll(KANJI_RUN_PATTERN), (match, index) => {
    const start = match.index ?? 0;
    return {
      key: `r${index}`,
      text: match[0],
      start,
      end: start + match[0].length,
    };
  });
}

export function buildFuriganaSegments(
  source: string,
  readings: unknown,
): FuriganaValidationResult {
  if (!readings || typeof readings !== "object" || Array.isArray(readings)) {
    return {
      segments: [],
      error: {
        code: "readings_not_object",
        message: "readingsがオブジェクトではありません",
      },
    };
  }

  const record = readings as Record<string, unknown>;
  const segments: FuriganaSegment[] = [];
  let cursor = 0;
  for (const [runIndex, run] of extractKanjiRuns(source).entries()) {
    appendPlainSegment(segments, source.slice(cursor, run.start));
    const rawGroups = record[run.key];
    if (!Array.isArray(rawGroups)) {
      return {
        segments: [],
        error: {
          code: "reading_groups_not_array",
          message: `${runIndex + 1}番目の漢字列の読み分けが配列ではありません`,
          index: runIndex,
        },
      };
    }
    if (!rawGroups.length) {
      return {
        segments: [],
        error: {
          code: "reading_groups_empty",
          message: `${runIndex + 1}番目の漢字列の読み分けが空です`,
          index: runIndex,
        },
      };
    }

    const rawReadingGroups: FuriganaReadingGroup[] = [];
    for (const rawGroup of rawGroups) {
      if (!rawGroup || typeof rawGroup !== "object") {
        return {
          segments: [],
          error: {
            code: "reading_group_not_object",
            message: `${runIndex + 1}番目の漢字列に不正な読み分けがあります`,
            index: runIndex,
          },
        };
      }
      const group = rawGroup as Record<string, unknown>;
      rawReadingGroups.push({
        text: typeof group.text === "string" ? group.text : "",
        reading: typeof group.reading === "string" ? group.reading : "",
      });
    }

    const groups = trimMatchingTrailingOkurigana(source, run, rawReadingGroups);

    if (groups.map((group) => group.text).join("") !== run.text) {
      return {
        segments: [],
        error: {
          code: "kanji_run_mismatch",
          message: `${runIndex + 1}番目の漢字列の読み分けが原文と一致しません`,
          index: runIndex,
        },
      };
    }
    segments.push(...groups);
    cursor = run.end;
  }
  appendPlainSegment(segments, source.slice(cursor));

  return validateFuriganaSegments(source, segments);
}
