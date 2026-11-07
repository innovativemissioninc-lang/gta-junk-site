/**
 * Rocky — AI concierge widget for GTA Junk and Property Cleanout
 * ===========================================================================
 * Self-contained, no dependencies, no build step. Loaded on every page.
 *
 * DESIGN DECISIONS WORTH KNOWING
 *
 * Prominence over politeness. The brief asked for top-of-fold presence with a
 * visual cue rather than a timid bottom-right bubble, so the launcher is a
 * wide pill with a waving paw and the copy "Need a quick answer?" — the
 * question that gets clicked, rather than "Do you need help?", which reads as
 * an accusation that you are lost.
 *
 * Answers before contact details. There is no email gate. The lead form only
 * appears after Rocky has actually answered something, because asking for a
 * phone number before being useful is how a concierge becomes a toll booth.
 *
 * Bottom-edge arithmetic. This site already has a mobile sticky call bar and a
 * cookie notice stacked at the bottom. Rocky measures both and sits above
 * them, and re-measures when the cookie bar is dismissed. Hard-coded offsets
 * would have buried the launcher under the call bar on every phone.
 *
 * Voice without a subscription. Speech in and out use the browser's own
 * SpeechRecognition and speechSynthesis — free, no account, works today in
 * Chrome, Edge and Safari. Both controls are feature-detected and simply
 * absent where unsupported, rather than present and broken. The ElevenLabs
 * brand-voice upgrade is a drop-in replacement for speak(), documented in
 * ROCKY.md, and deliberately not a launch dependency.
 *
 * Rocky always says what he is. The header carries a permanent "AI guide"
 * badge and the opening line says it in words. A concierge that lets you
 * believe you are talking to the owner is a liability, not a feature.
 */
