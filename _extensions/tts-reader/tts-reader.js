/*!
 * tts-reader — read-aloud player for Quarto HTML documents
 * MIT License. https://github.com/mancano-tales/quarto-tts-reader
 *
 * Reads the document aloud with the browser's Web Speech API, highlighting the
 * current word and sentence, and lets the reader click any word to start from
 * exactly there.
 *
 * Three properties of the Web Speech API shape almost every design decision in
 * this file, and none of them are obvious:
 *
 *   1. `speechSynthesis.pause()/.resume()` is unreliable in Chromium. We cancel
 *      and re-speak the remainder from the last confirmed word instead.
 *   2. `speak()` issued right after `cancel()` is sometimes silently dropped —
 *      no `onstart`, no `onerror`, nothing. Long utterances can also stall
 *      mid-way without ever firing `onend`. Both need watchdogs.
 *   3. Remote voices (Microsoft "Natural"/"Online", Google) frequently never
 *      fire `onboundary`, so word-level highlighting is simply unavailable with
 *      them. We detect that and degrade to block-level highlighting.
 */
(function () {
  'use strict';

  var synth = window.speechSynthesis;
  if (!synth) return;

  /*
   * Every element that can hold readable text of its own.
   *
   * Two entries were missing until v1.1.1, and both were silent: `h1` (Quarto
   * renders every chapter title as <h1 class="title">, so the reader skipped
   * the title of each chapter) and table cells (Pandoc puts cell text directly
   * in <td>, with no <p> to catch it, so entire tables were never spoken).
   * Adding a heading level or a container here without checking its siblings is
   * how both got lost: h2–h5 were listed and h1 forgotten, li and figcaption
   * listed and td/th forgotten.
   */
  var BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, figcaption, td, th, dt, dd';
  var SENTENCE_RE = /[^.!?;:—]+[.!?;:—]*/g;

  /*
   * What gets spoken. Every one of these is content the reader can legitimately
   * want either way, so none is decided in the code: they are choices, exposed
   * in the ⚙ menu and remembered per browser.
   *
   * `citations` defaults to OFF, and it is the only one that does. In academic
   * prose a parenthetical citation lands in the middle of nearly every
   * sentence, and "(Breen, Luijkx, Müller and Pollak, 2009)" read aloud
   * destroys the rhythm of the sentence carrying it. Everything else defaults
   * to ON, because silently dropping content is the failure mode this project
   * has already had to fix twice.
   */
  var DEFAULT_OPTS = {
    citations: false,   // parenthetical citations — (Author, 2020)
    parens: true,       // any other parenthetical aside
    tables: true,       // table cells
    captions: true,     // figure captions
    footnotes: true     // the notes section at the end of the document
  };
  var OPT_LABELS = {
    citations: 'Citações',
    parens: 'Parênteses',
    tables: 'Tabelas',
    captions: 'Legendas',
    footnotes: 'Notas de rodapé'
  };
  var STORAGE_KEY = 'tts-reader-opts';

  /*
   * Preferences that are NOT part of the ⚙ menu, and must not be.
   *
   * `DEFAULT_OPTS` above answers one question — what gets SPOKEN — and changing
   * any of its keys costs a full re-preparation of the document (applyOpts:
   * stop, unwrap every span, re-collect). These three answer different
   * questions and cost nothing, so they live apart. Folding them into
   * DEFAULT_OPTS would also put them in the ⚙ menu automatically, since it
   * iterates that object's keys, and they would appear there under the heading
   * "read aloud:" — which is not what any of them means.
   */
  var VOICE_KEY = 'tts-reader-voice';
  var RATE_KEY = 'tts-reader-rate';
  var LANG_KEY = 'tts-reader-lang';
  var CLICK_KEY = 'tts-reader-click-to-read';

  function readStored(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStored(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  // Click-to-read is ON unless the reader turned it off: only the exact string
  // 'false' counts, so a cleared or unreadable store falls back to the default.
  var clickToRead = readStored(CLICK_KEY) !== 'false';

  var opts = loadOpts();

  function loadOpts() {
    var o = {};
    for (var k in DEFAULT_OPTS) o[k] = DEFAULT_OPTS[k];
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var j in DEFAULT_OPTS) {
          if (typeof saved[j] === 'boolean') o[j] = saved[j];
        }
      }
    } catch (e) { /* storage blocked or corrupt: defaults are fine */ }
    return o;
  }

  function saveOpts() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts)); } catch (e) {}
  }

  var blocks = [];
  var blockText = new WeakMap();   // element -> canonical string handed to speak()
  var voices = [];

  var activeUtterance = null;
  var currentIndex = 0;
  var isSpeaking = false;
  var isPaused = false;
  var utteranceStarted = false;
  var sawBoundary = false;

  var startTimer = null;      // debounce for rapid clicks
  var watchdogTimer = null;   // utterance never started
  var stallInterval = null;   // utterance stalled mid-way
  var boundaryProbe = null;   // voice does not report word boundaries

  var baseOffset = 0;             // where the active utterance starts in the block
  var lastCharIndex = 0;          // last reported boundary, in block coordinates
  var sentenceStart = -1;
  var sentenceEnd = -1;

  // ---------------------------------------------------------------- utilities

  function voiceKey(v) {
    // Identify a voice by name+lang, never by array index: getVoices() may be
    // re-fetched (onvoiceschanged can fire more than once) and come back in a
    // different order, silently repointing a stored index at another voice.
    return v.name + '|' + v.lang;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isRemoteVoice(v) {
    return !!v && (v.localService === false ||
      v.name.indexOf('Online') !== -1 ||
      v.name.indexOf('Natural') !== -1);
  }

  function selectedVoice() {
    var sel = document.getElementById('tts-voice');
    if (!sel || !sel.value) return null;
    for (var i = 0; i < voices.length; i++) {
      if (voiceKey(voices[i]) === sel.value) return voices[i];
    }
    return null;
  }

  function clearHandlers(u) {
    if (!u) return;
    u.onstart = null;
    u.onend = null;
    u.onerror = null;
    u.onboundary = null;
  }

  function stopTimers() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    if (stallInterval) { clearInterval(stallInterval); stallInterval = null; }
    if (boundaryProbe) { clearTimeout(boundaryProbe); boundaryProbe = null; }
  }

  // ------------------------------------------------------ document preparation

  /*
   * The text nodes a block OWNS: those not sitting inside a nested block.
   *
   * Blocks nest, and the two ways of coping with that are both wrong. Reading
   * every matching element duplicates content — Quarto renders each epigraph as
   * <blockquote><p>…</p></blockquote>, so the passage would be spoken twice.
   * Discarding every element that contains another silently loses text: in
   * `<li>parent text<ul><li>child</li></ul></li>` the parent's own words belong
   * to no block at all and are never read, never clickable.
   *
   * Ownership settles both. The blockquote owns nothing (all its text lives in
   * the <p>), so it drops out on its own; the outer <li> owns "parent text" and
   * keeps exactly that.
   */
  /*
   * Text that is never spoken, whatever the settings say.
   *
   * Footnote markers are a bare digit inside <a class="footnote-ref">; hearing
   * "one" mid-sentence is noise. Rendered maths is skipped whole because KaTeX
   * and MathJax each emit the expression twice — an accessible MathML copy plus
   * visual glyph spans — so reading the subtree gives the formula duplicated,
   * with the visual half arriving as loose characters. Silence beats nonsense;
   * speaking maths properly is a separate problem, recorded in TODO.md.
   */
  var ALWAYS_SKIP = '.footnote-ref, .katex, mjx-container, .MathJax, mjx-assistive-mml';

  /*
   * A parenthetical citation can be dropped; a narrative one cannot.
   *
   * Citeproc wraps both in <span class="citation">, but they play different
   * grammatical roles. "…eroded (Jackson, 2021)." survives losing the
   * parenthesis intact. "Jackson (2021) argues that…" does not — remove it and
   * the sentence loses its subject. The rendered text tells them apart: the
   * parenthetical form opens with the bracket, the narrative form with a name.
   */
  function isDroppableCitation(el) {
    var t = (el.textContent || '').trim();
    return t.charAt(0) === '(' || t.charAt(0) === '[';
  }

  function isSkippedText(n) {
    var parent = n.parentElement;
    if (!parent) return false;
    if (parent.closest(ALWAYS_SKIP)) return true;
    if (!opts.citations) {
      var cite = parent.closest('.citation');
      if (cite && isDroppableCitation(cite)) return true;
    }
    return false;
  }

  function ownedTextNodes(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var out = [];
    var n;
    while ((n = walker.nextNode())) {
      if (isSkippedText(n)) continue;
      var p = n.parentElement;
      while (p && p !== el) {
        if (p.matches && p.matches(BLOCK_SELECTOR)) break;
        p = p.parentElement;
      }
      if (p === el) out.push(n);
    }
    return out;
  }

  /*
   * The reading cursor: which block the keyboard is pointing at.
   *
   * It exists so the document can be read from an arbitrary point WITHOUT a
   * mouse. Kept as a roving tabindex — exactly one block carries tabindex="0"
   * and every other carries "-1" — because the obvious alternative, marking
   * every word (or every block) focusable, would add thousands of Tab stops to
   * a chapter and make the page unusable for the very people who navigate by
   * keyboard. One stop for the whole prose; the arrows move it from there.
   */
  var keyboardBlockIndex = 0;

  /*
   * Say something to a screen reader without printing it on the page.
   *
   * DELIBERATELY not wired to #tts-status: that element shows "12/318" and
   * changes at every block, which through a live region becomes a voice
   * interrupting itself every few seconds. This one is only ever given state
   * changes the reader caused — playing, paused, stopped, speed — because those
   * have no other audible or focus-visible signal.
   */
  function announce(msg) {
    var a = document.getElementById('tts-announcer');
    if (a) a.textContent = msg;
  }

  function setKeyboardCursor(index, moveFocus) {
    if (!blocks.length) return;
    if (index < 0) index = 0;
    if (index >= blocks.length) index = blocks.length - 1;
    var previous = blocks[keyboardBlockIndex];
    if (previous) previous.setAttribute('tabindex', '-1');
    keyboardBlockIndex = index;
    var el = blocks[index];
    el.setAttribute('tabindex', '0');
    if (moveFocus) {
      // Focusing the block is what makes a screen reader read it, which is the
      // whole point of moving the cursor. preventScroll is off: the reader has
      // to see where the cursor went.
      el.focus();
    }
  }

  function focusedBlockIndex() {
    var el = document.activeElement;
    if (!el || !el.closest) return -1;
    var block = el.closest(BLOCK_SELECTOR);
    return block ? blocks.indexOf(block) : -1;
  }

  function collectBlocks() {
    var root = document.querySelector('main') || document.body;
    var all = Array.prototype.slice.call(root.querySelectorAll(BLOCK_SELECTOR));
    blocks = all.filter(function (el) {
      if (el.closest('#tts-reader-bar')) return false;
      if (!opts.tables && (el.tagName === 'TD' || el.tagName === 'TH')) return false;
      if (!opts.captions && el.tagName === 'FIGCAPTION') return false;
      if (!opts.footnotes && el.closest('.footnotes')) return false;
      return ownedTextNodes(el).some(function (n) {
        return n.nodeValue && n.nodeValue.trim().length > 0;
      });
    });
    if (keyboardBlockIndex >= blocks.length) keyboardBlockIndex = 0;
    blocks.forEach(function (el, idx) {
      el.classList.add('tts-readable');
      el.setAttribute('tabindex', idx === keyboardBlockIndex ? '0' : '-1');
    });
  }

  /*
   * Undo the wrapping so the document can be re-prepared under new settings.
   *
   * Every span is replaced by a plain text node and the element normalised,
   * which merges the pieces back together. Text that was skipped was never
   * wrapped, so it is already sitting there as plain text — nothing to undo.
   * Re-preparation then happens lazily, as usual.
   */
  function unprepareAll() {
    blocks.forEach(function (el) {
      if (!el.dataset.ttsPrepared) return;
      var spans = el.querySelectorAll('.tts-word');
      for (var i = 0; i < spans.length; i++) {
        spans[i].parentNode.replaceChild(
          document.createTextNode(spans[i].textContent), spans[i]);
      }
      el.normalize();
      delete el.dataset.ttsPrepared;
      blockText['delete'](el);
    });
  }

  function applyOpts() {
    stop();
    unprepareAll();
    collectBlocks();
    saveOpts();
  }

  /*
   * Wrap each word of `el` in a <span class="tts-word"> WITHOUT rebuilding the
   * element, and return the canonical string that will be handed to speak().
   *
   * Rebuilding from innerText (the obvious approach) destroys every citation
   * link, italic and footnote marker in the block. A TreeWalker over text nodes
   * leaves all existing markup exactly where it is.
   *
   * Each span records its ABSOLUTE offset within the returned string, and that
   * string is built by this very traversal — so the coordinates `onboundary`
   * reports and the coordinates the spans carry agree BY CONSTRUCTION. Deriving
   * offsets afterwards by summing span lengths does not work: whitespace lives
   * outside the spans, so such a sum drifts one character per word.
   *
   * Whitespace runs collapse to a single space in the canonical string. That
   * keeps the spoken text free of the newlines Quarto inserts when wrapping
   * HTML source lines — which would otherwise be read as sentence breaks and
   * fragment the sentence highlighting at meaningless points.
   */
  function wrapWords(el) {
    // Only the block's own text — never a nested block's, which belongs to that
    // block and is spoken when the reader reaches it. See ownedTextNodes.
    var nodes = ownedTextNodes(el);

    var canonical = '';
    var offset = 0;
    // A parenthetical aside can span several text nodes and cross element
    // boundaries — "(see <em>ibid.</em>, p. 4)" — so the depth counter lives
    // outside the per-node loop. It resets with each block, which also bounds
    // the damage of an unbalanced bracket to the paragraph containing it.
    var depth = 0;

    function pushSpace() {
      if (canonical.length > 0 && canonical.charAt(canonical.length - 1) !== ' ') {
        canonical += ' ';
        offset += 1;
      }
    }

    nodes.forEach(function (node) {
      var value = node.nodeValue;
      if (!value) return;
      var frag = document.createDocumentFragment();
      // Brackets are split out as their own tokens so depth changes land on
      // boundaries. Splitting on whitespace alone would speak "(Author," and
      // drop "2020)", cutting the aside in half.
      var parts = value.split(/(\s+|[()])/);

      parts.forEach(function (part) {
        if (part === '') return;

        if (part === '(' || part === ')') {
          frag.appendChild(document.createTextNode(part));
          if (opts.parens) { canonical += part; offset += part.length; }
          depth = (part === '(') ? depth + 1 : Math.max(0, depth - 1);
          return;
        }

        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          if (opts.parens || depth === 0) pushSpace();
          return;
        }

        if (!opts.parens && depth > 0) {
          // Inside a skipped aside: stays on the page, out of the audio.
          frag.appendChild(document.createTextNode(part));
          return;
        }

        var span = document.createElement('span');
        span.className = 'tts-word';
        span.textContent = part;
        span.dataset.offset = String(offset);
        frag.appendChild(span);
        canonical += part;
        offset += part.length;
      });

      node.parentNode.replaceChild(frag, node);
    });

    return canonical;
  }

  /*
   * Prepare on demand, never up front.
   *
   * A MutationObserver would be the intuitive way to cope with Quarto mutating
   * the DOM after load (Bootstrap, lightbox, footnote popovers), but it is a
   * trap: wrapping words IS a DOM mutation, so the observer would fire on its
   * own writes, forever. Preparing a block the moment it is actually needed
   * sidesteps that entirely, and costs nothing at page load.
   */
  function ensurePrepared(el) {
    if (!el || el.dataset.ttsPrepared) return;
    blockText.set(el, wrapWords(el));
    el.dataset.ttsPrepared = '1';
  }

  function textOf(el) {
    ensurePrepared(el);
    var t = blockText.get(el);
    return t === undefined ? (el.textContent || '') : t;
  }

  // ------------------------------------------------------------- highlighting

  function clearWordHighlight() {
    var els = document.querySelectorAll('.tts-word-active');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('tts-word-active');
  }

  function clearAllHighlight() {
    clearWordHighlight();
    var s = document.querySelectorAll('.tts-sentence-active');
    for (var i = 0; i < s.length; i++) s[i].classList.remove('tts-sentence-active');
    var b = document.querySelectorAll('.tts-block-active');
    for (var j = 0; j < b.length; j++) b[j].classList.remove('tts-block-active');
  }

  function highlight(el, charIndex) {
    clearWordHighlight();

    var spans = el.querySelectorAll('.tts-word');
    if (!spans.length) return;

    // Exact lookup against each span's recorded offset. If the index lands on
    // whitespace between words, fall back to the last word that started at or
    // before it, so the highlight never blanks out mid-sentence.
    var current = null;
    for (var i = 0; i < spans.length; i++) {
      var start = parseInt(spans[i].dataset.offset, 10);
      if (!isFinite(start)) continue;
      if (start > charIndex) break;
      current = spans[i];
      if (charIndex < start + spans[i].textContent.length) break;
    }
    if (!current) return;
    current.classList.add('tts-word-active');

    // Recompute the sentence only when leaving the cached range — otherwise the
    // shading is rebuilt on every word and visibly flickers.
    if (charIndex >= sentenceStart && charIndex < sentenceEnd) return;

    var sEls = document.querySelectorAll('.tts-sentence-active');
    for (var k = 0; k < sEls.length; k++) sEls[k].classList.remove('tts-sentence-active');

    var text = textOf(el);
    var sentences = text.match(SENTENCE_RE) || [text];
    var pos = 0;
    sentenceStart = -1;
    sentenceEnd = -1;
    for (var m = 0; m < sentences.length; m++) {
      var a = pos;
      var b = pos + sentences[m].length;
      if (charIndex >= a && charIndex < b) { sentenceStart = a; sentenceEnd = b; break; }
      pos = b;
    }
    if (sentenceStart === -1) return;

    for (var p = 0; p < spans.length; p++) {
      var st = parseInt(spans[p].dataset.offset, 10);
      if (!isFinite(st)) continue;
      if (st >= sentenceEnd) break;
      if (st >= sentenceStart) spans[p].classList.add('tts-sentence-active');
    }
  }

  // ------------------------------------------------------------------ speaking

  function speakBlock(index, offset, attempt) {
    offset = offset || 0;
    var thisAttempt = attempt || 0;

    if (index >= blocks.length) { stop(); return; }

    var el = blocks[index];
    var full = textOf(el);
    var text = offset > 0 ? full.slice(offset) : full;

    if (!text || !text.trim()) {
      currentIndex = index + 1;
      speakBlock(currentIndex, 0);
      return;
    }

    baseOffset = offset;
    lastCharIndex = offset;
    utteranceStarted = false;
    sawBoundary = false;
    // The cached sentence range is in THIS block's coordinates, so it must die
    // with the block. Advancing normally (onend -> next block) never goes
    // through stop(), and a stale range starting at 0 — which every heading and
    // single-sentence block leaves behind — would swallow the recompute.
    sentenceStart = -1;
    sentenceEnd = -1;

    var u = new SpeechSynthesisUtterance(text);
    activeUtterance = u;

    var voice = selectedVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; }

    var rateSel = document.getElementById('tts-rate');
    if (rateSel) u.rate = parseFloat(rateSel.value);

    u.onstart = function () {
      utteranceStarted = true;
      if (currentIndex !== index) return;
      clearAllHighlight();
      // Respect prefers-reduced-motion: smooth scrolling on every block is
      // exactly the kind of unrequested motion that triggers vestibular
      // discomfort. Jump instead of animating when the reader asked for that.
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      updateStatus();
      // Drag the keyboard cursor along with the voice, but WITHOUT moving focus:
      // stealing focus every few seconds would yank the page around and make a
      // screen reader read the paragraph over the speech already reading it.
      // Moving the cursor silently is what makes pause-then-arrow continue from
      // where the listening stopped rather than from wherever Tab was left.
      setKeyboardCursor(index, false);
      // If no word boundary arrives shortly, this voice does not report them
      // (typical of remote voices). Shade the whole block so the reader still
      // shows where it is instead of looking frozen.
      if (boundaryProbe) clearTimeout(boundaryProbe);
      boundaryProbe = setTimeout(function () {
        if (!sawBoundary && isSpeaking && !isPaused && activeUtterance === u) {
          el.classList.add('tts-block-active');
        }
      }, 800);
    };

    u.onboundary = function (ev) {
      if (ev.name && ev.name !== 'word') return;
      sawBoundary = true;
      if (boundaryProbe) { clearTimeout(boundaryProbe); boundaryProbe = null; }
      el.classList.remove('tts-block-active');
      lastCharIndex = baseOffset + ev.charIndex;
      highlight(el, lastCharIndex);
    };

    // A cancelled utterance can still deliver a LATE onend/onerror after we have
    // moved on to a new one (watchdog retry, stall recovery, rate change).
    // Without this identity check the stale handler passes the guards below —
    // same block, still speaking — and advances the index, skipping a block.
    u.onend = function () {
      if (activeUtterance !== u) return;
      stopTimers();
      if (!isSpeaking || isPaused || currentIndex !== index) return;
      currentIndex = index + 1;
      if (currentIndex < blocks.length) speakBlock(currentIndex, 0);
      else stop();
    };

    u.onerror = function () {
      if (activeUtterance !== u) return;
      stopTimers();
      if (!isSpeaking || currentIndex !== index) return;
      currentIndex = index + 1;
      if (currentIndex < blocks.length) speakBlock(currentIndex, 0);
      else stop();
    };

    isSpeaking = true;
    isPaused = false;
    setPlayButton('playing');
    synth.speak(u);

    stopTimers();

    // Remote voices stream over the network and can take well over a second to
    // start. Using the local-voice timeout for them would read the delay as a
    // failure and cancel a perfectly good utterance.
    var startDelay = isRemoteVoice(voice) ? 2500 : 800;

    watchdogTimer = setTimeout(function () {
      if (utteranceStarted || activeUtterance !== u || !isSpeaking || isPaused) return;
      clearHandlers(u);
      // The retry count travels as an ARGUMENT. A module-level flag would be
      // reset by the very speakBlock call it is meant to limit, turning
      // "retry once, then skip" into an endless retry loop.
      if (thisAttempt < 1) {
        synth.cancel();
        speakBlock(index, offset, thisAttempt + 1);
      } else {
        currentIndex = index + 1;
        if (currentIndex < blocks.length) speakBlock(currentIndex, 0);
        else stop();
      }
    }, startDelay);

    // The id is captured in a local, not read back from the module variable: a
    // later utterance reassigns `stallInterval`, and a stale callback clearing
    // the module variable would kill the CURRENT timer while leaving its own
    // running. Unreachable today, because stopTimers() runs before each new
    // pair is armed, but it is the kind of coupling that breaks on the next
    // edit rather than on this one.
    var myStall = setInterval(function () {
      if (!isSpeaking || isPaused || activeUtterance !== u) { clearInterval(myStall); return; }
      if (!utteranceStarted || synth.speaking || synth.pending) return;
      clearInterval(myStall);
      clearHandlers(u);
      // Only resume mid-block if a boundary actually reported progress. With a
      // voice that never fires onboundary, lastCharIndex still equals
      // baseOffset, and resuming there would replay this block every few
      // seconds, forever.
      if (lastCharIndex > baseOffset) {
        speakBlock(index, lastCharIndex);
      } else {
        currentIndex = index + 1;
        if (currentIndex < blocks.length) speakBlock(currentIndex, 0);
        else stop();
      }
    }, 3000);
    stallInterval = myStall;   // so stopTimers() can still cancel it
  }

  function startFrom(index, offset) {
    var off = offset || 0;
    stop(false);
    lastCharIndex = off;   // stop() cleared it; a pause inside the debounce
                           // window must resume at the requested word
    if (!blocks.length) collectBlocks();
    if (index < 0) index = 0;
    if (index >= blocks.length) { currentIndex = 0; setPlayButton('idle'); return; }
    currentIndex = index;

    if (startTimer) clearTimeout(startTimer);
    // Small debounce: rapid clicks on next/prev otherwise pile cancel+speak
    // pairs onto the Chromium queue, which is exactly what makes it drop them.
    startTimer = setTimeout(function () {
      startTimer = null;
      speakBlock(currentIndex, off);
    }, 100);
  }

  function togglePlay() {
    // A start scheduled by the debounce counts as playing: otherwise a click
    // inside that window sees isSpeaking === false, falls through to the else
    // branch, and silently discards the word the reader had clicked.
    var pending = startTimer !== null;

    if ((isSpeaking || pending) && !isPaused) {
      isPaused = true;
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      stopTimers();
      clearHandlers(activeUtterance);
      synth.cancel();
      setPlayButton('paused');
      announce('Leitura pausada');
    } else if (isPaused) {
      isPaused = false;
      announce('Retomando a leitura');
      speakBlock(currentIndex, lastCharIndex);
    } else {
      announce('Lendo');
      startFrom(currentIndex, 0);
    }
  }

  function stop(resetIndex) {
    if (resetIndex === undefined) resetIndex = true;
    isSpeaking = false;
    isPaused = false;
    stopTimers();
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    clearHandlers(activeUtterance);
    activeUtterance = null;
    synth.cancel();
    clearAllHighlight();
    if (resetIndex) currentIndex = 0;
    lastCharIndex = 0;
    baseOffset = 0;
    sentenceStart = -1;
    sentenceEnd = -1;
    setPlayButton('idle');
    updateStatus();
    announce('Leitura parada');
  }

  function restartHere() {
    // Rate and voice can only change by re-speaking. Capture the position
    // first: startFrom -> stop clears lastCharIndex.
    if (!isSpeaking || isPaused) return;
    startFrom(currentIndex, lastCharIndex);
  }

  // ------------------------------------------------------------------ the bar

  function setPlayButton(state) {
    var btn = document.getElementById('tts-play');
    if (!btn) return;
    var icon = btn.querySelector('.tts-icon');
    var label = btn.querySelector('.tts-label');
    if (state === 'playing') {
      icon.textContent = '⏸'; label.textContent = 'Pause';
      btn.classList.add('tts-playing');
    } else {
      icon.textContent = '▶';
      label.textContent = (state === 'paused') ? 'Resume' : 'Play';
      btn.classList.remove('tts-playing');
    }
  }

  function updateStatus() {
    var s = document.getElementById('tts-status');
    if (!s) return;
    s.textContent = (isSpeaking && blocks.length)
      ? (currentIndex + 1) + '/' + blocks.length
      : '';
  }

  function buildBar() {
    if (document.getElementById('tts-reader-bar')) return;

    var bar = document.createElement('div');
    bar.id = 'tts-reader-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Read aloud controls');

    var left = document.createElement('div');
    left.className = 'tts-group';

    var play = document.createElement('button');
    play.id = 'tts-play';
    play.type = 'button';
    play.innerHTML = '<span class="tts-icon">▶</span><span class="tts-label">Play</span>';
    play.addEventListener('click', togglePlay);

    var prev = mkButton('⏮', 'Previous block', function () {
      startFrom(Math.max(0, currentIndex - 1), 0);
    });
    var next = mkButton('⏭', 'Next block', function () {
      startFrom(Math.min(blocks.length - 1, currentIndex + 1), 0);
    });
    var stopBtn = mkButton('⏹', 'Stop', function () { stop(); });
    stopBtn.id = 'tts-stop';

    left.appendChild(play);
    left.appendChild(prev);
    left.appendChild(next);
    left.appendChild(stopBtn);

    var status = document.createElement('span');
    status.id = 'tts-status';
    status.className = 'tts-status';
    left.appendChild(status);

    var right = document.createElement('div');
    right.className = 'tts-group';

    var rateLabel = document.createElement('label');
    rateLabel.textContent = 'Speed';
    rateLabel.setAttribute('for', 'tts-rate');
    var rate = document.createElement('select');
    rate.id = 'tts-rate';
    var savedRate = readStored(RATE_KEY);
    ['0.75', '0.85', '1', '1.15', '1.25', '1.5', '1.75', '2'].forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = (v === '1' ? '1.0' : v) + '×';
      if (v === (savedRate || '1')) o.selected = true;
      rate.appendChild(o);
    });
    rate.addEventListener('change', function () {
      writeStored(RATE_KEY, rate.value);
      restartHere();
    });

    var langLabel = document.createElement('label');
    langLabel.textContent = 'Lang';
    langLabel.setAttribute('for', 'tts-lang');
    var lang = document.createElement('select');
    lang.id = 'tts-lang';
    lang.addEventListener('change', function () {
      writeStored(LANG_KEY, lang.value);
      populateVoices();
    });

    var voiceLabel = document.createElement('label');
    voiceLabel.textContent = 'Voice';
    voiceLabel.setAttribute('for', 'tts-voice');
    var voice = document.createElement('select');
    voice.id = 'tts-voice';
    voice.addEventListener('change', function () {
      writeStored(VOICE_KEY, voice.value);
      restartHere();
    });

    right.appendChild(rateLabel);
    right.appendChild(rate);
    right.appendChild(langLabel);
    right.appendChild(lang);
    right.appendChild(voiceLabel);
    right.appendChild(voice);
    right.appendChild(buildOptsMenu());

    /*
     * The live region. Visually hidden, never focusable, `polite` so it waits
     * for a gap instead of cutting the screen reader off mid-word. It carries
     * only state changes (see announce): the block counter next to it is
     * deliberately NOT live.
     */
    var announcer = document.createElement('div');
    announcer.id = 'tts-announcer';
    announcer.className = 'tts-sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    bar.appendChild(announcer);

    bar.appendChild(left);
    bar.appendChild(right);
    document.body.appendChild(bar);
    document.body.classList.add('tts-reader-active');
    syncBarPadding();
  }

  /*
   * Reserve exactly as much space at the foot of the document as the bar
   * occupies. A fixed value cannot work: the bar wraps its controls, so its
   * height depends on viewport width and font size, and on a narrow phone it
   * grows past any constant and covers the last line of text.
   */
  function syncBarPadding() {
    var bar = document.getElementById('tts-reader-bar');
    if (!bar) return;
    document.body.style.paddingBottom = (bar.offsetHeight + 12) + 'px';
  }

  function watchBarSize() {
    var bar = document.getElementById('tts-reader-bar');
    if (!bar) return;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncBarPadding).observe(bar);
    } else {
      var t = null;
      window.addEventListener('resize', function () {
        if (t) clearTimeout(t);
        t = setTimeout(syncBarPadding, 150);
      });
    }
  }

  /* The ⚙ menu: one checkbox per kind of content that can be left unspoken. */
  function buildOptsMenu() {
    var wrap = document.createElement('div');
    wrap.className = 'tts-opts';

    var toggle = mkButton('⚙', 'O que ler em voz alta', function (e) {
      e.stopPropagation();
      var open = wrap.classList.toggle('tts-opts-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-haspopup', 'true');

    var panel = document.createElement('div');
    panel.className = 'tts-opts-panel';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'O que ler em voz alta');

    var title = document.createElement('p');
    title.className = 'tts-opts-title';
    title.textContent = 'Ler em voz alta:';
    panel.appendChild(title);

    Object.keys(DEFAULT_OPTS).forEach(function (key) {
      var id = 'tts-opt-' + key;
      var row = document.createElement('label');
      row.setAttribute('for', id);

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.checked = !!opts[key];
      box.addEventListener('change', function () {
        opts[key] = box.checked;
        applyOpts();
      });

      row.appendChild(box);
      row.appendChild(document.createTextNode(' ' + OPT_LABELS[key]));
      panel.appendChild(row);
    });

    var note = document.createElement('p');
    note.className = 'tts-opts-note';
    note.textContent = 'Citações narrativas ("Autor (2020) mostra…") são sempre lidas: sem elas a frase perde o sujeito.';
    panel.appendChild(note);

    /*
     * Click-to-read lives HERE and not on the bar: the bar already wraps to two
     * rows on a narrow screen, and this is a set-once preference, not something
     * touched while reading. It is also separated from the checkboxes above by a
     * rule, because it answers a different question — those say what is spoken,
     * this says how reading starts.
     */
    var clickTitle = document.createElement('p');
    clickTitle.className = 'tts-opts-title tts-opts-title-second';
    clickTitle.textContent = 'Interação:';
    panel.appendChild(clickTitle);

    var clickRow = document.createElement('label');
    clickRow.setAttribute('for', 'tts-opt-click');
    var clickBox = document.createElement('input');
    clickBox.type = 'checkbox';
    clickBox.id = 'tts-opt-click';
    clickBox.checked = clickToRead;
    clickBox.addEventListener('change', function () {
      clickToRead = clickBox.checked;
      writeStored(CLICK_KEY, clickToRead ? 'true' : 'false');
      applyClickMode();
    });
    clickRow.appendChild(clickBox);
    clickRow.appendChild(document.createTextNode(' Iniciar a leitura ao clicar numa palavra'));
    panel.appendChild(clickRow);

    var clickNote = document.createElement('p');
    clickNote.className = 'tts-opts-note';
    clickNote.textContent = 'Desligue para selecionar e copiar texto sem que o primeiro clique de um duplo-clique comece a leitura.';
    panel.appendChild(clickNote);

    wrap.appendChild(toggle);
    wrap.appendChild(panel);

    // Click anywhere else closes it, but not a click inside the panel itself,
    // which would shut the menu on every checkbox tick.
    document.addEventListener('click', function (e) {
      if (wrap.contains(e.target)) return;
      wrap.classList.remove('tts-opts-open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    // Escape closes it too, and hands focus BACK to the ⚙ button. Without the
    // focus return, dismissing the menu from the keyboard drops the caret at the
    // top of the document and the reader has to Tab all the way back.
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!wrap.classList.contains('tts-opts-open')) return;
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.remove('tts-opts-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    });

    return wrap;
  }

  function mkButton(glyph, title, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', handler);
    return b;
  }

  /*
   * The PRIMARY subtag of a language code, normalised.
   *
   * Filtering on the full code would split `pt-BR` from `pt-PT` and `en-US`
   * from `en-GB`, leaving the reader of a Portuguese document unable to see
   * half the Portuguese voices. Some engines also report `pt_BR` with an
   * underscore, which no amount of comparing against `pt-BR` will ever match.
   */
  function primaryLang(code) {
    return String(code || '').replace('_', '-').split('-')[0].toLowerCase();
  }

  function documentLang() {
    return primaryLang(document.documentElement.getAttribute('lang'));
  }

  /*
   * Fill the language <select> from the voices the browser actually has, and
   * decide which one starts selected.
   *
   * 'all' is not a convenience, it is a safety valve. Quarto emits `lang="en"`
   * whenever the document does not set one, so a Portuguese thesis that forgot
   * `lang: pt-BR` would silently show English voices only and look broken. The
   * document language is honoured just when voices for it exist; otherwise the
   * filter opens rather than showing an empty list.
   */
  function populateLanguages() {
    var sel = document.getElementById('tts-lang');
    if (!sel) return 'all';

    var seen = {};
    var codes = [];
    voices.forEach(function (v) {
      var code = primaryLang(v.lang);
      if (code && !seen[code]) { seen[code] = true; codes.push(code); }
    });
    codes.sort();

    var stored = readStored(LANG_KEY);
    var chosen = 'all';
    if (stored && (stored === 'all' || seen[stored])) chosen = stored;
    else if (!stored && seen[documentLang()]) chosen = documentLang();

    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'Todos';
    sel.appendChild(all);
    codes.forEach(function (code) {
      var o = document.createElement('option');
      o.value = code;
      o.textContent = code;
      sel.appendChild(o);
    });
    sel.value = chosen;
    return chosen;
  }

  function populateVoices() {
    voices = synth.getVoices();
    var sel = document.getElementById('tts-voice');
    if (!sel || !voices.length) return;

    var filter = populateLanguages();
    // What the reader is hearing right now outranks anything stored: a voice
    // change is only wanted when the reader asks for one.
    var active = activeUtterance && activeUtterance.voice ? voiceKey(activeUtterance.voice) : '';
    var wanted = sel.value || active || readStored(VOICE_KEY) || '';

    var shown = voices.filter(function (v) {
      return filter === 'all' || primaryLang(v.lang) === filter;
    });

    /*
     * The voice being spoken stays listed even when the filter excludes it.
     *
     * Narrowing the language while a pt-BR voice is mid-paragraph would
     * otherwise drop it from the list, and the <select> would fall to whatever
     * option happened to be first — silently reassigning the voice under a
     * running utterance. Filtering is a browsing action; it must never
     * interrupt or change what is being read.
     */
    var keepsActive = shown.some(function (v) { return voiceKey(v) === active; });
    if (active && !keepsActive) {
      voices.forEach(function (v) { if (voiceKey(v) === active) shown.unshift(v); });
    }

    // Voices of the document's language first — the old rule put English first
    // unconditionally, which stopped making sense once the language could be
    // chosen. Within a group the browser's own order is kept.
    var docLang = documentLang();
    var preferred = shown.filter(function (v) { return primaryLang(v.lang) === docLang; });
    var rest = shown.filter(function (v) { return primaryLang(v.lang) !== docLang; });
    var ordered = preferred.concat(rest);

    sel.innerHTML = '';
    var restored = false;
    ordered.forEach(function (v) {
      var o = document.createElement('option');
      o.value = voiceKey(v);
      o.textContent = v.name + ' (' + v.lang + ')';
      if (wanted && o.value === wanted) { o.selected = true; restored = true; }
      sel.appendChild(o);
    });

    if (!restored) {
      for (var i = 0; i < ordered.length; i++) {
        if (isRemoteVoice(ordered[i]) || ordered[i].default) {
          sel.value = voiceKey(ordered[i]);
          break;
        }
      }
      if (!sel.value && ordered.length) sel.value = voiceKey(ordered[0]);
    }
  }

  // ------------------------------------------------------------------- events

  function onPointerOver(e) {
    // Prepare the block under the pointer so that, by the time a click lands,
    // its words already carry offsets and click-to-word is an exact lookup.
    var el = e.target.closest ? e.target.closest(BLOCK_SELECTOR) : null;
    if (el && blocks.indexOf(el) !== -1) ensurePrepared(el);
  }

  /*
   * Reflect click-to-read in the cursor.
   *
   * A class on <body> and not a change to `.tts-readable`: collectBlocks()
   * re-adds that class on every re-collection, so removing it would be a fix
   * that quietly undoes itself the next time a ⚙ option changes. The body class
   * survives because nothing else touches it.
   *
   * This deliberately does NOT go through applyOpts(): what starts the reading
   * has no bearing on what gets spoken, and running the full stop + unwrap +
   * re-collect cycle would kill playback to change a cursor.
   */
  function applyClickMode() {
    document.body.classList.toggle('tts-click-disabled', !clickToRead);
  }

  function onClick(e) {
    if (!clickToRead) return;

    // Never hijack interactive elements — citation links above all, which must
    // navigate to the bibliography rather than start the reader.
    //
    // `summary`, NOT `details`: a collapsible Quarto callout is a <details>
    // wrapping its whole body, so excluding the container swallowed every word
    // inside it. Only the disclosure control itself must be left alone.
    // `code` is likewise absent: inline code sits in ordinary prose and should
    // be clickable like any other word. `pre` stays, for code blocks.
    if (e.target.closest('#tts-reader-bar, a, button, input, select, textarea, summary, pre')) return;

    var sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;   // user is selecting text

    var el = e.target.closest(BLOCK_SELECTOR);
    if (!el) return;
    var index = blocks.indexOf(el);
    if (index === -1) return;

    ensurePrepared(el);
    var word = e.target.closest('.tts-word');
    var offset = (word && el.contains(word)) ? (parseInt(word.dataset.offset, 10) || 0) : 0;
    // A click also plants the reading cursor, so switching from mouse to
    // keyboard mid-document continues from the paragraph just clicked.
    setKeyboardCursor(index, false);
    startFrom(index, offset);
  }

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ||
      tag === 'OPTION' || !!el.isContentEditable;
  }

  function adjustRate(step) {
    var sel = document.getElementById('tts-rate');
    if (!sel) return;
    var i = sel.selectedIndex + step;
    if (i < 0 || i >= sel.options.length) return;
    sel.selectedIndex = i;
    announce('Velocidade ' + sel.options[i].textContent);
    restartHere();
  }

  /*
   * Keyboard control, in two layers.
   *
   * Bare arrows and Enter act ONLY while a readable block holds focus — that is
   * the composite-widget contract: the reader deliberately Tabbed into the
   * prose, so the arrows belong to the cursor there and to the page everywhere
   * else. preventDefault matters on those: without it the block scrolls under
   * the cursor AND the page scrolls too, moving twice per press.
   *
   * Everything else is Alt-based, and the modifier choice is not cosmetic.
   * Single-letter shortcuts (j/k/l, the usual choice in reading apps) are
   * swallowed whole by NVDA and JAWS in browse mode, where letters are
   * quick-navigation keys — the handler never sees the event, so they would be
   * dead keys for exactly the audience this is meant to serve. Space is the
   * page-scroll key and hijacking it breaks ordinary reading.
   *
   * Alt+Shift+Arrow, NOT Alt+Arrow, for previous/next: Alt+Left and Alt+Right
   * are Back and Forward in Chrome, Edge and Firefox on Windows, so binding
   * them would navigate away from the page mid-sentence. Shift takes the combo
   * out of the browser's reach.
   *
   * `e.code` rather than `e.key` for the letter and the full stop: Alt rewrites
   * `e.key` on several layouts (Alt+P is "π" on macOS), while `code` names the
   * physical key and stays put.
   */
  function onKeyDown(e) {
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey) return;

    if (!e.altKey) {
      var focused = focusedBlockIndex();
      if (focused === -1 || e.shiftKey) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setKeyboardCursor(focused + 1, true); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setKeyboardCursor(focused - 1, true); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        announce('Lendo');
        startFrom(focused, 0);
      }
      return;
    }

    if (!blocks.length) collectBlocks();

    if (e.shiftKey) {
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        setKeyboardCursor(keyboardBlockIndex + 1, false);
        startFrom(keyboardBlockIndex, 0);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setKeyboardCursor(keyboardBlockIndex - 1, false);
        startFrom(keyboardBlockIndex, 0);
      }
      return;
    }

    if (e.code === 'KeyP') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'Period' || e.code === 'NumpadDecimal') { e.preventDefault(); stop(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); adjustRate(1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); adjustRate(-1); }
  }

  /*
   * Tabbing or clicking into a different block moves the cursor with it, so the
   * arrows always continue from where the reader actually is rather than from
   * wherever the cursor was last parked.
   */
  function onFocusIn(e) {
    var index = e.target && e.target.closest ? blocks.indexOf(e.target.closest(BLOCK_SELECTOR)) : -1;
    if (index !== -1 && index !== keyboardBlockIndex) setKeyboardCursor(index, false);
  }

  function init() {
    buildBar();
    watchBarSize();
    populateVoices();
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = populateVoices;
    }
    collectBlocks();
    applyClickMode();
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    // Chromium keeps speaking after navigation unless told otherwise.
    window.addEventListener('beforeunload', function () { synth.cancel(); });
  }

  // `defer` scripts are guaranteed to run before DOMContentLoaded, so the
  // listener alone would be enough today. The readyState check costs three
  // lines and makes the player immune to ever being loaded dynamically, where
  // the event would already have fired and the listener would never run.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
