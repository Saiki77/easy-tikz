<video src="https://github.com/user-attachments/assets/5451e9d3-ed46-4a01-ae7f-18da5dd030a5" controls width="100%"></video>

<p align="center"><a href="https://www.youtube.com/watch?v=X--vCnK-u7Q">Watch the 6.0 film on YouTube</a></p>

<h3 align="center">Every idea deserves a picture.</h3>

<p align="center">Easy Graphs Charts and TikZ is an Obsidian plugin for math charts. Rest the pointer on a formula, or write a chart in LaTeX, Python or GeoGebra: functions, fractals, matrices that move the plane, vector fields, machine learning, and charts that answer your questions. It draws on phones too, and exports pgfplots code that compiles with pdflatex.</p>

<p align="center"><b><a href="https://community.obsidian.md/plugins/easy-tikz">Get it in Obsidian</a></b>: Settings › Community plugins › Browse, search "Easy Graphs". Free and open source.</p>

### A complete editor

<img src="docs/media/readme/editor.png" alt="The Easy Graphs Charts and TikZ editor on the area between the cubic f(x) = x³ − 3x and its tangent at a. On the left, cards for the function, the hidden tangent and the shaded region; on the right, the live preview with the tangent, the orange area labelled A = 2.76 and the title slope at x = 0.8: −1.08, and under it the slider a. The tabs Build, Chart, Code, Help and AI are at the top." width="100%">

Click any chart to open it. Everything is connected: drag a line, a point or a label in the preview and its formula follows, drag a 3D chart to turn it, scroll to zoom. No fiddling with code or camera angles. A card for each object, sliders with play, and the pgfplots code ready to copy.

<img src="docs/media/readme/picker.png" alt="The editor with the + Add picker open: a search field on top, the groups Functions, Regions, Curves and lines, Points, Segments and arrows, Data, Probability, Calculus, Labels, Sliders and Templates on the left, and the five items of Points on the right, each with a line about what it does: points from a list, intersections of two functions, corner points of a region, the optimum over a region and the integer points in a region." width="100%">

**+ Add** holds a wide range of ready-made parts, sorted into groups and found by search: regions, curves and lines, crossings, corners and the optimum of a region, arrows and braces, data with a regression line, probability, Riemann sums, slope fields, values and vectors, linear algebra, motion, iterations, coloured planes, labels, sliders and templates.

### Charts that move

<img src="docs/media/v6-motion.png" alt="Two charts. The damped pendulum: arrows coloured by length, particles flowing along them, and the rest points labelled stable spiral and saddle. The Lorenz attractor in 3D, its two wings coloured by time from blue through purple to orange." width="100%">

Vector fields with moving particles and their rest points, solutions of systems in 2D and 3D, and charts that play in steps.

### Write it in Python or GeoGebra

<img src="docs/media/v6-code.png" alt="Two charts. Left: a small neural network learning two rings of points in a Python block, at training step 530: the blue region inside a closed black boundary around the blue points, red around it. Right: a chart from GeoGebra lines, a triangle ABC with the round curve through its three corners, a segment to a midpoint and a Sequence of points, with its ten input lines printed under it." width="100%">

A Python block with NumPy and matplotlib draws in the chart and can play over time, so a network learns while you watch. GeoGebra lines paste as they are. Or [ask any chatbot](docs/ai.md) to write the chart.

### A matrix moves the plane

<img src="docs/media/v6-matrix.png" alt="The grid, the basis vectors î and ĵ and the unit square, half way through the move to the matrix A = [[1.5, 1], [0.5, 2]]: the grid lines lean, the old grid stays faint behind them, the square's area changes on its way, and the strip under the chart shows Pause and Step 2 of 3. Beside it the finished picture with the eigenvectors labelled λ₁ = 2.5 and λ₂ = 1 and the square labelled det A = 2.5." width="100%">

Draw the grid and î, ĵ, then transform the plane by a matrix or by z ↦ z². Press Play and the plane moves, with det A and the eigenvectors.

### Fractals, live

<img src="docs/media/v6-fractal.png" alt="The Mandelbrot set, coloured by how fast each point escapes, with a point P near its edge and the orbit of 0 for c = P as a red path that closes into a triangle. Beside it a Julia set with its sliders a and b." width="100%">

A formula colours the plane: the Mandelbrot set, Julia sets on sliders, Newton basins and complex functions. The GPU paints it while you drag.

### Ask the curve

<img src="docs/media/v6-ask.png" alt="The editor with the parabola g(x) = x² − 4 and the line h(x) = 2 − x. A click on g opened a menu of questions: where is g ≤ 0, where does g cross the x-axis, its maxima and minima, the tangent here, a chord, the area to the x-axis, a Riemann sum. The pointer rests on the first question, and its answer shows faintly in the chart: the bar from −2 to 2 on the x-axis labelled {x ∣ g(x) ≤ 0} = [−2, 2]." width="100%">

