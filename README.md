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
| Speed | 0.75× to 2×, keeps your place when changed |
| Voice | Any voice the browser exposes; keeps your place when changed |
| Click a word | Starts reading from that word |

Citation links, footnote markers and other interactive elements stay clickable —
clicking a link navigates, it does not start the reader. Footnote reference
numbers are excluded from the spoken text, so you will not hear a stray digit
read out mid-sentence.

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
