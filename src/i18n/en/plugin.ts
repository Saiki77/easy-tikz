/* The plugin itself: commands, settings, notices, charts in notes (their problem line, sliders, width and alignment), the chart under a block being edited, the rewrite after changed chart words. Owner: main.ts, src/live.ts, src/settings.ts, src/text/reword.ts. */
export const plugin = {
    'plugin.settings.language.name': 'Interface language',
    'plugin.settings.language.desc':
        'Menus, buttons, settings, messages and the guides in the Help tab. Follow Obsidian uses the language Obsidian is set to, and a language Easy TikZ does not have yet shows in English. Formulas and the words of the chart language stay as they are. Command names change after Obsidian restarts.',
    'plugin.settings.language.auto': 'Follow Obsidian ({language})',

    // Commands (named once, when the plugin loads).
    'plugin.command.openEditor': 'Open editor',
    'plugin.command.whatsNew': "Show what's new in version 4",
    'plugin.command.copyAiGuide': 'Copy the guide for AI chats (ChatGPT, Claude, Gemini)',

    // Settings.
    'plugin.settings.format.name': 'Write new charts as',
    'plugin.settings.format.desc':
        'Text (default): one line per object, in words, such as plot f(x) = x^2 in blue. JSON: one object with every setting. A chart you edit keeps the format its block has.',
    'plugin.settings.format.text': 'Text',
    'plugin.settings.colours.name': 'Chart colours',
    'plugin.settings.colours.desc':
        'From your theme (default): charts use the colours of your Obsidian theme and follow light and dark mode. As in the LaTeX export: the fixed colours of the exported figure, so the note and the PDF look the same.',
    'plugin.settings.colours.theme': 'From your theme',
    'plugin.settings.colours.export': 'As in the LaTeX export',
    'plugin.settings.imageBackground.name': 'Copied images',
    'plugin.settings.imageBackground.desc': 'Background of Copy PNG and Copy SVG. White uses the light theme\'s colours, so the picture reads on paper also from a dark theme.',
    'plugin.settings.imageBackground.transparent': 'Transparent, theme colours',
    'plugin.settings.imageBackground.white': 'White',
    'plugin.settings.liveChart.name': 'Chart under the block while you edit',
    'plugin.settings.liveChart.desc':
        'On by default. In Live Preview, a block you are editing shows its chart right under its lines, and the chart changes as you type. Off: the chart shows once the cursor leaves the block.',
    'plugin.settings.words.heading': 'Chart words',
    'plugin.settings.words.name': 'Your words',
    'plugin.settings.words.descEmpty':
        'Give the pieces of the chart language your own words, in your language or your own terms (plot can be graph, or zeichne), and bundle options under one word of your own. The built-in words keep working.',
    'plugin.settings.words.descPieces': '{pieces, plural, one {# piece} other {# pieces}} of the chart language with your words. The built-in words keep working.',
    'plugin.settings.words.descPiecesBundles':
        '{pieces, plural, one {# piece} other {# pieces}} of the chart language with your words, and {bundles, plural, one {# word} other {# words}} of your own for several options. The built-in words keep working.',
    'plugin.settings.words.edit': 'Edit words',
    'plugin.settings.wordsWrite.name': 'Write charts with',
    'plugin.settings.wordsWrite.desc':
        'Your words (default): the editor and the AI tools write charts in your words. The built-in words: they write the built-in ones, and your words are only read.',
    'plugin.settings.wordsWrite.yours': 'Your words',
    'plugin.settings.wordsWrite.builtin': 'The built-in words',
    'plugin.settings.animate.name': 'Animate chart changes',
    'plugin.settings.animate.desc':
        'On by default. When a block in a note changes, numbers glide to their new values and new objects pop in. Charts never move when your system asks for reduced motion.',
    'plugin.settings.invertDrag.name': 'Invert vertical drag in 3D',
    'plugin.settings.invertDrag.desc':
        'Off (default): drag down tilts the scene up (camera elevation rises), drag up tilts the scene down - the trackball convention. On: drag down lowers the camera, drag up raises it - direct manipulation.',
    'plugin.settings.samples3D.name': 'Max 3D samples per axis',
    'plugin.settings.samples3D.desc':
        'Upper bound of the Samples slider on each 3D surface card (default 80, at most 120). The exported pgfplots code always uses at most 60 samples per axis, because pdflatex runs out of memory above that. Re-open the Easy TikZ modal after changing this.',
    'plugin.settings.pan.name': '2D pan sensitivity',
    'plugin.settings.pan.desc':
        'Default 1.0 - direct manipulation: moving the mouse by N pixels pans the chart by exactly N chart pixels. Lower values dampen the drag for finer control on dense plots (e.g. 0.5 = half-step pan); higher values overshoot. The pan rate also scales with the current axis range, so this multiplier stays consistent as you zoom in or out.',
    'plugin.settings.tikzBlocks.name': 'Also render plain `tikz` blocks',
    'plugin.settings.tikzBlocks.desc':
        'Off by default. When on, the plugin renders blocks tagged plain ```tikz the same way it renders ```easy-tikz blocks. Useful if you want one tag for everything, but conflicts with `obsidian-tikzjax` and other plugins that claim ```tikz. Reload Obsidian after changing this for the registration to take effect.',
    'plugin.settings.whatsNew.name': "Show what's new after updates",
    'plugin.settings.whatsNew.desc':
        'On by default. After an update that brings something new, a short popup shows what changed, once. The command "{command}" and the Help tab of the editor open it at any time.',

    // Settings: AI access.
    'plugin.settings.ai.heading': 'AI access',
    'plugin.settings.ai.server.name': 'Let AI apps make charts',
    'plugin.settings.ai.server.desc':
        'Off by default. Starts a small server on this computer only (127.0.0.1) that AI apps such as Claude Code, Codex, Cursor or VS Code use to read the chart guide, check charts, see them and add them to your notes. Every request needs the token below, web pages cannot use it, and it only adds Easy TikZ charts to notes or replaces them, never in files with instructions for AI agents. A notice shows each change, with Undo for changed notes.',
    'plugin.settings.ai.status.name': 'Status',
    'plugin.settings.ai.status.running': 'Running at {mcp} (MCP) and {guide}.',
    'plugin.settings.ai.status.notRunning': 'Not running: {reason}',
    'plugin.settings.ai.status.starting': 'Not running: starting...',
    'plugin.settings.ai.restart': 'Restart',
    'plugin.settings.ai.port.name': 'Port',
    'plugin.settings.ai.port.desc': 'Default 27150. After a change, update the address in your AI apps.',
    'plugin.settings.ai.port.invalid': 'A whole number from 1024 to 65535.',
    'plugin.settings.ai.token.name': 'Token',
    'plugin.settings.ai.token.desc': '{token}. Every request must carry it. Make a new one if it got out, then update your apps.',
    'plugin.settings.ai.token.descNone': '(made when the server starts). Every request must carry it. Make a new one if it got out, then update your apps.',
    'plugin.settings.ai.token.copied': 'Token copied.',
    'plugin.settings.ai.token.new': 'New token',
    'plugin.settings.ai.connect.name': 'Connect an AI app',
    'plugin.settings.ai.connect.desc': 'Pick your app and copy what it needs, once. The app then reads the guide, checks charts and adds them to your notes by itself.',
    'plugin.settings.ai.connect.copied': 'Copied for {app}.',
    'plugin.settings.ai.agents.name': 'Tell AI agents in this vault',
    'plugin.settings.ai.agents.desc':
        'Adds a short Easy TikZ section to AGENTS.md and CLAUDE.md at the top of the vault (creating them if needed). Agents such as Claude Code, Codex, Cursor or Copilot read these files and then know how to make charts here, with or without the server.',
    'plugin.settings.ai.agents.done': 'Easy TikZ: added the chart section to {files}.',
    /** Two file names in a sentence, joined one after another: 'AGENTS.md and CLAUDE.md'. */
    'plugin.settings.ai.agents.and': '{list} and {name}',
    'plugin.settings.ai.agents.failed': 'Could not write the agent files: {error}',
    'plugin.settings.ai.guide.name': 'Copy the guide for AI chats',
    'plugin.settings.ai.guide.desc':
        'For ChatGPT, Claude, Gemini or any chat that cannot reach this computer: paste the guide into the chat, describe your chart, and paste the block it writes into a note.',

    // The AI server and the guide for AI chats.
    'plugin.ai.noServerHere': 'AI apps connect to Obsidian on a computer; phones and tablets have no AI server.',
    'plugin.ai.couldNotStart': 'Easy TikZ could not start the AI server: {error}',
    'plugin.ai.guideCopied': 'Easy TikZ: the AI guide is on the clipboard. Paste it into your AI chat, then describe the chart you want.',
    'plugin.ai.guideCopyFailed': 'Could not copy the guide: {error}',
    'plugin.copy.failed': 'Could not copy: {error}',

    // Blocks in notes that cannot be drawn.
    'plugin.block.rawTikz':
        'This looks like raw TikZ / pgfplots code rather than an Easy TikZ JSON block. Install obsidian-tikzjax (or similar) to render it, or recreate the chart via the Easy TikZ modal.',
    'plugin.block.renderError': 'Easy TikZ render error: {error}',
    /** Under a block being edited, while the block cannot be read. */
    'plugin.block.error': 'Easy TikZ: {error}',

    // Charts in notes.
    'plugin.chart.label': 'Easy TikZ chart. Click to edit.',
    /** Where a problem of a text block is: the source part of its problem line. */
    'plugin.chart.textProblemAt': 'Line {line}, column {column}',
    'plugin.chart.previewFailed': 'Preview failed: {error}',
    /** The problem line under a chart: the count of errors, then the first problem. */
    'plugin.chart.problems': '{count, plural, one {# problem} other {# problems}}: {first}',
    'plugin.chart.sliders': 'Chart sliders',
    'plugin.chart.showMore': 'Show {count} more',
    'plugin.chart.showLess': 'Show less',
    'plugin.chart.resetSliders': 'Reset sliders to the saved values',
    'plugin.chart.alignLeft': 'Align left',
    'plugin.chart.alignCenter': 'Center',
    'plugin.chart.alignRight': 'Align right',
    'plugin.chart.width': 'Chart width',
    'plugin.display.notFound':
        'Easy TikZ could not find this chart in the note (it may be inside a callout, use a ~~~ fence, or have been edited), so its width and alignment were not saved.',
    'plugin.display.saveFailed': 'Could not save the chart width or alignment: {error}',

    // Axis ranges that fall back to their defaults (src/settings.ts). The text follows "xmax: ", which stays as it is: the problem line and the range fields read it.
    'plugin.range.notFinite': 'not a finite number',
    'plugin.range.notAboveMin': 'must be greater than {min}',

    // After the chart words changed: charts in the vault that read differently now.
    'plugin.reword.title': 'Rewrite charts with your new words?',
    'plugin.reword.message':
        '{charts, plural, one {# chart} other {# charts}} in {notes, plural, one {# note} other {# notes}} {charts, plural, one {uses words you changed, so it no longer reads} other {use words you changed, so they no longer read}} as before. Rewrite them in your new words? Each line keeps its place and its comments; a chart is only rewritten when it stays exactly the same chart.',
    'plugin.reword.confirm': 'Rewrite {count, plural, one {# chart} other {# charts}}',
    'plugin.reword.done': 'Rewrote {count, plural, one {# chart} other {# charts}} with your new words.',
} as const;
