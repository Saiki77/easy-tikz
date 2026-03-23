# TikZ Graph Helper

An [Obsidian](https://obsidian.md) plugin for creating TikZ/pgfplots graphs through an intuitive visual editor with live preview.

## Features

- **Live SVG preview** — see your graph update in real-time as you change settings (no external plugins needed)
- **2D function plots** — plot mathematical functions with customizable color, thickness, dashing, and fill
- **3D surface plots** — render 3D surfaces with wireframe or filled mode, adjustable opacity, and interactive mouse rotation
- **Tangent lines** — compute and display tangent lines at any point
- **Extrema detection** — automatically find and mark local minima/maxima
- **TikZ code generation** — generates valid pgfplots code you can copy or insert directly into your notes
- **Dark/light theme support** — respects your Obsidian theme

## Usage

1. Click the function icon in the ribbon (or use the command palette)
2. Configure your graph using the tabbed settings panel:
   - **Graph** — title, dimensions, 2D/3D mode toggle, camera controls (3D)
   - **Axis** — labels, ranges, axis style
   - **Functions** — add functions with expression, domain, styling, and analysis options
   - **Grid** — major/minor grid lines
   - **Code** — view the generated TikZ code
3. The live preview on the right updates as you edit
4. In 3D mode, **drag the preview** to rotate the camera
5. Click **Copy TikZ Code** or **Insert into Note** when done

### 2D Functions

Enter any JavaScript math expression using `x`:
- `x^2`, `x^3 - 3*x`, `1/x`
- `sin(deg(x))`, `cos(deg(x))`, `Math.exp(x)`

### 3D Surfaces

Enter expressions using `x` and `y`:
- `sin(x)*cos(y)`
- `x^2 + y^2`
- `sin(Math.sqrt(x^2 + y^2))`

## Installation

### Via BRAT (recommended for beta)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add `Saiki77/tikz-graph-help` as a beta plugin

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Saiki77/tikz-graph-help/releases)
2. Create a folder `tikz_graph_helper` in your vault's `.obsidian/plugins/` directory
3. Place the downloaded files in that folder
4. Enable the plugin in Obsidian settings

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
