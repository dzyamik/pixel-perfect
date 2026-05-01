import { describe, expect, it } from 'vitest';
import { parseSnippets } from '../../examples/_shared/code-panel.js';

describe('code-panel parseSnippets', () => {
    it('extracts a single snippet with title and description', () => {
        const src = `
import * as Phaser from 'phaser';

// @snippet register-plugin
// @title Register the plugin once
// @desc Add this to your top-level Phaser.Game config so every
// @desc scene gets scene.pixelPerfect.terrain() / .sprite().
new Phaser.Game({
    plugins: { scene: [{ key: 'k', plugin: PixelPerfectPlugin, mapping: 'pixelPerfect' }] },
});
// @endsnippet

// other code follows
`;
        const out = parseSnippets(src);
        expect(out).toHaveLength(1);
        expect(out[0]!.slug).toBe('register-plugin');
        expect(out[0]!.title).toBe('Register the plugin once');
        expect(out[0]!.description).toContain('Phaser.Game config');
        expect(out[0]!.description.split('\n')).toHaveLength(2);
        expect(out[0]!.code).toContain('new Phaser.Game(');
        expect(out[0]!.code).not.toContain('@snippet');
        expect(out[0]!.code).not.toContain('@desc');
    });

    it('falls back to slug when no @title is given', () => {
        const src = `
// @snippet quick-fact
const x = 1;
// @endsnippet
`;
        const out = parseSnippets(src);
        expect(out[0]!.title).toBe('quick-fact');
        expect(out[0]!.description).toBe('');
    });

    it('strips uniform leading indentation from the rendered code', () => {
        const src = `
function example() {
    // @snippet indented
    const inner = {
        a: 1,
    };
    // @endsnippet
}
`;
        const out = parseSnippets(src);
        expect(out[0]!.code).toBe('const inner = {\n    a: 1,\n};');
    });

    it('preserves blank lines inside a snippet', () => {
        const src = `
// @snippet with-blanks
const a = 1;

const b = 2;
// @endsnippet
`;
        const out = parseSnippets(src);
        expect(out[0]!.code).toBe('const a = 1;\n\nconst b = 2;');
    });

    it('extracts multiple snippets in source order', () => {
        const src = `
// @snippet first
const a = 1;
// @endsnippet
// not annotated
const c = 3;
// @snippet second
const b = 2;
// @endsnippet
`;
        const out = parseSnippets(src);
        expect(out.map((s) => s.slug)).toEqual(['first', 'second']);
    });

    it('ignores an unbalanced @snippet without @endsnippet', () => {
        const src = `
// @snippet dangling
const a = 1;

// no end marker — parser silently drops it
`;
        const out = parseSnippets(src);
        expect(out).toHaveLength(0);
    });

    it('keeps normal // comments inside a snippet', () => {
        const src = `
// @snippet mixed-comments
// This is a normal comment that should appear in the output.
const a = 1; // trailing comment
// @endsnippet
`;
        const out = parseSnippets(src);
        expect(out[0]!.code).toContain('// This is a normal comment');
        expect(out[0]!.code).toContain('// trailing comment');
    });
});
