=== Artweel Booking ===
Contributors: artweel
Tags: booking, pottery, ceramics, classes, scheduling
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Put your pottery studio's booking page on your WordPress site.

== Description ==

Embeds your Artweel booking page into any WordPress page, with a block or a
shortcode. Customers browse classes, pick a time and pay without leaving your
site.

**This plugin does not run your bookings.** Availability, seat counts, payment
and cancellation all happen on Artweel. The plugin renders a container and
loads the booking page into it.

That is deliberate rather than lazy. Booking software's hardest problem is
making sure two people cannot take the last seat at the same moment, and that
belongs in one place with a database that can enforce it — not duplicated
across hundreds of WordPress installs on shared hosting where it cannot be
fixed after the fact.

The practical benefit: when the booking flow improves, your site gets it
without you updating anything.

= Features =

* Block and shortcode
* Resizes itself to fit the booking flow — no scrollbar inside your page
* Works on mobile
* Nothing about your customers is stored in WordPress
* No account or API key needed in the plugin

== Installation ==

1. Install and activate.
2. Go to **Settings → Artweel Booking** and enter your studio address — the
   last part of your booking page URL.
3. Add the **Artweel Booking** block to a page, or paste `[artweel]`.

== Frequently Asked Questions ==

= Do I need an Artweel account? =

Yes. The plugin displays a booking page that already exists; it does not create
one.

= Does this store customer data in WordPress? =

No. Nothing is written to your database. Bookings, names and payments live in
Artweel.

= Can I put booking pages for two studios on one site? =

Yes — pass the address on each one: `[artweel slug="first-studio"]` and
`[artweel slug="second-studio"]`.

= The booking page is cut off or has its own scrollbar =

It should resize itself. If it does not, a caching or optimisation plugin is
probably blocking the script that reports its height — try excluding
`embed.js` from JavaScript optimisation.

== Changelog ==

= 1.0.0 =
* First release: block, shortcode and settings page.
