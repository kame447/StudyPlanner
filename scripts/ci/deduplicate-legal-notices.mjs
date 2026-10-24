import ts from 'typescript';

// Parse tokens so comment-looking text in strings, templates and regex literals
// cannot become a legal notice. Include punctuation and EOF trivia as well.
function blockComments(code) {
  const source = ts.createSourceFile('chunk.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) return [];
  const comments = new Map();
  const pending = [source];
  while (pending.length) {
    const node = pending.pop();
    for (const range of [
      ...(ts.getLeadingCommentRanges(code, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(code, node.end) ?? []),
    ]) {
      if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) comments.set(range.pos, range);
    }
    pending.push(...node.getChildren(source));
  }
  return [...comments.values()].sort((a, b) => a.pos - b.pos);
}

export function deduplicateLegalNotices(code) {
  const seen = new Set();
  const edits = [];
  for (const { pos, end } of blockComments(code)) {
    const notice = code.slice(pos, end);
    // Match the explicit preservation markers understood by the minifier.
    // Compilation/minifier annotations can affect execution: leave them even
    // when they share a block with a legal notice.
    if (
      !/^\/\*!|@(?:license|preserve)\b/i.test(notice) ||
      /[@#]__\w+__|@(?:cc_on|if|elif|else|end|set)\b/i.test(notice)
    ) continue;
    if (seen.has(notice)) {
      // A comment can separate tokens or provide an automatic-semicolon line
      // break. Preserve that boundary when removing the duplicate notice.
      edits.push({ pos, end, separator: /[\r\n\u2028\u2029]/.test(notice) ? '\n' : ' ' });
    } else {
      seen.add(notice);
    }
  }
  if (!edits.length) return null;
  let output = '';
  let offset = 0;
  for (const { pos, end, separator } of edits) {
    output += code.slice(offset, pos) + separator;
    offset = end;
  }
  return output + code.slice(offset);
}

export function deduplicateLegalNoticesPlugin() {
  return {
    name: 'deduplicate-legal-notices',
    apply: 'build',
    renderChunk: {
      // Deduplicate the notices actually retained by Terser, before Rollup
      // hashes the final code and references. Mapped builds retain their original
      // output: this optional reduction must not invalidate existing sourcemaps.
      order: 'post',
      handler(code, _chunk, options = {}) {
        if (options.sourcemap) return null;
        const result = deduplicateLegalNotices(code);
        return result === null ? null : { code: result, map: null };
      },
    },
  };
}
