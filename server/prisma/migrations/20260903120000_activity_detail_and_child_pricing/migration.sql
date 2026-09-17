-- The Create-activity form, brought up to the prototype's.
--
-- Six columns on service_types and ONE on bookings. The asymmetry is the
-- interesting part and it is deliberate — see the note on children below.
--
-- Every service_types column is nullable with a renderer fallback, so an old
-- server serving requests mid-deploy paints exactly the page it always did.
-- Nothing an existing studio sees changes until somebody fills one in.

ALTER TABLE "service_types"
    -- The one line that sells it. `description` is the long form and is shown
    -- on the detail panel; this is what fits on a card next to nine others,
    -- and truncating the long one at 90 characters produced "Centring,
    -- pulling and trimming over six weeks with an emphasis on…" which sells
    -- nothing.
    ADD COLUMN "short_description" TEXT,

    -- 0 means adults only, which is both the prototype's convention and the
    -- correct default: a studio that has not thought about children should
    -- not accidentally offer them a free place. Distinguishing "no child rate"
    -- from "children go free" is what the NOT NULL DEFAULT 0 gives up, and
    -- free children are rare enough that a studio wanting them can price the
    -- adult seat accordingly. NOT NULL because the pricing path multiplies it
    -- and a null would have to be coalesced at every call site.
    ADD COLUMN "child_price_cents" INTEGER NOT NULL DEFAULT 0,

    -- Distinct from the location's address. "Dock B, blue canopy" is not
    -- somewhere a map can take you and is exactly what stops a customer
    -- phoning from the car park.
    ADD COLUMN "meeting_point" TEXT,

    -- A picked glyph, not an upload. There is no asset pipeline in this
    -- product and a booking page that half-renders broken <img> tags is worse
    -- than one with no pictures at all.
    ADD COLUMN "emoji" TEXT,

    -- The second stop of the card gradient; `color` is the first and stays
    -- the calendar colour. Nullable, and the renderer falls back to a shade
    -- derived from `color`, so an existing service keeps a coherent card
    -- without anybody editing it.
    ADD COLUMN "color_accent" TEXT,

    -- Sent WITH the confirmation, where preparation_notes is shown BEFORE
    -- booking. Same medium, opposite moment: one answers "should I book
    -- this", the other "what do I do now that I have".
    ADD COLUMN "booking_instructions" TEXT;

ALTER TABLE "service_types"
    ADD CONSTRAINT "service_types_short_description_len"
        CHECK ("short_description" IS NULL OR char_length("short_description") <= 200),
    ADD CONSTRAINT "service_types_meeting_point_len"
        CHECK ("meeting_point" IS NULL OR char_length("meeting_point") <= 300),
    -- Long enough for a flag sequence or a skin-tone modifier, short enough
    -- that the column cannot quietly become a caption field.
    ADD CONSTRAINT "service_types_emoji_len"
        CHECK ("emoji" IS NULL OR char_length("emoji") <= 8),
    ADD CONSTRAINT "service_types_color_accent_hex"
        CHECK ("color_accent" IS NULL OR "color_accent" ~ '^#[0-9a-fA-F]{6}$'),
    ADD CONSTRAINT "service_types_booking_instructions_len"
        CHECK ("booking_instructions" IS NULL OR char_length("booking_instructions") <= 2000),
    -- A child rate above the adult rate is a typo every time, and it is the
    -- kind that gets discovered by a parent at checkout.
    ADD CONSTRAINT "service_types_child_price_nonneg"
        CHECK ("child_price_cents" >= 0);

-- Bookings get ONE column, not two.
--
-- The obvious shape is `adults` and `children`, and it is wrong: it makes
-- adults + children a second, independent claim about a number `seats`
-- already holds, and the two WILL drift — a seat added by the counter form,
-- a waitlist promotion, any path that touches seats without knowing about the
-- split. Then the manifest says four and the payment says three and there is
-- no way to tell which lied.
--
-- So `seats` stays the total and the only thing anyone counts, and this
-- records how many of those seats are children. Adults are seats - children,
-- which cannot disagree with itself. Every existing row is correct by
-- construction: zero children, all seats adult, which is what they were sold
-- as.
ALTER TABLE "bookings"
    ADD COLUMN "children" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_children_within_seats"
        CHECK ("children" >= 0 AND "children" <= "seats");
