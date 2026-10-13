import type { ReactNode } from 'react';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string };

const FENCE = /^\s*```/;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const INDENTED_CODE = /^( {4}|\t)/;

/**
 * Splits the Markdown that task briefs and AI replies use into blocks: headings, fenced
 * or indented code, lists and paragraphs. Anything else is kept as plain text.
 */
function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) code.push(lines[index++]!);
      index += 1;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      index += 1;
      continue;
    }
    if (INDENTED_CODE.test(line)) {
      const code: string[] = [];
      while (index < lines.length && (INDENTED_CODE.test(lines[index]!) || !lines[index]!.trim())) {
        code.push(lines[index++]!.replace(INDENTED_CODE, ''));
      }
      blocks.push({ kind: 'code', text: code.join('\n').trimEnd() });
      continue;
    }
    const marker = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (marker) {
      const items: string[] = [];
      while (index < lines.length && lines[index]!.trim()) {
        const current = lines[index]!;
        if (marker.test(current)) items.push(current.replace(marker, ''));
        else if (/^\s+\S/.test(current) && items.length > 0) items[items.length - 1] += ` ${current.trim()}`;
        else break;
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: marker === NUMBERED, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !FENCE.test(lines[index]!) && !HEADING.test(lines[index]!) && !BULLET.test(lines[index]!) && !NUMBERED.test(lines[index]!)) {
      paragraph.push(lines[index++]!.trim());
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

/** `code` and **bold** inside a line. Built as elements, so no text is ever treated as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

interface Props {
  source: string;
  /** The heading level a `#` in the source becomes, so the page outline stays in order. */
  baseLevel?: 2 | 3 | 4;
}

/** Renders a small, safe subset of Markdown. */
export function Markdown({ source, baseLevel = 3 }: Props) {
  return (
    <div className="markdown">
      {parse(source).map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, baseLevel + block.level - 1)}` as 'h2';
            return (
              <Tag key={index} className={`markdown-h${block.level}`}>
                {inline(block.text)}
              </Tag>
            );
          }
          case 'code':
            return (
              <pre key={index} className="code-block" tabIndex={0}>
                <code>{block.text}</code>
              </pre>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </List>
            );
          }
          case 'paragraph':
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
