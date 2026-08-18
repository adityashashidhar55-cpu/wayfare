# Putting Wayfare on the internet

Reading time: 3 minutes. Doing time: about 20 minutes, almost all of it
waiting for a build.

You need two accounts. I cannot make them for you — signing up and typing
passwords is yours to do. Everything after that is copy and paste.

- **TiDB Cloud** — the database. Free forever at demo size.
- **Render** — the server that runs the app. $7/month for an always-on box.

---

## Why these two and not something else

Wayfare is **one program**. The same server answers the API *and* serves the
website *and* builds the little preview card that appears when someone shares
an itinerary on WhatsApp. It cannot be split into "a static site plus some
functions" — the preview card is generated per trip, at request time, by this
server. So we need somewhere that runs a normal long-lived Node process, and
Render is the cheapest boring one.

The database has to speak **MySQL**. All 40 tables, and every query in the
app, are written for MySQL. TiDB Cloud is MySQL-compatible and has a genuinely
free tier. Supabase is excellent but it is **Postgres** — moving to it means
rewriting the 40-table schema and about 80 places in the code that read
MySQL-only values back from an insert. That is a day of work and a day of new
bugs, so: not before the investor demo.

---

## Step 1 — Make the database (5 min)

1. Go to <https://tidbcloud.com> and sign up.
2. Create a **Serverless** cluster. Pick the region closest to you —
   `Singapore (ap-southeast-1)` if you are in India.
3. Click **Connect**. Choose **General** / connection string.
4. Copy the string. It looks like:

   ```
   mysql://xxxx.root:PASSWORD@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test
   ```

5. Change the database name at the end from `test` to `wayfare`, and create
   that database first in the SQL editor with:

   ```sql
   CREATE DATABASE wayfare;
   ```

Keep that string. That is your `DATABASE_URL`.

> You do **not** need to create any tables, and you do **not** need to import
> any data. The app does both by itself on its first start. See "What happens
> on first boot" below.

---

## Step 2 — Deploy the app (10 min)

1. Go to <https://render.com> and sign up with GitHub.
2. **New → Blueprint**, and pick the `wayfare` repository.
3. Render finds `render.yaml` and asks you for four values. Paste these:

   | Name | Value |
   |---|---|
   | `APP_ID` | `wayfare-0508c64d2ae114e4` |
   | `APP_SECRET` | `Dpc-M4kYEjRNx9sMaqZPyv3Dt23GLvxcgcTh6a0ZhatSvhuO` |
   | `DATABASE_URL` | the string from step 1 |
   | `APP_URL` | leave blank for now |

   `APP_ID` and `APP_SECRET` are freshly generated random values, not
   placeholders. They only need to be secret and stable.

4. Click **Apply**. The first build takes 5–8 minutes.
5. When it is live, Render gives you a URL like
   `https://wayfare.onrender.com`. Go back to **Environment**, set `APP_URL`
   to exactly that URL, and save. It restarts.

That URL is your demo link.

---

## What happens on first boot (so the logs make sense)

Watch the Render logs. In order, you will see:

```
Server running on http://localhost:3000/
[bootstrap] empty database - creating schema...
[bootstrap] schema ready (41 statements)
[bootstrap] loading place corpus (this takes a few minutes)...
[bootstrap] ...50 batches in 34s
...
[bootstrap] corpus loaded: 526142 places in ~4m
```

The site is **usable the moment the first line appears**. The place data loads
behind it, so Explore fills in a few minutes later. If the container restarts
during the load, the next boot picks up where it left off — nothing gets
duplicated and nothing gets skipped.

If you ever want to turn this off, set `AUTO_BOOTSTRAP=0`.

---

## Demoing it

Open the link and click **Try as guest**. You land in a fully populated
account: a Voyager subscription, a taste profile, a 6-day *Japan in Bloom*
itinerary across Kyoto/Nara/Osaka with three travellers, ten shared expenses
split three ways, reservations, packing list, a Lisbon trip coming up and a
Copenhagen trip already taken. Every guest gets their own fresh copy, so you
can hand the link to ten people at once and nobody sees anyone else's edits.

---

## Things you can add later, in the order they earn their keep

| Add | What it turns on | Where |
|---|---|---|
| `RESEND_API_KEY` + `MAIL_FROM` | Trip invites actually arrive; password reset works | resend.com, free 3k/month |
| `VITE_AFF_GETYOURGUIDE` etc. | Booking links start earning commission | partner.getyourguide.com |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | Paid upgrades (UPI included) | dashboard.razorpay.com |
| `GOOGLE_CLIENT_ID` + secret | "Sign in with Google" button appears | console.cloud.google.com |
| A custom domain | `wayfare.app` instead of `.onrender.com` | Render → Settings → Custom Domain |

Nothing in that table is required. Every one of them is optional by design:
the app checks whether the key is present and hides the feature if it is not,
rather than crashing or — worse — pretending it worked.

---

## If something goes wrong

**`Missing required environment variable: DATABASE_URL`** — the value did not
save. Render → Environment → check for a stray space at the start.

**`Connections using insecure transport are prohibited`** — TiDB requires
encryption. The app adds it automatically for `*.tidbcloud.com`, so if you see
this you are on a different provider: add `?ssl={"rejectUnauthorized":true}`
to the end of `DATABASE_URL`, or set `DB_SSL=on`.

**`Unknown database 'wayfare'`** — you skipped the `CREATE DATABASE wayfare;`
in step 1.

**Explore is empty** — the corpus is still loading, or it failed. Search the
logs for `[bootstrap]`; the last line tells you which.
