// Markdown files bundled as text (esbuild loader '.md': 'text'): the AI guide in docs/ai.md.
declare module '*.md' {
    const text: string;
    export default text;
}
