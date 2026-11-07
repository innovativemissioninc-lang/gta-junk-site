# Rocky — the AI concierge

Rocky is on every page of the site. He answers questions about services,
coverage, timing and **price ranges**, and he books nothing he cannot honour.

---

## The one thing you must do to switch him on

Rocky works right now without any setup — but in a limited, scripted way. To
give him the full conversational intelligence, add one environment variable:

1. Netlify → your site → **Site configuration** → **Environment variables**
2. **Add a variable**: key `ANTHROPIC_API_KEY`, value your key from
   <https://console.anthropic.com> → API Keys
3. Scope it to **All deploy contexts**, save, then **Deploys → Trigger deploy →
   Clear cache and deploy site**

That key is the same one the `/see-your-price/` video estimate uses.

**Checked on 7 November 2026: there are no environment variables on this
project at all**, at either project or team level. So the key has never been
set, which means the video estimator has also been returning *"Our estimator
is offline right now"* to every visitor since it shipped — while being linked
from all 65 pages and listed in the sitemap. One key fixes both features.

**Until the key is set**, Rocky falls back to a deterministic script: he still
identifies the service from what the customer types, states the published
range, lists what moves the price, and offers the call-back form. He is just
not conversational. Nothing breaks, and no customer sees an error.

### What it costs

Rocky runs on Claude Haiku — the cheap, fast model. A typical conversation is
a fraction of a cent. Spend is capped three ways: 700 output tokens per reply,
24 turns per conversation, and 12 messages per minute per visitor. A thousand
real conversations a month is a few dollars, not a few hundred.

---

## The rule Rocky cannot break

**Rocky can only say dollar figures this business has published.**

This is enforced in code, not by asking the model nicely. Every reply is
scanned before it reaches the customer. Any dollar figure that is not in the
published table is rejected, the model is asked to rewrite the answer, and if
it fails twice the reply is replaced with "I would rather not put a number on
that one from here — call Fabian."

So Rocky physically cannot:

- invent an hourly, per-item, per-yard or per-tonne rate (none are published)
- average or split a range into a single number
- offer a discount, a price match or a free add-on
- quote below the $1,500 minimum, except the published $550 hot tub

Every range Rocky gives carries the same caveat you use yourself: the firm
number is fixed in writing at a free on-site assessment. He is also told to
*lose* a job that falls under the minimum rather than quote it badly, and to
say why.

### Where the prices live

**`netlify/functions/_pricing.js`.** One file. Nothing else contains a price.

To change a price, edit that file and nothing else — the system prompt, the
guard, the scripted fallback and the suggestion chips all read from it, so they
cannot drift apart. Commit, and it is live in about a minute.

This matters more than it sounds. Before Rocky, three places quoted prices
independently and two of them were still on the pre-pivot numbers:

| Where | Was saying | Now |
|---|---|---|
| Homepage `makesOffer` schema | $495 / $795 / $1,195 as live offers | the four current tiers |
| `/see-your-price/` video estimate | $495–$620 and $795–$950 | $1,500–$2,200 and $2,000–$3,200 |
| `llms.txt` | video estimate gives "a rough price" | "an indicative project range" |

The homepage case was the bad one: `makesOffer` said $495 in the *same*
structured-data block whose `hasOfferCatalog` said the minimum was $1,500.
Google and the AI answer engines were reading both and believing the cheaper
one. A customer could also have filmed a garage, been shown "$495 to $620",
and then been told $1,500 on the phone. All three now agree.

---

## What Rocky refuses, and why it is decided in code

Hazardous, biohazard and electrical requests never reach the model. They are
intercepted by keyword and answered with a fixed script, because your MECP
registration **R-004-5477911257 is non-hazardous only** and that is not
something to leave to a model's judgement on a bad day.

| Trigger | What Rocky says |
|---|---|
| asbestos, paint, solvents, chemicals, propane, fuel, pesticides | Cannot transport it; clears around it; abatement goes to a licensed contractor |
| biohazard, sharps, animal waste, blood, decomposition | Refers to a licensed remediation contractor, offers to handle the volume after clearance |
| panel, breaker, hardwire, rewire, electrical disconnect | Needs an ESA-licensed contractor; the removal is still ours once isolated |

Rocky is also instructed never to claim WSIB coverage, never to describe the
company as a remediation or abatement outfit, and to say that pre-1990
structures get an asbestos assessment before a demolition quote.

---

