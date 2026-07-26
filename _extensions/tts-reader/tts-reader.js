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

  var BLOCK_SELECTOR = 'p, h2, h3, h4, h5, blockquote, li, figcaption';
  var SENTENCE_RE = /[^.!?;:—]+[.!?;:—]*/g;

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

  function collectBlocks() {
    var root = document.querySelector('main') || document.body;
    var all = Array.prototype.slice.call(root.querySelectorAll(BLOCK_SELECTOR));
    blocks = all.filter(function (el) {
      // Innermost blocks only. Quarto renders every epigraph and quote as
      // <blockquote><p>…</p></blockquote>, which matches the selector twice —
      // reading such a passage aloud twice in a row, and wrapping its words in
      // nested spans with conflicting offsets.
      if (el.closest('#tts-reader-bar')) return false;
      if (el.querySelector(BLOCK_SELECTOR)) return false;
      return el.textContent.trim().length > 0;
    });
    blocks.forEach(function (el) { el.classList.add('tts-readable'); });
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
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) {
      // Footnote markers render as a bare digit inside <a class="footnote-ref">.
      // Hearing "one" in the middle of a sentence is noise, so they are left
      // out of the spoken text entirely.
      if (n.parentElement && n.parentElement.closest('.footnote-ref')) continue;
      nodes.push(n);
    }

    var canonical = '';
    var offset = 0;

    nodes.forEach(function (node) {
      var value = node.nodeValue;
      if (!value) return;
      var frag = document.createDocumentFragment();
      var parts = value.split(/(\s+)/);

      parts.forEach(function (part) {
        if (part === '') return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          if (canonical.length > 0 && canonical.charAt(canonical.length - 1) !== ' ') {
            canonical += ' ';
            offset += 1;
          }
        } else {
          var span = document.createElement('span');
          span.className = 'tts-word';
          span.textContent = part;
          span.dataset.offset = String(offset);
          frag.appendChild(span);
          canonical += part;
          offset += part.length;
        }
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
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      updateStatus();
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

    stallInterval = setInterval(function () {
      if (!isSpeaking || isPaused || activeUtterance !== u) { clearInterval(stallInterval); return; }
      if (!utteranceStarted || synth.speaking || synth.pending) return;
      clearInterval(stallInterval);
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
    } else if (isPaused) {
      isPaused = false;
      speakBlock(currentIndex, lastCharIndex);
    } else {
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
    ['0.75', '0.85', '1', '1.15', '1.25', '1.5', '1.75', '2'].forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = (v === '1' ? '1.0' : v) + '×';
      if (v === '1') o.selected = true;
      rate.appendChild(o);
    });
    rate.addEventListener('change', restartHere);

    var voiceLabel = document.createElement('label');
    voiceLabel.textContent = 'Voice';
    voiceLabel.setAttribute('for', 'tts-voice');
    var voice = document.createElement('select');
    voice.id = 'tts-voice';
    voice.addEventListener('change', restartHere);

    right.appendChild(rateLabel);
    right.appendChild(rate);
    right.appendChild(voiceLabel);
    right.appendChild(voice);

    bar.appendChild(left);
    bar.appendChild(right);
    document.body.appendChild(bar);
    document.body.classList.add('tts-reader-active');
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

  function populateVoices() {
    voices = synth.getVoices();
    var sel = document.getElementById('tts-voice');
    if (!sel || !voices.length) return;

    var previous = sel.value;
    sel.innerHTML = '';

    var english = voices.filter(function (v) { return v.lang.indexOf('en') === 0; });
    var others = voices.filter(function (v) { return v.lang.indexOf('en') !== 0; });
    var ordered = english.concat(others);

    var restored = false;
    ordered.forEach(function (v) {
      var o = document.createElement('option');
      o.value = voiceKey(v);
      o.textContent = v.name + ' (' + v.lang + ')';
      if (previous && o.value === previous) { o.selected = true; restored = true; }
      sel.appendChild(o);
    });

    if (!restored && !previous) {
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

  function onClick(e) {
    // Never hijack interactive elements — citation links above all, which must
    // navigate to the bibliography rather than start the reader.
    if (e.target.closest('#tts-reader-bar, a, button, input, select, textarea, details, summary, pre, code')) return;

    var sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;   // user is selecting text

    var el = e.target.closest(BLOCK_SELECTOR);
    if (!el) return;
    var index = blocks.indexOf(el);
    if (index === -1) return;

    ensurePrepared(el);
    var word = e.target.closest('.tts-word');
    var offset = (word && el.contains(word)) ? (parseInt(word.dataset.offset, 10) || 0) : 0;
    startFrom(index, offset);
  }

  function init() {
    buildBar();
    populateVoices();
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = populateVoices;
    }
    collectBlocks();
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('click', onClick);
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
