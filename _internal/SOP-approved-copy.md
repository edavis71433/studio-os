# Davis Digital Studio — Approved Copy & Phrasing (Source of Truth)

Check every copy change against this. It exists because the portal-framing line got
re-broken multiple times across sessions. When in doubt, this file wins.

## Locked phrasings

| Topic | ✅ Use this | ❌ Never say |
|---|---|---|
| Client portal | "Available as an add-on." / "Add it to any website project, or buy it on its own." | "Comes with every website" / "Included with every website I build" |
| Day job framing | "I work in enterprise digital." | "I manage enterprise digital programs" / naming the employer in marketing copy |
| Ongoing service | "Ongoing Support" (nav + body) | "Monthly Retainer" in user-facing copy (the `/monthly-retainer` URL stays as-is for links) |
| AI tools honesty | "AI-generated and informational only, not professional advice, and no guaranteed results." | "A real person reads these" or anything implying human review when it's automated |

## Pricing (keep these consistent everywhere — schema AND visible copy)

**Build packages**
- Template — entry tier
- Custom HTML — $6,500
- Custom Platform — from $12,000
- Client portal — paid add-on (not bundled)

**Audit product line (separate from builds — NOT a contradiction)**
- Essential Audit — $99
- Growth Audit — $499
- Studio Audit — $899

> If you change any price, update it in BOTH the visible page copy and the JSON-LD
> `Offer` schema. Grep for the old number across all `.html` before deploying.

## Tone rules (your standing preferences)
- No em dashes.
- Plain, conversational language. No AI-sounding phrasing.
- Direct, honest claims only. No overclaiming relative to current capability.
