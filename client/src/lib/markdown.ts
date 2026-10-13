import { Marked } from 'marked';

/**
 * The guides' Markdown renderer, shared by the studio and platform Help pages.
 *
 * Its output is set as HTML directly, which is safe only because the input is
 * ours: guides are files in this repository, never anything a user typed.
 * Should a guide ever come from somewhere else, this needs a sanitiser before
 * it needs anything else.
 */

/** GitHub's heading ids, so the guides' own "Contents" links keep working. */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${headingId(text)}">${html}</h${depth}>\n`;
    },
  },
});

/** A guide as HTML, without its first heading — the page head already shows the title. */
export function renderGuide(source: string): string {
  return markdown.parse(source.replace(/^# .*\n+/, '')) as string;
}
