/**
 * Tests for mermaid fenced-code-block extraction.
 */

import { describe, test, expect } from "bun:test";
import { extractMermaidBlocks } from "../src/mermaid";

describe("extractMermaidBlocks", () => {
  test("extracts a backtick mermaid block and reports its 1-based start line", () => {
    const blocks = extractMermaidBlocks("line1\nline2\n```mermaid\ngraph TD\nA-->B\n```\ntail");
    expect(blocks).toEqual([{ source: "\ngraph TD\nA-->B", startLine: 3 }]);
  });

  test("extracts tilde-fenced mermaid blocks", () => {
    const blocks = extractMermaidBlocks("~~~mermaid\ngraph TD\nA-->B\n~~~\ntail");
    expect(blocks).toEqual([{ source: "\ngraph TD\nA-->B", startLine: 1 }]);
  });

  test("allows trailing attributes on the info string", () => {
    const blocks = extractMermaidBlocks("```mermaid title=Flow id=7\nflowchart LR\n```\n");
    expect(blocks).toEqual([{ source: "\nflowchart LR", startLine: 1 }]);
  });

  test("handles CRLF line endings", () => {
    const blocks = extractMermaidBlocks("```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n");
    expect(blocks).toEqual([{ source: "\ngraph TD\r\nA-->B", startLine: 1 }]);
  });

  test("treats an unclosed fence as a diagram to end of body", () => {
    const blocks = extractMermaidBlocks("# Note\n```mermaid\ngraph TD\nA-->B");
    expect(blocks).toEqual([{ source: "\ngraph TD\nA-->B", startLine: 2 }]);
  });

  test("accepts a closing fence longer than the opening fence", () => {
    const blocks = extractMermaidBlocks("````mermaid\nA\n````\ntail");
    expect(blocks).toEqual([{ source: "\nA", startLine: 1 }]);
  });

  test("does not close a block with a shorter fence run", () => {
    const blocks = extractMermaidBlocks("````mermaid\nA\n```\ntail\n````\n");
    expect(blocks).toEqual([{ source: "\nA\n```\ntail", startLine: 1 }]);
  });

  test("keeps backtick fences inside a tilde-fenced block", () => {
    const blocks = extractMermaidBlocks("~~~mermaid\n```\ngraph TD\n~~~\n");
    expect(blocks).toEqual([{ source: "\n```\ngraph TD", startLine: 1 }]);
  });

  test("extracts multiple blocks with per-block start lines", () => {
    const blocks = extractMermaidBlocks("```mermaid\nA\n```\ntext\n~~~mermaid\nB\n~~~\n");
    expect(blocks).toEqual([
      { source: "\nA", startLine: 1 },
      { source: "\nB", startLine: 5 },
    ]);
  });

  test("drops empty blocks and non-mermaid fences", () => {
    expect(extractMermaidBlocks("```mermaid\n```\ntail")).toEqual([]);
    expect(extractMermaidBlocks("```js\nx\n```\n")).toEqual([]);
  });

  test("matches fences indented by spaces or tabs", () => {
    const blocks = extractMermaidBlocks("  ```mermaid\nA\n  ```\n");
    expect(blocks).toEqual([{ source: "\nA", startLine: 1 }]);
  });

  test("returns empty for a body without mermaid fences", () => {
    expect(extractMermaidBlocks("")).toEqual([]);
    expect(extractMermaidBlocks("plain text\nno fences")).toEqual([]);
  });
});