(function () {
  'use strict';

  if (window.__rockyLoaded) return;
  window.__rockyLoaded = true;

  var ENDPOINT = '/api/rocky';
  var PHONE = '(647) 204-0632';
  var PHONE_HREF = 'tel:+16472040632';
  var AVATAR = '/assets/logo-icon.svg';
  var STORE = 'gtajunk_rocky_v1';

  var messages = [];          // {role, content}
  var open = false;
  var busy = false;
  var speakOn = false;
  var listening = false;
  var answered = false;       // has Rocky answered at least once
  var leadShown = false;
  var lastService = null;
  var recog = null;

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var canListen = !!SR;
  var canSpeak = 'speechSynthesis' in window;

  function ga(name, params) {
    try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ----------------------------------------------------------------- *
   * Markup
   * ----------------------------------------------------------------- */
  var root = document.createElement('div');
  root.id = 'rocky';
  root.innerHTML =
    '<button type="button" id="rk-launch" aria-expanded="false" aria-controls="rk-panel">' +
      '<span id="rk-paw" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">' +
        '<path d="M12 21c-3.3 0-6-2-6-4.6 0-1.9 1.4-2.9 2.6-3.8C9.7 11.8 10.5 11 12 11s2.3.8 3.4 1.6C16.6 13.5 18 14.5 18 16.4 18 19 15.3 21 12 21z"/>' +
        '<circle cx="6.3" cy="8.4" r="2.3"/><circle cx="10.2" cy="5.6" r="2.3"/>' +
        '<circle cx="13.8" cy="5.6" r="2.3"/><circle cx="17.7" cy="8.4" r="2.3"/></svg>' +
      '</span>' +
      '<span id="rk-launch-t"><b>Need a quick answer?</b><i>Ask Rocky — prices, timing, what we take</i></span>' +
      '<span id="rk-dot" aria-hidden="true"></span>' +
    '</button>' +

    '<section id="rk-panel" role="dialog" aria-modal="false" aria-labelledby="rk-title" hidden>' +
      '<header id="rk-head">' +
        '<img src="' + AVATAR + '" alt="" width="38" height="38" id="rk-av">' +
        '<div id="rk-id">' +
          '<strong id="rk-title">Rocky</strong>' +
          '<span id="rk-badge">AI guide</span>' +
          '<small>GTA Junk and Property Cleanout</small>' +
        '</div>' +
        '<div id="rk-tools">' +
          (canSpeak ? '<button type="button" id="rk-spk" aria-pressed="false" title="Read answers aloud" aria-label="Read answers aloud">' +
            '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M4 9v6h3l5 4V5L7 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12zM14 3.2v2.06A6.75 6.75 0 0 1 14 18.74v2.06A8.75 8.75 0 0 0 14 3.2z"/></svg></button>' : '') +
          '<button type="button" id="rk-close" title="Close" aria-label="Close Rocky">' +
            '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>' +
        '</div>' +
      '</header>' +
      '<div id="rk-log" role="log" aria-live="polite" aria-atomic="false"></div>' +
      '<div id="rk-chips"></div>' +
      '<form id="rk-form" autocomplete="off">' +
        '<label class="rk-sr" for="rk-in">Ask Rocky a question</label>' +
        '<textarea id="rk-in" rows="1" placeholder="What are you looking at? A garage, an estate, a hot tub…" maxlength="1200"></textarea>' +
        (canListen ? '<button type="button" id="rk-mic" aria-pressed="false" title="Speak your question" aria-label="Speak your question">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg></button>' : '') +
        '<button type="submit" id="rk-send" title="Send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>' +
      '</form>' +
      '<p id="rk-foot">Rocky is an AI guide. Ranges are indicative — Fabian confirms your price in writing at a free on-site assessment. ' +
        '<a href="' + PHONE_HREF + '">' + PHONE + '</a> &middot; <a href="/privacy/">Privacy</a></p>' +
    '</section>';
  document.body.appendChild(root);

  var elLaunch = root.querySelector('#rk-launch');
  var elPanel = root.querySelector('#rk-panel');
  var elLog = root.querySelector('#rk-log');
  var elChips = root.querySelector('#rk-chips');
  var elForm = root.querySelector('#rk-form');
  var elIn = root.querySelector('#rk-in');
  var elMic = root.querySelector('#rk-mic');
  var elSpk = root.querySelector('#rk-spk');

  /* ----------------------------------------------------------------- *
   * Bottom-edge arithmetic — stay clear of the call bar and cookie bar
   * ----------------------------------------------------------------- */
  function reflow() {
    var pad = 18;
    var bars = [document.querySelector('.sticky-bar'), document.getElementById('ckbar')];
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (!b) continue;
      var cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed') continue;
      pad += b.getBoundingClientRect().height;
    }
    root.style.setProperty('--rk-bottom', pad + 'px');
  }
  reflow();
  window.addEventListener('resize', reflow);
  var ck = document.getElementById('ckok');
  if (ck) ck.addEventListener('click', function () { setTimeout(reflow, 60); });
  setTimeout(reflow, 400);   // after the cookie bar decides whether to show

  /* ----------------------------------------------------------------- *
   * Rendering
   * ----------------------------------------------------------------- */
  function bubble(role, html, cls) {
    var d = document.createElement('div');
    d.className = 'rk-msg rk-' + role + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    elLog.appendChild(d);
    elLog.scrollTop = elLog.scrollHeight;
    return d;
  }

  /** Rocky's text: paragraphs, and bare URLs on our own site become links. */
  function format(text) {
    return esc(text)
      .split(/\n{2,}/)
      .map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; })
      .join('');
  }

  function chips(list) {
    elChips.innerHTML = '';
    if (!list || !list.length) return;
    list.slice(0, 4).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rk-chip';
      b.textContent = t;
      b.addEventListener('click', function () { send(t); });
      elChips.appendChild(b);
    });
  }

  /** UTM-tagged so the owner can see which answers actually move people. */
  function serviceLink(url, label) {
    var sep = url.indexOf('?') > -1 ? '&' : '?';
    var href = url + sep + 'utm_source=rocky&utm_medium=chat&utm_campaign=concierge';
    return '<a class="rk-cta" href="' + href + '">' + esc(label) + '</a>';
  }

  /* ----------------------------------------------------------------- *
   * Voice
   * ----------------------------------------------------------------- */
  function speak(text) {
    // ElevenLabs swap-in point: replace this body with a fetch to a /api/tts
    // function and play the returned audio. Nothing else needs to change.
    if (!canSpeak || !speakOn) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 600));
      u.lang = 'en-CA';
      u.rate = 1.02;
      u.pitch = 0.95;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  if (elSpk) elSpk.addEventListener('click', function () {
    speakOn = !speakOn;
    elSpk.setAttribute('aria-pressed', String(speakOn));
    elSpk.classList.toggle('on', speakOn);
    if (!speakOn && canSpeak) try { window.speechSynthesis.cancel(); } catch (e) {}
    ga('rocky_voice_toggle', { state: speakOn ? 'on' : 'off' });
  });

  function stopListening() {
    listening = false;
    if (elMic) { elMic.classList.remove('on'); elMic.setAttribute('aria-pressed', 'false'); }
    if (recog) try { recog.stop(); } catch (e) {}
  }

  if (elMic) elMic.addEventListener('click', function () {
    if (listening) return stopListening();
    try {
      recog = new SR();
      recog.lang = 'en-CA';
      recog.interimResults = true;
      recog.continuous = false;
      recog.onresult = function (e) {
        var t = '';
        for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
        elIn.value = t;
        grow();
        if (e.results[e.results.length - 1].isFinal) { stopListening(); send(t); }
      };
      recog.onerror = function (e) {
        stopListening();
        if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
          bubble('sys', '<p>Your browser blocked the microphone. You can turn it on in the padlock menu beside the address bar — or just type.</p>');
        }
      };
      recog.onend = stopListening;
      recog.start();
      listening = true;
      elMic.classList.add('on');
      elMic.setAttribute('aria-pressed', 'true');
      ga('rocky_voice_input');
    } catch (err) { stopListening(); }
  });

  /* ----------------------------------------------------------------- *
   * Lead capture — only once Rocky has been useful
   * ----------------------------------------------------------------- */
  function showLead() {
    if (leadShown) return;
    leadShown = true;
    var d = bubble('rocky', '', 'rk-lead');
    d.innerHTML =
      '<p><strong>Want Fabian to call you back?</strong> He runs every assessment himself. ' +
      'Leave three things and he will come back to you — no obligation, and the assessment is free.</p>' +
      '<form id="rk-lf">' +
        '<input type="text" name="name" placeholder="Your name" autocomplete="name" required maxlength="80">' +
        '<input type="tel" name="phone" placeholder="Phone" autocomplete="tel" required maxlength="40">' +
        '<input type="text" name="postal" placeholder="Postal code" autocomplete="postal-code" maxlength="12">' +
        '<button type="submit">Request my call back</button>' +
        '<small>We use this only to contact you about your enquiry. We do not sell your details or add you to a mailing list.</small>' +
      '</form>';

    d.querySelector('#rk-lf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var btn = f.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Sending…';

      // Netlify Forms. One destination for customer contact data, already
      // covered by the privacy policy, and it works with no CRM subscription.
      var body = new URLSearchParams({
        'form-name': 'rocky-lead',
        name: f.name.value,
        phone: f.phone.value,
        postal: f.postal.value,
        service: lastService || 'unknown',
        page: location.pathname,
        transcript: messages.slice(-10).map(function (m) { return m.role + ': ' + m.content; }).join('\n').slice(0, 4000)
      });

      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).then(function () {
        d.innerHTML = '<p><strong>Got it — thank you.</strong> Fabian will call you. ' +
          'If it is urgent, he is on <a href="' + PHONE_HREF + '">' + PHONE + '</a> right now.</p>';
        ga('generate_lead', { value: 350, currency: 'CAD', method: 'rocky_chat', service: lastService || 'unknown' });
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = 'Try again';
        bubble('sys', '<p>That did not go through. Easiest fix: call <a href="' + PHONE_HREF + '">' + PHONE + '</a>.</p>');
      });
    });
  }

  /* ----------------------------------------------------------------- *
   * Conversation
   * ----------------------------------------------------------------- */
  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    elIn.value = '';
    grow();
    chips([]);
    bubble('user', format(text));
    messages.push({ role: 'user', content: text });
    busy = true;
    ga('rocky_message', { page: location.pathname, n: messages.length });

    var think = bubble('rocky', '<span class="rk-dots"><i></i><i></i><i></i></span>', 'rk-think');

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-24), page: location.pathname })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        think.remove();
        var reply = data.reply || 'I did not catch that. Try me again, or call ' + PHONE + '.';
        var html = format(reply);
        if (data.url) html += serviceLink(data.url, 'See the full details');
        bubble('rocky', html);
        messages.push({ role: 'assistant', content: reply });
        lastService = data.service || lastService;
        // Degraded means the model call failed and Rocky answered from the
        // scripted fallback — usually an expired key or an empty credit
        // balance. Surface it, because the failure is otherwise invisible:
        // Rocky does not error, he just quietly gets less useful.
        if (data.degraded) {
          ga('rocky_degraded', { page: location.pathname });
          try { console.warn('Rocky is running in fallback mode — check ANTHROPIC_API_KEY and the Anthropic credit balance.'); } catch (e) {}
        }
        answered = true;
        chips(data.suggestions);
        speak(reply);
        save();
        // Offer the call-back once there is something to call about.
        if (messages.filter(function (m) { return m.role === 'user'; }).length >= 2) setTimeout(showLead, 700);
      })
      .catch(function () {
        think.remove();
        bubble('rocky', '<p>My connection dropped. Fabian is on <a href="' + PHONE_HREF + '">' + PHONE + '</a> — ' +
          'that is faster than me on a bad day anyway.</p>');
      })
      .then(function () { busy = false; elIn.focus(); });
  }

  function greet() {
    var p = location.pathname;
    var line = 'I am Rocky — the AI guide for GTA Junk and Property Cleanout. Ask me what something costs, what we take, or how soon we can be there, and you will get a straight answer.';
    if (/estate/.test(p)) line = 'I am Rocky, the AI guide here. If you are clearing a parent\'s or a relative\'s home, I can tell you what estate clearances run and what executors get for the file — just ask.';
    else if (/hoard/.test(p)) line = 'I am Rocky, the AI guide here. Anything you ask me stays between us. I can tell you what these projects run, and how we keep the work off the street.';
    else if (/demolition|garage-demolition/.test(p)) line = 'I am Rocky, the AI guide here. Ask me about shed and garage teardowns — cost, permits, and whether the slab comes out too.';
    else if (/commercial/.test(p)) line = 'I am Rocky, the AI guide here. Ask me about tenant-default clearing, white-box decommissioning, COIs or Net-30 terms.';
    else if (/pool/.test(p)) line = 'I am Rocky, the AI guide here. Ask me about above-ground pool and deck removal — including the sand base underneath, which is the real job.';
    else if (/insurance|restoration/.test(p)) line = 'I am Rocky, the AI guide here. Ask me about debris hauls, weigh tickets, and what we document for the adjuster.';
    else if (/pricing/.test(p)) line = 'I am Rocky, the AI guide here. Tell me what you are looking at and I will give you the range we publish for it — and what moves it inside that range.';
    bubble('rocky', format(line));
    chips(['What does a cleanout cost?', 'Do you demolish garages?', 'What can\'t you take?', 'How soon can you come?']);
  }

  /* ----------------------------------------------------------------- *
   * Open / close
   * ----------------------------------------------------------------- */
  function setOpen(v) {
    open = v;
    elPanel.hidden = !v;
    elLaunch.setAttribute('aria-expanded', String(v));
    root.classList.toggle('rk-open', v);
    if (v) {
      root.querySelector('#rk-dot').style.display = 'none';
      if (!messages.length && !elLog.children.length) greet();
      setTimeout(function () { elIn.focus(); }, 80);
      ga('rocky_open', { page: location.pathname });
    } else {
      stopListening();
      if (canSpeak) try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }
  elLaunch.addEventListener('click', function () { setOpen(!open); });
  root.querySelector('#rk-close').addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setOpen(false); });

  /* Any element with data-rocky opens Rocky — lets page copy invite him in. */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-rocky]') : null;
    if (!t) return;
    e.preventDefault();
    setOpen(true);
    var q = t.getAttribute('data-rocky');
    if (q && q !== 'open') setTimeout(function () { send(q); }, 250);
  });

  /* ----------------------------------------------------------------- *
   * Input ergonomics
   * ----------------------------------------------------------------- */
  function grow() {
    elIn.style.height = 'auto';
    elIn.style.height = Math.min(elIn.scrollHeight, 110) + 'px';
  }
  elIn.addEventListener('input', grow);
  elIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(elIn.value); }
  });
  elForm.addEventListener('submit', function (e) { e.preventDefault(); send(elIn.value); });

  /* ----------------------------------------------------------------- *
   * Persist within the tab, so navigating the site does not reset the
   * conversation. sessionStorage, not localStorage: a cleanout enquiry
   * should not still be sitting there in a fortnight.
   * ----------------------------------------------------------------- */
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ m: messages.slice(-24), s: lastService })); } catch (e) {}
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.m) || !d.m.length) return;
      messages = d.m;
      lastService = d.s || null;
      answered = true;
      messages.forEach(function (m) {
        bubble(m.role === 'user' ? 'user' : 'rocky', format(m.content));
      });
      bubble('sys', '<p>Picking up where we left off.</p>');
    } catch (e) {}
  }
  restore();

  /* First-visit nudge: a single peek, never again this session. */
  try {
    if (!sessionStorage.getItem(STORE + '_seen')) {
      setTimeout(function () {
        if (open) return;
        root.classList.add('rk-peek');
        sessionStorage.setItem(STORE + '_seen', '1');
        setTimeout(function () { root.classList.remove('rk-peek'); }, 9000);
      }, 2600);
    }
  } catch (e) {}
})();
