# Everything in Moderation

**A live floor console for the chair of a Christian & Missionary Alliance business session** — the national General Assembly and its district conferences.

In one place it holds the agenda, the motions on the floor, and a parliamentary advisor grounded in *your* governing documents and Robert's Rules of Order. It keeps the chair fast, cited, and neutral.

🔗 **Live demonstration:** [moderation.smittyos.ca](https://moderation.smittyos.ca)

---

## Status

This project is being extracted into a standalone, self-hostable application from the private system where it was first built. What exists today:

- ✅ **The demonstration site** ([moderation.smittyos.ca](https://moderation.smittyos.ca)) — a faithful, static walkthrough of the console with setup tips. Its source is in [`/site`](./site).
- ✅ **The design** — architecture, schema, and the district-conference setup guide, documented below.
- 🚧 **The application code** — being published progressively.

It was first used live at the **General Assembly of The Christian & Missionary Alliance in Canada, 2026** — 15 agenda items and 37 floor motions across the business sessions.

## What it does

- **Agenda** — items in order, stepped through live as the session moves, with one-tap "back" to recover from a mis-click.
- **Floor motions** — wording (with amendments shown as struck-through and underlined text), whether seconded, the vote required, disposition (adopted / defeated / tabled / withdrawn), and vote counts. Resolutions carry codes, and an adopted amendment automatically bumps its parent motion's code.
- **Parliamentarian** — ask in plain language ("what vote does this need?", "is this motion in order?") and get an answer drawn only from your loaded documents and Robert's Rules, **with citations**.
- **Threshold suggestions** — a classifier proposes the adoption threshold (majority / two-thirds) for a free-text motion, which the chair confirms or overrides.
- **Support team** — scoped, sign-in-by-code access for a clerk or assistant on the floor.

## It advises — the chair decides

The advisor phrases everything as "the chair may rule…"; the ruling is always the moderator's. It answers **only** from the documents you load, and says plainly when something isn't settled rather than guessing. It is not a generic rules bot — it is grounded in the law that governs *your* assembly.

## The authority model

The advisor cites in a fixed order of authority. The project ships two presets:

**National assembly** (the General Assembly is federally incorporated and is *not* registered provincially):

1. Federal *Canada Not-for-Profit Corporations Act*
2. C&MA national governing documents
3. Robert's Rules of Order (12th ed.)

**District conference** (a district is provincially/federally incorporated and sits under the national church) — the jurisdictional **inverse** of the national assembly:

1. Your **incorporating** statute (federal, or the province/territory of incorporation)
2. C&MA national governing documents (the district is a subordinate body)
3. Your district constitution, bylaws, and standing rules
4. Robert's Rules of Order (12th ed.)

> ⚠️ **Use your incorporating jurisdiction — not a province you merely operate in.** Some districts span more than one province or territory. The tool must be pointed at the jurisdiction the district is *incorporated under*, or the advisor would cite law that doesn't bind the assembly.

## Architecture

- **Next.js** (App Router) + **TypeScript** + **Tailwind**, deployed on **Vercel**
- **Supabase** — Postgres (agenda, motions, governing-document corpus), auth (email one-time-code), storage; row-level security scoped per organization
- **Anthropic** — the Parliamentarian and the threshold classifier
- **OpenAI** — embeddings (`text-embedding-3-small`) for semantic search over your documents; combined with full-text search and multi-window excerpting
- **Resend** — sign-in codes and team invitations

Multi-tenant by `organization` (national assembly / district conference), each with its own branding, authority configuration, and document corpus. `assembly` records scope each event so prior years import as history and a new year starts clean.

## Run your own copy

The code is open and free. Each district stands up its **own** deployment on its **own** accounts — a weekend's work for someone comfortable with web apps. You'll establish:

| Service | Used for |
|---|---|
| [Supabase](https://supabase.com) | Database, auth, storage |
| [Vercel](https://vercel.com) | Hosting |
| [Anthropic](https://www.anthropic.com) | The parliamentary advisor + threshold suggestions |
| [OpenAI](https://platform.openai.com) | Document-search embeddings |
| [Resend](https://resend.com) | Sign-in and invitation email |

Ongoing cost is the deploying district's own — modest, mostly free or low-tier services adequate for an occasional conference.

## Preparing the tool for a district conference

Once your deployment is running, customizing it for your context is data and document uploads — no code changes:

1. **Confirm your incorporating jurisdiction** (federal, or a single province/territory). Everything downstream keys off this. *Do not use a province you only operate in.*
2. **Create your organization** — name, `kind: district_conference`, branding (logo, colours, app title).
3. **Pick the district authority preset** and fill in the hierarchy above.
4. **Confirm the jurisdiction note** — the preset's template paragraph, edited to name your body and incorporating jurisdiction.
5. **Upload and ingest your documents** — district constitution, bylaws, standing rules, your incorporating statute, and the national governing documents. Robert's Rules ships with the project.
6. **Scope the corpus** to your documents so the advisor only grounds in your body's law.
7. **Add people** — the chair and any support team (they sign in with a one-time code).
8. **Set branding and sender** — confirm sign-in and invitation emails appear as your district.
9. **Dry run** — load a test agenda, enter sample motions, confirm the advisor cites *your* documents and your incorporating statute, then reset before going live.

### What you'll gather

Your constitution / bylaws / standing rules, confirmation of your incorporating jurisdiction, your logo and brand colours, an app title, the chair's and support team's email addresses, and any vote thresholds your bylaws set beyond the usual.

## License

[MIT](./LICENSE) — free to use, adapt, and self-host.

---

*Built and maintained by Chris Smith.*