## He always says he is an AI

The panel header carries a permanent **AI GUIDE** badge, the opening line says
it in words, and the footer repeats it next to the price caveat. He is
instructed never to pretend to be you or a crew member.

This is deliberate and should stay. A concierge that lets someone believe they
have already spoken to the owner creates a customer who thinks they have a
quote.

---

## Voice

The microphone and speaker buttons use the browser's own speech engine —
**free, no account, nothing to subscribe to.** Speech-to-text happens on the
customer's own device, so no audio recording ever reaches us, which is also
what the privacy policy now says.

Works in Chrome, Edge and Safari. In Firefox the buttons simply are not
rendered rather than being present and broken.

> One fix was needed to make this work at all: `netlify.toml` had
> `Permissions-Policy: microphone=()`, which disabled the microphone outright
> for the whole site. It is now `microphone=(self)`. Voice would have failed
> silently on every browser without that.

### Upgrading to your own cloned voice (ElevenLabs)

Not built, deliberately — it is a paid subscription and not worth it until
Rocky is earning. When you want it, the change is small and contained:

1. Create a voice at elevenlabs.io, add `ELEVENLABS_API_KEY` in Netlify
2. Add `netlify/functions/tts.js` that proxies text to their
   text-to-speech endpoint and returns the audio
3. In `assets/rocky.js`, replace the body of `speak()` — about eight lines —
   with a fetch to `/api/tts` and an `Audio` playback

Nothing else changes. The function is marked with a comment at the swap point.

**Keep the AI disclosure if you do this.** A synthetic version of your own
voice that does not say it is synthetic is the one version of this feature that
could cause you a real problem.

---

## Leads

The call-back form appears **only after Rocky has answered something** — there
is no email gate, because asking for a phone number before being useful is how
a concierge becomes a toll booth.

Submissions land in **Netlify → Forms → `rocky-lead`**, the same place as every
other form on the site. Each one carries name, phone, postal code, the matched
service, the page they were on, and the last ten lines of the conversation — so
you know what they asked about before you call.

No CRM subscription is needed. If you later want GoHighLevel, point the fetch
in `showLead()` at its inbound webhook; the field names are already the ones a
CRM expects.

### What you can see in Google Analytics

| Event | Fires when |
|---|---|
| `rocky_open` | someone opens the panel |
| `rocky_message` | each question asked |
| `rocky_voice_input` | someone speaks instead of typing |
| `rocky_voice_toggle` | read-aloud turned on or off |
| `generate_lead` | call-back form submitted, valued at $350 CAD |

Every "See the full details" link Rocky offers is tagged
`utm_source=rocky&utm_medium=chat`, so you can see in GA4 which answers
actually move people onto a service page.

---

## Putting Rocky in your page copy

Any element with a `data-rocky` attribute opens him. With a value, he is asked
that question immediately:

```html
<a href="#" data-rocky="What does a hoarding cleanout cost?">Ask Rocky what this costs</a>
<button data-rocky="open">Ask Rocky</button>
```

Useful on the pricing page and in FAQ sections, where someone is already
thinking about a number.

---

## Testing after any change

```
node test-rocky.js          # 99 assertions: price guard, refusals, routing, prompt
./check-before-deploy.sh    # stamps asset versions, validates the site
```

The price guard tests are the ones that matter. They try to get an invented
figure past the guard eight different ways — averaging a range, inventing an
hourly rate, quoting under the minimum, malformed digit grouping — and all
eight must be caught. **If those fail, do not deploy.** The guard is the entire
reason it is safe to let an AI discuss price on a site whose promise is that
the written number is the number you pay.

One real bug was found this way during the build: the guard flagged your own
published sentence "from $550, or from $900 with the deck", because the match
was swallowing the comma after `$550`. Caught by a test rather than by a
customer.

---

## Two things to watch in the first fortnight

1. **Read the transcripts in Netlify Forms.** The questions people actually ask
   Rocky are the highest-quality keyword research you will ever get — real
   phrasing, real anxieties, free. Anything asked three times deserves to be an
   FAQ on the matching page, which also feeds the AI answer engines.
2. **Check the function logs** (Netlify → Logs → Functions → `rocky`) for lines
   beginning `rocky: unapproved figures`. Each one is the guard catching the
   model trying to invent a price. A handful is normal and means it is working.
   A flood means the pricing table needs a figure it does not have — for
   example if you start quoting a service Rocky has no range for.
