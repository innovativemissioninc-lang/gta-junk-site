/* GTA Junk and Property Cleanout — Rocky, the AI guide.
   Loads the ElevenLabs conversational agent (voice + text) and puts a slim
   "Need a quick answer?" bar in the sticky nav that opens it.

   The agent itself — prompt, published price ranges, refusals, Fabian's
   cloned voice, Claude Haiku 5.5 — is configured in the ElevenLabs dashboard,
   not here. This file only mounts it and gets it clicked. */
(function () {
  "use strict";
  var AGENT_ID = "agent_7501m6w8q869fxhb24pspt3wms41";
  var WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed@0.21.4";
  if (!AGENT_ID || window.__rockyAI) return;
  window.__rockyAI = true;

  function track(name) {
    try { if (window.gtag) window.gtag("event", name, { event_category: "ai_guide" }); } catch (e) {}
  }

  var css = "" +
    ".rk-bar{border-top:1px solid rgba(249,115,22,.3);background:linear-gradient(90deg,rgba(249,115,22,.16),rgba(249,115,22,.06))}" +
    ".rk-bar button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:1120px;margin:0 auto;padding:8px 20px;font:600 14.5px/1.3 Arial,Helvetica,sans-serif;color:#E9EFF8}" +
    ".rk-bar button:focus-visible{outline:2px solid #F97316;outline-offset:-2px}" +
    ".rk-bar .w{display:inline-block;font-size:18px;transform-origin:70% 70%;animation:rkwave 3.2s ease-in-out infinite}" +
    ".rk-bar b{color:#F97316}" +
    ".rk-bar .go{flex:none;padding:5px 13px;border-radius:999px;background:#F97316;color:#fff;font-weight:900;font-size:13px}" +
    "@keyframes rkwave{0%,62%,100%{transform:rotate(0)}70%{transform:rotate(-16deg)}78%{transform:rotate(12deg)}86%{transform:rotate(-7deg)}}" +
    "@media(max-width:620px){.rk-bar .x{display:none}.rk-bar button{font-size:13.5px;padding:7px 12px}}" +
    "@media(prefers-reduced-motion:reduce){.rk-bar .w{animation:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var widget = document.createElement("elevenlabs-convai");
  widget.setAttribute("agent-id", AGENT_ID);
  widget.setAttribute("markdown-link-allowed-hosts", "gtajunkandpropertycleanout.ca");
  widget.setAttribute("action-text", "Need a quick answer?");
  widget.setAttribute("start-call-text", "Talk to Rocky");
  widget.addEventListener("elevenlabs-convai:call", function () { track("ai_guide_start"); });
  document.body.appendChild(widget);

  var s = document.createElement("script");
  s.src = WIDGET_SRC; s.async = true; s.type = "text/javascript";
  document.body.appendChild(s);

  /* Open the agent by clicking its own button inside the shadow root. */
  function openWidget() {
    track("ai_guide_bar_click");
    try {
      var root = widget.shadowRoot;
      var btn = root && (root.querySelector('button[aria-label*="call" i]') ||
                         root.querySelector('button[aria-label*="chat" i]') ||
                         root.querySelector("button"));
      if (btn) { btn.click(); return; }
    } catch (e) {}
    location.href = "tel:+16472040632";
  }

  /* The nav strip, shown only once the agent has actually rendered — a bar
     that opens nothing is worse than no bar. */
  var nav = document.querySelector("nav");
  if (nav) {
    var bar = document.createElement("div");
    bar.className = "rk-bar";
    bar.innerHTML = '<button type="button" aria-label="Ask Rocky, our AI guide, for a quick answer">' +
      '<span class="w" aria-hidden="true">👋</span>' +
      '<span><b>Need a quick answer?</b> <span class="x">Ask Rocky for a price range in seconds.</span></span>' +
      '<span class="go">Ask now</span></button>';
    bar.querySelector("button").addEventListener("click", openWidget);
    var tries = 0;
    (function wait() {
      var root = widget.shadowRoot;
      if (root && root.querySelector("button")) { nav.appendChild(bar); return; }
      if (++tries < 40) setTimeout(wait, 500);
    })();
  }
})();
