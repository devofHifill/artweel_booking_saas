-- Payment settings, for Settings -> Payment Settings.
--
-- No payment-provider column: Stripe is the only one implemented, and a
-- column offering a choice the code cannot honour is a studio picking PayPal
-- and wondering why nothing changed. The screen shows a provider field
-- because operators expect to see who takes their money; it has one option
-- and it is not stored.
--
-- No processing-fee column either. Stripe does not expose an account's
-- negotiated rate through the API, so any number here would be a guess
-- printed next to somebody's revenue. The screen says where to find the real
-- one instead.

ALTER TABLE "organizations"
    -- A studio-wide gate OVER the per-activity deposit terms, not a
    -- replacement for them. Deposit type and value stay on service_types,
    -- where a six-week course and a two-hour taster can differ; this switches
    -- the whole idea off without editing every activity to do it.
    ADD COLUMN "deposits_enabled" BOOLEAN NOT NULL DEFAULT true,

    -- What a NEW activity's percentage deposit starts at. A default, like
    -- notice and horizon: it does not reach back into activities already set
    -- up, because somebody tuned those deliberately.
    ADD COLUMN "default_deposit_percent" INTEGER NOT NULL DEFAULT 0,

    -- Lets a customer book a chargeable class without paying now.
    --
    -- Defaults FALSE, and that is the safe direction: a studio that has
    -- connected Stripe has said it wants to be paid online, and switching
    -- this on by default would quietly let every customer skip checkout.
    ADD COLUMN "allow_pay_on_arrival" BOOLEAN NOT NULL DEFAULT false,

    -- Whether cash is offered as a method on a counter booking.
    ADD COLUMN "accept_cash" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "organizations"
    -- 100% is not a deposit, it is the whole price; zero means the activity
    -- decides. Both ends bounded so the checkout cannot be handed a
    -- percentage that makes the amount due exceed the total.
    ADD CONSTRAINT "organizations_default_deposit_range"
        CHECK ("default_deposit_percent" BETWEEN 0 AND 99);
