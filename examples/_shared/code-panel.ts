/**
 * Renders the demo's source as a slide-out panel of "ready-to-paste"
 * snippet cards. Each demo annotates its `main.ts` with marker
 * comments; this module parses them and builds the UI at runtime.
 *
 * Marker grammar (each marker on its own line, leading whitespace
 * tolerated):
 *
 *     // @snippet <slug>
 *     // @title <human-readable title>           (optional)
 *     // @desc <one-line description, can repeat>
 *     <code lines — normal comments stay verbatim>
 *     // @endsnippet
 *
 * The slug is a stable id (kebab-case) used by the recipes index
 * page to deep-link individual snippets across demos. Marker lines
 * (`@snippet`, `@title`, `@desc`, `@endsnippet`) are stripped from
 * the rendered code; everything else inside the block is preserved
 * verbatim, with a uniform leading-indent strip so the rendered
 * snippet starts at column 0.
 *
 * Usage from a demo's main.ts:
 *
 *     import source from './main.ts?raw';
 *     import { mountCodePanel } from '../_shared/code-panel';
 *     mountCodePanel(source);
 *
 * The panel is toggleable via a fixed-position button. State
 * (open/closed) persists across sessions in localStorage.
 */

export interface Snippet {
    /** Stable kebab-case id. */
    slug: string;
    /** Human-readable title. Falls back to the slug. */
    title: string;
    /** Multi-line description (each `@desc` line joined with newline). */
    description: string;
    /** Snippet body, with marker lines removed and indentation normalized. */
    code: string;
}

/**
 * Parses snippet markers out of a TypeScript source file. Returns
 * one `Snippet` per `@snippet` … `@endsnippet` block, in source
 * order. Unbalanced markers (start without end, or vice versa) are
 * silently ignored — the parser is forgiving so a half-finished
 * annotation never breaks the demo.
 */
export function parseSnippets(source: string): Snippet[] {
    const lines = source.split('\n');
    const out: Snippet[] = [];
    let inSnippet = false;
    let slug = '';
    let title = '';
    const descLines: string[] = [];
    const codeLines: string[] = [];

    const startRe = /^\s*\/\/\s*@snippet\s+(\S+)\s*$/;
    const titleRe = /^\s*\/\/\s*@title\s+(.+?)\s*$/;
    const descRe = /^\s*\/\/\s*@desc\s+(.+?)\s*$/;
    const endRe = /^\s*\/\/\s*@endsnippet\s*$/;

    for (const line of lines) {
        if (!inSnippet) {
            const m = startRe.exec(line);
            if (m) {
                inSnippet = true;
                slug = m[1]!;
                title = '';
                descLines.length = 0;
                codeLines.length = 0;
            }
            continue;
        }
        if (endRe.test(line)) {
            out.push({
                slug,
                title: title || slug,
                description: descLines.join('\n'),
                code: dedent(codeLines).join('\n'),
            });
            inSnippet = false;
            continue;
        }
        const tm = titleRe.exec(line);
        if (tm) {
            title = tm[1]!;
            continue;
        }
        const dm = descRe.exec(line);
        if (dm) {
            descLines.push(dm[1]!);
            continue;
        }
        codeLines.push(line);
    }

    return out;
}

/**
 * Strips the smallest common leading-whitespace prefix from every
 * line so the rendered snippet starts at column 0. Blank lines are
 * ignored when computing the prefix and emitted as empty strings.
 */
function dedent(lines: string[]): string[] {
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim() === '') continue;
        const m = /^(\s*)/.exec(line);
        const indent = m ? m[1]!.length : 0;
        if (indent < minIndent) minIndent = indent;
    }
    if (minIndent === Infinity || minIndent === 0) return lines.slice();
    return lines.map((line) => (line.trim() === '' ? '' : line.slice(minIndent)));
}

/**
 * Renders the snippet panel into the document. Idempotent — calling
 * twice replaces the previous panel. Pass `''` for an empty source
 * to render an empty panel (used by the recipes aggregator before
 * it appends snippets manually via `addCard`).
 */
export function mountCodePanel(source: string): void {
    ensureStylesInjected();
    const snippets = parseSnippets(source);

    let host = document.getElementById('pp-code-panel');
    if (host !== null) host.remove();

    host = document.createElement('aside');
    host.id = 'pp-code-panel';

    const toggle = document.createElement('button');
    toggle.id = 'pp-code-panel-toggle';
    toggle.type = 'button';
    toggle.textContent = 'code ›';
    toggle.title = 'Toggle ready-to-paste snippets';

    const drawer = document.createElement('div');
    drawer.className = 'pp-code-drawer';

    const header = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = 'Snippets';
    const subhead = document.createElement('p');
    subhead.className = 'pp-code-subhead';
    subhead.textContent =
        snippets.length > 0
            ? `${snippets.length} ready-to-paste block${snippets.length === 1 ? '' : 's'} from this demo`
            : 'No snippets annotated yet for this demo.';
    header.append(heading, subhead);
    drawer.append(header);

    for (const s of snippets) {
        drawer.append(renderCard(s));
    }

    host.append(toggle, drawer);
    document.body.append(host);

    const STORAGE_KEY = 'pp-code-panel-open';
    const initiallyOpen = localStorage.getItem(STORAGE_KEY) === '1';
    if (initiallyOpen) host.classList.add('pp-open');
    toggle.addEventListener('click', () => {
        const next = !host!.classList.contains('pp-open');
        host!.classList.toggle('pp-open', next);
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    });
}

