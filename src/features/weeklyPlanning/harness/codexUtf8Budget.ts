// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 OpenAI
// TypeScript adaptation for Laplance, 2026.
// Source: openai/codex@1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440
// codex-rs/utils/string/src/truncate.rs: truncate_middle_with_marker,
// split_budget and approx_token_count. See public/licenses/codex/NOTICE.
// Changes: TextEncoder/Decoder replace Rust byte slices; invalid JS budgets
// are rejected. This is a byte heuristic, NOT an exact model tokenizer.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function assertByteBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid byte budget');
}

function floorCharBoundary(bytes: Uint8Array, offset: number): number {
  let index = Math.min(offset, bytes.length);
  while (index > 0 && index < bytes.length && (bytes[index] & 0xc0) === 0x80) index -= 1;
  return index;
}

function ceilCharBoundary(bytes: Uint8Array, offset: number): number {
  let index = Math.max(0, offset);
  while (index < bytes.length && (bytes[index] & 0xc0) === 0x80) index += 1;
  return index;
}

export function utf8Prefix(text: string, maxBytes: number): string {
  assertByteBudget(maxBytes);
  const bytes = encoder.encode(text);
  return decoder.decode(bytes.subarray(0, floorCharBoundary(bytes, maxBytes)));
}

export function utf8Suffix(text: string, maxBytes: number): string {
  assertByteBudget(maxBytes);
  const bytes = encoder.encode(text);
  return decoder.decode(bytes.subarray(ceilCharBoundary(bytes, bytes.length - maxBytes)));
}

/** Port of Codex's hard-byte-limit variant, including the truncation marker. */
export function truncateMiddleWithMarker(text: string, maxBytes: number, marker: string): string {
  assertByteBudget(maxBytes);
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const contentBudget = maxBytes - utf8ByteLength(marker);
  if (contentBudget < 0) return utf8Prefix(text, maxBytes);
  const leftBudget = Math.floor(contentBudget / 2);
  const rightBudget = contentBudget - leftBudget;
  const prefixEnd = floorCharBoundary(bytes, leftBudget);
  const suffixStart = ceilCharBoundary(bytes, bytes.length - rightBudget);
  return decoder.decode(bytes.subarray(0, prefixEnd)) + marker
    + decoder.decode(bytes.subarray(suffixStart));
}

/** Same ceil(UTF-8 bytes / 4) estimator as Codex; never use it for billing. */
export function approximateTokenCount(text: string): number {
  return Math.ceil(utf8ByteLength(text) / 4);
}
