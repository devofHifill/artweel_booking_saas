-- A job title for the staff card.
--
-- The card shows a name and, under it, what that person is. `bio` already
-- exists and is the wrong field: it is prose written for the public booking
-- page ("Ellen has thrown pots for twenty years and…"), and the first line of
-- it truncated into a card slot reads as a broken sentence rather than a role.
--
-- Free text on purpose. Job titles in a studio are "Wheel instructor",
-- "Studio technician", "Saturday kids' class" — a list nobody can finish, and
-- an enum here would be a support request every time somebody hired.
--
-- Nullable with a renderer fallback, so every existing staff member keeps
-- working and their card simply shows no second line until somebody types one.
ALTER TABLE "staff"
    ADD COLUMN "role" TEXT;

ALTER TABLE "staff"
    ADD CONSTRAINT "staff_role_len"
        CHECK ("role" IS NULL OR char_length("role") <= 80);
