export function normalizeJapanesePunctuation(text: string) {
  return text.replaceAll("!", "！").replaceAll("?", "？");
}