/**
 * Builds the card DOM for a single snippet. Exported so the recipes
 * aggregator page can reuse the same look across multiple demos.
 */
export function renderCard(s: Snippet): HTMLElement {
    const card = document.createElement('article');
    card.className = 'pp-snippet-card';
    card.id = `snippet-${s.slug}`;

    const cardHeader = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = s.title;
    cardHeader.append(h3);

    if (s.description.length > 0) {
        const desc = document.createElement('p');
        desc.className = 'pp-snippet-desc';
        desc.textContent = s.description;
        cardHeader.append(desc);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'pp-snippet-copy';
    copy.textContent = 'copy';
    copy.addEventListener('click', () => {
        navigator.clipboard.writeText(s.code).then(
            () => {
                copy.textContent = 'copied';
                window.setTimeout(() => {
                    copy.textContent = 'copy';
                }, 1500);
            },
            () => {
                copy.textContent = 'failed';
            },
        );
    });

    const pre = document.createElement('pre');
    pre.className = 'pp-snippet-code';
    const code = document.createElement('code');
    code.textContent = s.code;
    pre.append(code);

    card.append(cardHeader, copy, pre);
    return card;
}

let stylesInjected = false;
function ensureStylesInjected(): void {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.append(style);
}

const PANEL_CSS = `
#pp-code-panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    z-index: 999;
    display: flex;
    pointer-events: none;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
#pp-code-panel-toggle {
    pointer-events: auto;
    align-self: center;
    background: #1a1f29;
    color: #cfd6e0;
    border: 1px solid #2a2f3a;
    border-right: none;
    border-radius: 4px 0 0 4px;
    padding: 8px 6px;
    font-size: 11px;
    font-family: monospace;
    writing-mode: vertical-rl;
    cursor: pointer;
    margin-right: 0;
}
#pp-code-panel-toggle:hover { background: #232936; color: #fff; }
#pp-code-panel.pp-open #pp-code-panel-toggle::after { content: ''; }
.pp-code-drawer {
    pointer-events: auto;
    width: 0;
    background: #0d1117;
    border-left: 1px solid #1a1f29;
    overflow-y: auto;
    overflow-x: hidden;
    transition: width 200ms ease;
    box-sizing: border-box;
}
#pp-code-panel.pp-open .pp-code-drawer {
    width: min(480px, 90vw);
    padding: 16px 18px 80px;
}
.pp-code-drawer header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #cfd6e0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.pp-code-drawer header .pp-code-subhead {
    margin: 4px 0 16px;
    font-size: 12px;
    color: #8b949e;
}
.pp-snippet-card {
    background: #0f141c;
    border: 1px solid #1a1f29;
    border-radius: 4px;
    margin: 0 0 16px;
    padding: 12px 14px 14px;
    position: relative;
}
.pp-snippet-card h3 {
    margin: 0;
    font-size: 13px;
    color: #cfd6e0;
    font-weight: 600;
}
.pp-snippet-desc {
    margin: 6px 0 8px;
    font-size: 12px;
    line-height: 1.5;
    color: #8b949e;
    white-space: pre-line;
}
.pp-snippet-copy {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #14181f;
    color: #8b949e;
    border: 1px solid #1a1f29;
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    text-transform: lowercase;
}
.pp-snippet-copy:hover { color: #cfd6e0; background: #1a1f29; }
.pp-snippet-code {
    margin: 6px 0 0;
    padding: 10px 12px;
    background: #14181f;
    border-radius: 3px;
    overflow-x: auto;
    font-size: 11px;
    line-height: 1.55;
    color: #cfd6e0;
}
.pp-snippet-code code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (max-width: 720px) {
    #pp-code-panel {
        top: auto;
        bottom: 0;
        width: 100%;
        height: auto;
        flex-direction: column;
    }
    #pp-code-panel-toggle {
        writing-mode: horizontal-tb;
        align-self: flex-end;
        border: 1px solid #2a2f3a;
        border-bottom: none;
        border-radius: 4px 4px 0 0;
        margin-right: 12px;
    }
    .pp-code-drawer {
        width: 100% !important;
        height: 0;
        transition: height 200ms ease;
        border-left: none;
        border-top: 1px solid #1a1f29;
    }
    #pp-code-panel.pp-open .pp-code-drawer {
        height: 60vh;
        padding: 16px 18px 24px;
    }
}
`;
