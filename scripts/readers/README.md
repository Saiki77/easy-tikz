# Formula hover readers: the gap harness

The formula hover works in three steps:

1. **Recognition.** The network (`src/notes6/recognize`) picks the card kind of a formula.
2. **Reader.** A reader turns the formula's TeX into **parses**: what the formula says, as named roles.
3. **Builder.** `buildCard` (`src/readers/build.ts`) turns a parse and the note's definitions into the card.

`src/readers/types.ts` defines one parse shape per card kind and the `Reader` interface. Reader 0 (`src/readers/reader0.ts`) is the regex readers of 6.2.1. Any other reader plugs in at step 2. This harness measures a reader.

## Run it

```sh
node scripts/readers/gap.mjs                       # reader 0
node scripts/readers/gap.mjs path/to/reader.mjs    # your reader (.mjs, .js or .ts)
node scripts/readers/gap.mjs reader.mjs --examples 5 --json out.json
node scripts/readers/gap.mjs reader.mjs --stride 10   # a fast subset: every 10th formula
```

| Option | Default |
| --- | --- |
| `--data DIR` | the hover-ml folder in the experiment's scratchpad |
| `--corpus F,F` | `DIR/data/{train_r4,dev_r4,hard_dev_r4,r3_dev_r4,r4_dev}.jsonl` (10,799 formulas, gold labels) |
| `--suite F`, `--no-suite` | `DIR/designed3-frozen/suite.jsonl` (49,851 spelling variants) |
| `--gold F` | `DIR/reader-data/gold.jsonl` |
| `--expected F` | `DIR/reader-data/suite-expected.jsonl` |
| `--kinds k,k` | all 19 kinds |
| `--limit N`, `--stride N` | all formulas |
| `--examples N` | 0: list no failures |
| `--json F` | none: write the counts and every failure as JSON |
| `--write-gold DIR` | write reader 0's gold parses to DIR (see below) |

The whole run takes about 20 s.

## The reader module

Export one of these:

- `read(tex, kind, ctx)`,
- `reader` with a method `read`,
- a default export (a function or an object with `read`).

`read` returns a parse, a list of parses (best first) or `null`. An optional `async setup()` runs once before the first formula.

- `tex`: the formula as the note writes it (one row of an aligned block).
- `kind`: the label the network chose (`function`, `sum`, ...).
- `ctx`: what is around the formula (`ReadContext` in `src/readers/types.ts`):
  - `functions`: the functions the note defines;
  - `domains`: the sets the note names;
  - `context`: the words around the formula;
  - `note`: the note's id;
  - `defs`: the note's defining formulas.

The hover builds the parses in order. The first parse whose card is of the asked kind wins. Without one, the first card that builds shows.

## The parse shapes

All shapes are plain JSON. `src/readers/types.ts` gives each field and examples.

| Kind | Roles |
| --- | --- |
| function | `functions` [{`name`, `body`}], `variables` [x-axis, y-axis name], `domain` {from, to} |
| surface | `body`, `variables` [two] |
| polar | `body`, `variable` (the angle) |
| implicit | `equation`, `variables` |
| region | `condition` (joined by commas), `variables` |
| set | `variables` (one, or two for pairs), `condition`, `space` (the power of ℝ) |
| map | `name`, `domain`, `codomain` |
| condition | `variable`, `condition` (joined by `\text{ and }`) |
| interval | `variable`, `left`, `lower`, `upper`, `right` |
| jensen | `name`, `weight` |
| epigraph | `name` |
| matrix | `name`, `entries` (rows of cells) |
| product | `matrix`, `vector` (names) |
| det | `matrix` (a name) or `entries` |
| eigen | `matrix`, `vector` |
| recurrence | `state`, `index`, `step` |
| sum | `index`, `lower`, `upper`, `body`, `value` |
| domain | `name`, `body`, `variable` (z, or s) |
| vector | `statements` [{`name`, `nameTex`, `sides` [{`value`, `tex`}], `names`}] |

Write bodies in the formula's own variables, as written. Name these variables in `variables` or `variable`. The builder renames them into the chart's x, y, θ or z (`inVariables` in `src/formula.ts`).

## What it counts

The harness runs the plugin's own pipeline: `recognize`, then the reader, then `smartCard` (`src/notes6/recognize/decide.ts`).

Corpus (gold label K, and the network also says K):

| Column | Count |
| --- | --- |
| `a` | No card of kind K builds. `other`: a card of another kind shows. `rules`: the fall back to Rules shows a card. |
| `b` | The card of kind K builds, but it draws something else than the gold parse. |
| `nogold` | The formula has no gold parse (reader 0 drew no card of kind K for it: `missing.jsonl`). |