Click a curve and ask: where is f ≤ 0, where do f and g cross, the tangent here, the area between them. The answer becomes a line of the chart.

### Notes that read sets and maps

<img src="docs/media/v6-hover.png" alt="A note that defines g(x) = x² − 4 and says that the set {x ∈ ℝⁿ ∣ g(x) ≤ 0} is convex. The pointer rests on the set, and its card shows the parabola with the set marked on the x-axis from −2 to 2, a small switch n = 1 / n = 2, the line g(x) = x² − 4, from this note, and the buttons Open in the editor and Insert chart." width="100%">

Sets, maps, intervals, inequalities, matrices, recurrences and sums in your notes open a chart too, with g taken from the note.

### Values, sums and iterations

<img src="docs/media/v6-iterate.png" alt="Four charts. The Taylor polynomial of sin(x) as a sum with n on a slider, hugging the sine. The 7th roots of unity joined into a heptagon, each labelled. The cobweb of the logistic map at r = 3.7. The bifurcation diagram of the logistic map from r = 2.5 to 4." width="100%">

Complex numbers, vectors, matrices and sums in every formula; orbits, cobwebs, bifurcation diagrams, Newton's method and Fourier circles.

### Write charts in LaTeX

<img src="docs/media/readme/language.png" alt="A linear program drawn from LaTeX: the shaded feasible region with numbered constraint lines, the dashed line z = 6 and the optimum, with a slider for c. Beside it, a switch between Words + LaTeX math and Full LaTeX, and the chart's text with its formulas in dollars." width="100%">

Formulas are LaTeX in dollars, as in your notes. Or write whole charts as LaTeX commands, as in pgfplots.

### Sliders that move together

<img src="docs/media/readme/connected.png" alt="Two charts side by side, the parabola a x² and the curve a sin(x), joined by a link symbol. Both sliders a stand at 1.5." width="100%">

Any number can be a slider. Sliders with the same name move together in all charts of a note.

### Fast 3D

<img src="docs/media/readme/3d.png" alt="The peaks surface in 3D: a landscape with a high peak, a smaller one and a deep valley, solid and coloured by height from dark blue to yellow, drawn from 10,000 polygons in a cube box with numbers on its edges, and under it the slider a." width="100%">

Solid surfaces, coloured by height, turn under your pointer and follow their sliders: about 60 frames per second for a typical surface, above 30 with 14,400 polygons. The PDF draws the same picture.

### Data, probability and calculus

<img src="docs/media/readme/pictures.png" alt="Four charts. Points from a table with their regression line y = 4.14x + 47.7, R² = 0.99. A normal distribution with P(−1 ≤ X ≤ 1) = 0.683 shaded. The left Riemann sum of x² with 6 parts, 2.037, next to the integral 2.667. The slope field of y′ = x − y with the solution through a point." width="100%">

Points from a Markdown table with their regression line, distributions with a shaded probability, Riemann sums, and slope fields with their solutions.

### Charts as SVG files

<img src="docs/media/readme/svg.png" alt="A vault folder Calculus with the note Week 3.md and the file Week 3 · chart 1.svg, the line that embeds the file, and the chart on white as the file shows it." width="100%">

Every chart can also be an SVG file in your vault, so Obsidian Publish and GitHub show it.

### Learn it step by step

<img src="docs/media/readme/help.png" alt="The Help tab of the editor: a search field, Start here with four first guides (your first chart, every formula is a chart, drag shapes to edit them, ask the curve), the card Write a chart in words with its lines beside the linear program they draw, and the row New in 6 with the Lorenz system, complex functions seen two ways, turning wheels that draw square and sawtooth waves, and the orbit of a point in the Mandelbrot set." width="100%">

The Help tab starts with Start here and New in 6, then 79 short guides by topic. Each step shows its chart live with its sliders, and the lines it adds to the chart, so you learn the chart language while you build.

---

[Plugin page in Obsidian](https://community.obsidian.md/plugins/easy-tikz) · **79 step-by-step guides** in the Help tab and [on GitHub](docs/guides/README.md) · [What's new in 6.0](docs/whats-new.md) · [Make charts with AI](docs/ai.md) · [Reference](docs/reference.md) · [Changelog](CHANGELOG.md)

**Privacy:** nothing goes to the internet, and there is no telemetry. The one exception: the 6.0 film in What's new loads from YouTube (`youtube-nocookie.com`) when you press Play, and not before. AI access (off by default) answers on `127.0.0.1` only, with your token. [All details](docs/reference.md#privacy-and-permissions)

[MIT](LICENSE.md) · [Developing Easy Graphs Charts and TikZ](docs/development.md)
