import { describe, expect, it } from 'vitest';
import { minify } from 'terser';
import { runInNewContext } from 'node:vm';
import { deduplicateLegalNotices, deduplicateLegalNoticesPlugin } from './deduplicate-legal-notices.mjs';

const first = '/* @license Copyright 2024 Example; Apache-2.0 */';
const distinct = '/* @license Copyright 2025 Example; Apache-2.0 */';
const count = (text, value) => text.split(value).length - 1;

describe('per-chunk exact legal notice preservation', () => {
  it('keeps the first identical notice and every distinct notice in source order', () => {
    const input = `${first}\nconst a = 1;\n${distinct}\nconst b = 2;\n${first}\nglobalThis.answer = a + b;`;
    const output = deduplicateLegalNotices(input);
    expect(output.startsWith(first)).toBe(true);
    expect(count(output, first)).toBe(1);
    expect(count(output, distinct)).toBe(1);
    expect(output.indexOf(first)).toBeLessThan(output.indexOf(distinct));
    const context = {};
    runInNewContext(output, context);
    expect(context.answer).toBe(3);
  });

  it('does not share notice state between output assets or repeated builds', () => {
    const plugin = deduplicateLegalNoticesPlugin();
    const input = `${first}\nconst a = 1;\n${first}`;
    const render = () => plugin.renderChunk.handler(input).code;
    expect(count(render(), first)).toBe(1);
    expect(count(render(), first)).toBe(1);
    expect(plugin.renderChunk.handler(`${first}\nexport const a = 1;`)).toBeNull();
  });

  it('leaves an asset without duplicate legal notices unchanged', () => {
    expect(deduplicateLegalNotices('export const answer = 42;')).toBeNull();
    expect(deduplicateLegalNotices(`${first}\nexport const answer = 42;`)).toBeNull();
    expect(deduplicateLegalNotices('/* ordinary */ const a = 1; /* ordinary */')).toBeNull();
  });

  it('never combines notices with different whitespace, years or license text', () => {
    const notices = [first, distinct, first.replace('Example;', 'Example ;'), first.replace('Apache-2.0', 'MIT')];
    const output = deduplicateLegalNotices([...notices, ...notices].join('\n'));
    for (const notice of notices) expect(count(output, notice)).toBe(1);
  });

  it('recognizes preserve and bang blocks but leaves conditional compilation intact', () => {
    for (const notice of ['/* @preserve Acme */', '/*! Acme */']) {
      expect(count(deduplicateLegalNotices(`${notice}\nconst a = 1;\n${notice}`), notice)).toBe(1);
    }
    const conditional = '/*! @cc_on @license Acme */';
    expect(deduplicateLegalNotices(`${conditional}\n${conditional}`)).toBeNull();
  });

  it('preserves minifier annotations even when mixed with a legal notice', () => {
    for (const annotation of ['PURE', 'INLINE', 'NOINLINE', 'KEY', 'NO_SIDE_EFFECTS']) {
      for (const marker of ['@', '#']) {
        const notice = `/*! @license Acme ${marker}__${annotation}__ */`;
        expect(deduplicateLegalNotices(`${notice} a(); ${notice} b();`)).toBeNull();
      }
    }
  });

  it('ignores comment-looking strings, template text, regular expressions and line comments', () => {
    const input = `${first}\nconst a = ${JSON.stringify(first)};\nconst b = \`${first}\`;\nconst c = /[/* @license Acme */]/;\n// ${first}\n${first}`;
    const output = deduplicateLegalNotices(input);
    expect(output).toContain(`const a = ${JSON.stringify(first)}`);
    expect(output).toContain(`const b = \`${first}\``);
    expect(output).toContain('const c = /[/* @license Acme */]/');
    expect(output).toContain(`// ${first}`);
    expect(count(output, first)).toBe(4);
  });

  it('handles punctuation trivia and template substitutions', () => {
    const notice = '/* @license 😀\r\nAcme\u2028\u2029 */';
    const input = `${notice}\nconst a = [${notice}]; const b = \`x\${1 ${notice}}\`;`;
    const output = deduplicateLegalNotices(input);
    expect(count(output, notice)).toBe(1);
    const context = {};
    runInNewContext(`${output}\nglobalThis.answer = b;`, context);
    expect(context.answer).toBe('x1');
  });

  it('preserves token separation and automatic-semicolon boundaries', () => {
    const multiline = '/* @license\nAcme */';
    const input = `${first}\n${multiline}\nlet${first}value = 3; function result() { return${multiline}42; } globalThis.answer = [value, result()];`;
    const context = {};
    runInNewContext(deduplicateLegalNotices(input), context);
    expect([...context.answer]).toEqual([3, undefined]);
  });

  it('leaves mapped builds and unparseable input unchanged', () => {
    const input = `${first}\nconst a = 1;\n${first}`;
    const plugin = deduplicateLegalNoticesPlugin();
    expect(plugin.renderChunk.order).toBe('post');
    expect(plugin.renderChunk.handler(input, {}, { sourcemap: true })).toBeNull();
    expect(plugin.renderChunk.handler(input, {}, { sourcemap: 'hidden' })).toBeNull();
    expect(deduplicateLegalNotices(`${first}\nfunction {\n${first}`)).toBeNull();
  });

  it('deduplicates final Terser output while preserving execution and distinct notices', async () => {
    const input = `${first}\nconst a = 1;\n${distinct}\nconst b = 2;\n${first}\nglobalThis.answer = a + b;`;
    const options = { compress: { passes: 2, unsafe: false, pure_getters: false, drop_console: false }, mangle: { properties: false } };
    const before = await minify(input, options);
    const after = deduplicateLegalNotices(before.code);
    expect(count(after, first)).toBe(1);
    expect(count(after, distinct)).toBe(1);
    expect(after.length).toBeLessThan(before.code.length);
    for (const code of [before.code, after]) {
      const context = {};
      runInNewContext(code, context);
      expect(context.answer).toBe(3);
    }
  });
});
