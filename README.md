# tts-reader

A read-aloud player for Quarto HTML documents. It speaks the document with the
browser's built-in speech synthesis, highlights the word and sentence being
read, and lets you click any word to start from exactly there.

It is designed for **auditory reading and text review**: helping authors listen
to their own prose while drafting, as well as assisting dyslexic readers,
second-language learners, readers with visual fatigue or ADHD, and anyone who
prefers listening to long-form articles.

> [!NOTE]
> **Screen Readers Notice**: This extension is not a replacement for native
> screen readers (such as NVDA or JAWS) used by visually impaired users.
> Synthesizing speech over a running screen reader creates conflicting dual
> audio. Users of dedicated screen readers should keep their assistive software
> active instead.

## Install

```bash
quarto add mancano-tales/quarto-tts-reader
```

Then update later with:

```bash
quarto update mancano-tales/quarto-tts-reader
```

## Use

Add the filter to your document:

```yaml
---
title: "My chapter"
format: html
filters:
  - tts-reader
---
```

Starting in v2.0.0, registering `tts-reader` in `filters:` enables the player by default in HTML output.

### Disabling on publication (Kill Switch)

If you register `tts-reader` globally in `_quarto.yml` but want to exclude the player from a published site, use `tts-reader-enabled: false` or pass the command-line flag `-M tts-reader-enabled=false`:

```yaml
---
title: "Published Chapter"
format: html
filters:
  - tts-reader
tts-reader-enabled: false
---
```

```bash
# publish command with kill switch:
quarto render chapter.qmd --to html -M tts-reader-enabled=false
```

The filter also refuses to load outside HTML formats that support JavaScript,
so PDF and DOCX output is untouched whatever the flag says.

## Controls

| Control | What it does |
|---|---|
| Play / Pause | Starts, or pauses and resumes near the word where you stopped |
| ⏮ / ⏭ | Previous / next block |
| ⏹ | Stop and clear highlighting |
| Speed | 0.75× to 2×, keeps your place when changed, remembered per browser |
| Lang | Narrows the voice list to one language; `Todos` shows every voice |
| Voice | Any voice the browser exposes; keeps your place when changed, remembered per browser |
| Click a word | Starts reading from that word — can be switched off in the ⚙ menu |

The language filter groups by the primary subtag, so choosing `pt` shows both
`pt-BR` and `pt-PT` voices. It starts on the document's own `lang` when the
browser has voices for it, and on `Todos` otherwise — a document that never
declared `lang:` gets `lang="en"` from Quarto, and filtering that strictly would
hide every voice the reader actually wants. Changing the filter never interrupts
what is playing: the voice being spoken stays in the list even when the filter
excludes it, until you pick a different one.

Turning **click a word** off in the ⚙ menu lets you double-click to select and
copy text without the first click of the pair starting the reader. The keyboard
cursor keeps working either way.

Citation links, footnote markers and other interactive elements stay clickable —
clicking a link navigates, it does not start the reader. Footnote reference
numbers are excluded from the spoken text, so you will not hear a stray digit
read out mid-sentence.

### Keyboard

The whole player works without a mouse, including starting from a chosen point
in the text.

| Key | What it does |
|---|---|
| `Tab` into the text | Lands on the **reading cursor** — one stop for the whole document, not one per paragraph |
| `↑` / `↓` | Move the cursor to the previous / next paragraph (only while the cursor holds focus) |
| `Enter` | Start reading from the paragraph under the cursor |
| `Alt` + `P` | Play / Pause |
| `Alt` + `Shift` + `←` / `→` | Previous / next block |
| `Alt` + `.` | Stop |
| `Alt` + `↑` / `↓` | Faster / slower |
| `Esc` | Close the ⚙ menu and return focus to its button |

Two choices worth knowing about, because they are not the obvious ones. The
shortcuts use `Alt` rather than bare letters (`j`/`k`/`l`) because NVDA and JAWS
treat single letters as quick-navigation keys in browse mode and swallow them
before a page ever sees them — bare-letter shortcuts would be dead keys for
part of the intended audience. And previous/next is `Alt`+`Shift`+arrow rather
than `Alt`+arrow because `Alt`+`←` is Back in Chrome, Edge and Firefox, which
would navigate away from the page mid-sentence.

The reading cursor is a single Tab stop by design: a chapter holds thousands of
words and hundreds of paragraphs, and making each one focusable would bury the
page under Tab stops for the people who navigate by keyboard.

## Known limitations

**Word-level highlighting depends on the voice.** Browsers expose two kinds:
local voices, which run on your machine, and remote ones (Microsoft "Natural"
and "Online", Google voices) which stream from the network. Remote voices sound
considerably better, and frequently **do not report word boundaries at all** —
the browser simply never fires the event the highlighting depends on. When that
happens the player detects it and shades the whole block instead of the current
word, and reading continues normally. This is a limitation of the speech API,
not something this extension can fix. If per-word highlighting matters more to
you than voice quality, pick a local voice.

**Pause is approximate.** Chromium's native pause/resume is unreliable, so the
player cancels and re-speaks the remainder from the last confirmed word instead.
You may hear a word repeat or get skipped at the seam. With a voice that does
not report boundaries (see above), resume restarts the current block.

**Browser support.** Developed and tested against Chromium browsers, Microsoft
Edge in particular, for its voice quality. It should degrade gracefully
elsewhere and does nothing at all in browsers without `speechSynthesis`.

## Verifying a change

Render the bundled example and follow the checks written into it:

```bash
quarto render example.qmd --to html
```

`example.qmd` doubles as the test bench and the manual verification script — it
walks through the failure modes that actually happened during development
(markup destroyed by word-wrapping, epigraphs read twice, the line reflowing on
every word, remote voices stalling).

## License

MIT — see [LICENSE](LICENSE).
