# Place stories contract (db/data/place-stories-*.json)

Each file is a JSON array of story entries for the Wayfare places importer.
Entry shape: `{ "name", "city", "country", "lat", "lng", "category", "story" }`.
- `name`/`city`/`country`: spelled the common way; the importer matches on these.
- `lat`/`lng`: numbers; omit both keys entirely if the exact spot is not reasonably known.
- `category`: "activity" unless a new category is agreed with the importer.
- `story`: 400-1200 chars, plain text, 2-3 short paragraphs separated by `\n\n`; no markdown, URLs or emoji.
- Fact discipline: only widely known, verifiable facts; generalize dates/names you are unsure of; never invent dynasties, dates, heights or legends. Shorter and true beats longer and wrong.
- Validate before committing: `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.
