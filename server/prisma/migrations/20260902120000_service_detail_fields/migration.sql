-- G3 — the two questions a booking page could not answer.
--
-- "What is included" and "what should I bring" are not decoration on a
-- three-hour wheel class: they are the questions that otherwise arrive as a
-- phone call the studio has to answer one customer at a time.
--
-- Both nullable, both with a fallback in the renderer, so the OLD server
-- serving requests mid-deploy ignores them and paints the page it always did.
-- Nothing an existing studio sees changes until they write something.
--
-- highlights is one bullet PER LINE rather than a text[]. No array column
-- exists anywhere in this schema, and organizations.about already sets the
-- precedent for owner-authored prose kept as text and split in the renderer.
--
-- Bounds asserted at both ends, as with the storefront copy: zod on the write
-- path for a readable message, and CHECK here so a value arriving any other
-- way — a fixture, a support session, a psql window — cannot render a
-- thousand-line ingredients list onto somebody's booking page.

ALTER TABLE "service_types"
    ADD COLUMN "highlights"        TEXT,
    ADD COLUMN "preparation_notes" TEXT;

ALTER TABLE "service_types"
    ADD CONSTRAINT "service_types_highlights_len"
        CHECK ("highlights" IS NULL OR char_length("highlights") <= 1200),
    -- Twelve bullets is already more than anybody reads before booking. Counted
    -- as newlines + 1, which is exact for the one-per-line format the renderer
    -- splits on.
    ADD CONSTRAINT "service_types_highlights_lines"
        CHECK (
            "highlights" IS NULL
            OR array_length(string_to_array("highlights", E'\n'), 1) <= 12
        ),
    ADD CONSTRAINT "service_types_preparation_notes_len"
        CHECK ("preparation_notes" IS NULL OR char_length("preparation_notes") <= 2000);
