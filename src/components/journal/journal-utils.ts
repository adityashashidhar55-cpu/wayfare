/**
 * Journal helpers - tRPC result types, excerpt/date formatting, and a tiny
 * markdown-lite renderer for post bodies (paragraphs, "- " bullet lists,
 * **bold**, [label](url)) used by the reader view.
 */
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type JournalPostItem = RouterOutputs['journal']['list']['mine'][number];
export type JournalGet = RouterOutputs['journal']['get'];
export type JournalPlace = JournalGet['places'][number];
export type PlaceSuggestion = RouterOutputs['journal']['suggestPlaces']['suggestions'][number];
export type AutoAttachedPlace = RouterOutputs['journal']['update']['autoAttached'][number];

/** Minimal attached-place shape kept in editor state. */
export interface AttachedPlace {
  id: number;
  name: string;
  city: string;
  country: string;
}

export function toAttached(p: { id: number; name: string; city: string; country: string }): AttachedPlace {
  return { id: p.id, name: p.name, city: p.city, country: p.country };
}

/** Relative "3 days ago" label; falls back to an empty string on bad input. */
export function relDate(value: Date | string | number): string {
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '';
  }
}

/** Strip markdown-lite markers down to plain text. */
export function plainText(content: string | null): string {
  if (!content) return '';
  return content
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold → text
    .replace(/\*([^*]+)\*/g, '$1') // italic → text
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/^[-*]\s+/gm, '') // bullet markers
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text excerpt: strip markdown markers, collapse whitespace, clamp. */
export function excerpt(content: string | null, max = 150): string {
  const plain = plainText(content);
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trimEnd()}…`;
}

/** Word count over markdown-stripped plain text. */
export function wordCount(content: string | null): number {
  const plain = plainText(content);
  return plain ? plain.split(/\s+/).length : 0;
}

/** Estimated reading time in minutes (200 wpm, min 1). */
export function readingMinutes(content: string | null): number {
  return Math.max(1, Math.ceil(wordCount(content) / 200));
}

// ── markdown-lite blocks for the reader view ────────────────────────────────
export type ContentBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'list'; items: string[] };

export function parseContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const para of content.split(/\n{2,}/)) {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => l.startsWith('- ') || l.startsWith('* '))) {
      blocks.push({ kind: 'list', items: lines.map((l) => l.slice(2).trim()) });
    } else if (lines.length === 1 && lines[0].startsWith('## ')) {
      blocks.push({ kind: 'h2', text: lines[0].slice(3).trim() });
    } else {
      blocks.push({ kind: 'p', text: lines.join(' ') });
    }
  }
  return blocks;
}

/** Render **bold**, *italic* and [label](https://url) inline, keyed for React lists. */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      parts.push(createElement(Fragment, { key: key++ }, text.slice(last, m.index)));
    }
    if (m[2] != null) {
      parts.push(createElement('strong', { key: key++, className: 'font-semibold text-ink' }, m[2]));
    } else if (m[4] != null) {
      parts.push(createElement('em', { key: key++ }, m[4]));
    } else if (m[6] != null && m[7] != null) {
      parts.push(
        createElement(
          'a',
          {
            key: key++,
            href: m[7],
            target: '_blank',
            rel: 'noreferrer',
            className:
              'text-brand underline decoration-brand/40 underline-offset-2 transition-colors duration-fast hover:decoration-brand',
          },
          m[6],
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(createElement(Fragment, { key: key++ }, text.slice(last)));
  }
  return parts;
}
