// Pictures bundled into main.js as data: URLs (esbuild loader '.jpg': 'dataurl'): the film's poster of What's new.
declare module '*.jpg' {
    const url: string;
    export default url;
}
