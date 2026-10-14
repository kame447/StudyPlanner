// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 OpenAI
// Adapted for Laplance from openai/codex@1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440,
// codex-rs/utils/output-truncation/src/lib.rs::truncate_mcp_tool_result.
// Modification: retain Laplance's trace envelope rather than an MCP tool result;
// account for JSON escaping by scaling the preview against its serialized size.
import { assertByteBudget, utf8ByteLength, utf8Prefix, utf8Suffix } from './codexUtf8Budget';

export function boundContextJson(value: unknown, maxBytes: number): unknown {
  assertByteBudget(maxBytes);
  if (maxBytes < 128) throw new RangeError('JSON preview budget is too small for metadata');
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    return { traceTruncated: true, reason: 'unserializable' };
  }
  const originalBytes = utf8ByteLength(serialized);
  if (originalBytes <= maxBytes) return JSON.parse(serialized);
  let previewBudget = maxBytes - 128;
  for (;;) {
    const leftBudget = Math.floor(previewBudget / 2);
    const preview = {
      traceTruncated: true,
      originalBytes,
      jsonHead: utf8Prefix(serialized, leftBudget),
      jsonTail: utf8Suffix(serialized, previewBudget - leftBudget),
    };
    const measured = utf8ByteLength(JSON.stringify(preview));
    if (measured <= maxBytes || previewBudget === 0) return preview;
    previewBudget = Math.min(previewBudget - 1, Math.floor(previewBudget * maxBytes / measured));
  }
}
