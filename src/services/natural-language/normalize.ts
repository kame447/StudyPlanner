function pad2(value: number | string): string {
  return String(value).padStart(2, "0");
}

function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

function normalizePunctuation(input: string): string {
  return input
    .replace(/[〜～]/g, "-")
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/");
}

function normalizeJapaneseTime(input: string): string {
  let s = input;

  // 6時半 -> 06:30
  s = s.replace(/(\d{1,2})時半/g, (_, h: string) => `${pad2(h)}:30`);

  // 12時34分 -> 12:34
  s = s.replace(/(\d{1,2})時(\d{1,2})分/g, (_, h: string, m: string) => {
    return `${pad2(h)}:${pad2(m)}`;
  });

  // 7時 -> 07:00
  s = s.replace(/(\d{1,2})時(?!間|限|半|\d|[0-9]{1,2}分)/g, (_, h: string) => {
    return `${pad2(h)}:00`;
  });

  return s;
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\s*([。、「」])/g, "$1")
    .replace(/([。、「」])\s*/g, "$1")
    .trim();
}

export function normalizeText(input: string): string {
  let s = input;
  s = toHalfWidth(s);
  s = normalizePunctuation(s);
  s = normalizeJapaneseTime(s);
  s = normalizeWhitespace(s);
  return s;
}