Suite (label-keeping variants whose plain spelling has a gold parse, and the network says K):

| Column | Count |
| --- | --- |
| `c.none` | No card of kind K builds for the variant. |
| `c.wrong` | The card builds, but it draws something else than the plain spelling's gold parse. |

False cards (gold `none`):

- the network gives a card;
- the reader's card builds;
- a card shows (also with the fall back to Rules);
- the formula gets the dotted mark.

**"Draws something else"**: the parse differs from the gold parse in `parseKey` (`src/readers/build.ts`), and the card lines differ too. `parseKey` compares each TeX role as the chart reads it (`latexToPlain`, no spaces, `2 \cdot x` as `2x`). It leaves out the labels only: a function's own name, a vector's TeX. So `\tfrac12` and `\frac{1}{2}` are the same, but `x^2 \nonumber` is not `x^2` (the chart reads `nonumber` as a name).

## Reader data (in `DIR/reader-data/`)

| File | Content |
| --- | --- |
| `gold.jsonl` | 1,664 gold parses: corpus formulas whose gold label has a card and reader 0 draws a card of that kind. Fields: `id`, `file`, `tex`, `label`, `network`, `note`, `context`, `defs`, `parse`, `lines` (the card), `checked`, `fixed`. |
| `review.jsonl` | The hand review: 200 gold parses, drawn by kind (`verdict`: `ok` or `fixed`, with the fixed `parse` and a `note`). |
| `missing.jsonl` | 280 corpus formulas whose gold label has a card, but reader 0 draws no card of that kind. `shown`: the card of another kind, if any. `reader0`: the parses reader 0 read. A new reader helps most here. |
| `suite-expected.jsonl` | 15,038 suite variants with their expected parse: the gold parse of the plain spelling (`source: gold`), or reader 0's parse of a seed's plain spelling (`source: reader0-base`). |

`--write-gold DIR` writes these files again and merges `DIR/review.jsonl` in. Run it after a change to reader 0 only.

## Reader 0 (6.2.2)

| Kind | net=K | a | b | variants | c |
| --- | ---: | ---: | ---: | ---: | ---: |
| function | 481 | 38 (7.9%) | 0 | 5056 | 39.1% |
| surface | 75 | 4 (5.3%) | 2 | 840 | 42.7% |
| polar | 10 | 1 (10.0%) | 1 | 223 | 52.5% |
| implicit | 78 | 7 (9.0%) | 0 | 600 | 31.7% |
| region | 92 | 32 (34.8%) | 1 | 214 | 37.4% |
| set | 64 | 2 (3.1%) | 2 | 943 | 5.6% |
| map | 40 | 0 | 0 | 566 | 19.1% |
| condition | 108 | 5 (4.6%) | 1 | 739 | 41.1% |
| interval | 112 | 3 (2.7%) | 0 | 774 | 44.6% |
| jensen | 8 | 2 (25.0%) | 0 | 96 | 13.5% |
| epigraph | 11 | 0 | 0 | 152 | 11.2% |
| matrix | 151 | 8 (5.3%) | 1 | 683 | 50.1% |
| product | 30 | 19 (63.3%) | 0 | 204 | 37.3% |
| det | 8 | 0 | 0 | 121 | 46.3% |
| eigen | 50 | 24 (48.0%) | 0 | 322 | 41.9% |
| recurrence | 35 | 0 | 0 | 471 | 49.0% |
| sum | 40 | 5 (12.5%) | 0 | 450 | 47.8% |
| domain | 82 | 4 (4.9%) | 5 | 1076 | 55.9% |
| vector | 198 | 0 | 1 | 1363 | 31.8% |
| **all** | **1673** | **154 (9.2%)** | **14 (0.8%)** | **14893** | **37.9%** |

False cards: of 8,855 gold-none formulas, the network gives 165 a card; 138 show one, 140 get the mark.

Reader 0's `b` is the hand-review fixes that change what the card draws. Its `c` comes mostly from layout that reader 0 keeps in its parses: `\tag`, `\label`, `\nonumber`, `\boxed`, `\color`, `\hspace`, comments, a word before the formula, Unicode signs.

## Tests

`tests/readers.test.ts` runs `measure` (in `harness.ts`) on `tests/readers-fixture.json`, a committed subset: 496 corpus formulas and 152 suite variants. When the corpus is on this machine, it also runs on all of it. Each run fails when reader 0 gets more gaps or false cards.
