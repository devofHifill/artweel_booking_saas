<?php
/**
 * Plugin Name:       Artweel Booking
 * Plugin URI:        https://artweel.fillforge.cloud
 * Description:       Embed your pottery studio's booking page on any WordPress page with a shortcode or block.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       artweel-booking
 *
 * ---------------------------------------------------------------------------
 * This plugin contains NO booking logic, and that is the whole design.
 *
 * Everything — availability, seats, payment, cancellation — happens on the
 * Artweel side, inside an iframe. A WordPress plugin that reimplemented any of
 * it would be a second copy of the concurrency rules running on somebody's
 * shared host, which is exactly the mistake the original WP Booking Flow
 * plugin made: seat counts read and written with no lock, on a platform where
 * you cannot fix it once it is installed on five hundred sites.
 *
 * So this file renders a div and a script tag. When the booking flow changes,
 * studios get it without updating anything.
 * ---------------------------------------------------------------------------
 */

// Loaded directly rather than through WordPress. Nothing to do.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ARTWEEL_VERSION', '1.0.0' );
define( 'ARTWEEL_DEFAULT_ORIGIN', 'https://artweel.fillforge.cloud' );

/**
 * Where the widget is loaded from.
 *
 * Overridable so a studio on a custom domain, or anyone running this against a
 * staging instance, does not need a forked plugin.
 */
function artweel_origin() {
	$origin = get_option( 'artweel_origin', ARTWEEL_DEFAULT_ORIGIN );
	$origin = untrailingslashit( trim( $origin ) );

	// Refuse anything that is not a plain http(s) origin. A javascript: or
	// data: URL here would become a script tag on every page of the site.
	if ( ! preg_match( '#^https?://[A-Za-z0-9.\-]+(:\d+)?$#', $origin ) ) {
		return ARTWEEL_DEFAULT_ORIGIN;
	}

	return $origin;
}

/**
 * Registers the loader script.
 *
 * Not enqueued globally — only on pages that actually contain the shortcode or
 * block, so a site with one booking page does not ship this on every post.
 */
function artweel_register_assets() {
	wp_register_script(
		'artweel-embed',
		artweel_origin() . '/embed.js',
		array(),
		ARTWEEL_VERSION,
		true
	);
}
add_action( 'init', 'artweel_register_assets' );

/**
 * Renders the embed.
 *
 * @param array $atts Shortcode or block attributes.
 * @return string HTML.
 */
function artweel_render( $atts = array() ) {
	$atts = shortcode_atts(
		array(
			'slug'   => get_option( 'artweel_slug', '' ),
			'height' => '900',
		),
		$atts,
		'artweel'
	);

	$slug = sanitize_title( $atts['slug'] );

	if ( empty( $slug ) ) {
		// Visible to an editor, silent for a visitor. A studio that has not
		// set their slug should be told; their customers should not see it.
		if ( current_user_can( 'edit_posts' ) ) {
			return '<p><strong>' .
				esc_html__( 'Artweel: set your studio address in Settings → Artweel Booking, or pass slug="your-studio".', 'artweel-booking' ) .
				'</strong></p>';
		}
		return '';
	}

	wp_enqueue_script( 'artweel-embed' );

	$height = absint( $atts['height'] );
	if ( $height < 200 || $height > 5000 ) {
		$height = 900;
	}

	return sprintf(
		'<div class="artweel-booking" data-studio="%s" data-height="%d"></div>',
		esc_attr( $slug ),
		$height
	);
}
add_shortcode( 'artweel', 'artweel_render' );

/**
 * The same thing as a block, so the editor is not a hostile place.
 *
 * Registered server-side and rendered by the same function, so the block and
 * the shortcode cannot drift apart.
 */
function artweel_register_block() {
	if ( ! function_exists( 'register_block_type' ) ) {
		return;
	}

	register_block_type(
		'artweel/booking',
		array(
			'api_version'     => 2,
			'title'           => __( 'Artweel Booking', 'artweel-booking' ),
			'category'        => 'embed',
			'icon'            => 'calendar-alt',
			'description'     => __( "Your studio's booking page, embedded.", 'artweel-booking' ),
			'attributes'      => array(
				'slug'   => array(
					'type'    => 'string',
					'default' => '',
				),
				'height' => array(
					'type'    => 'number',
					'default' => 900,
				),
			),
			'render_callback' => 'artweel_render',
		)
	);
}
add_action( 'init', 'artweel_register_block' );

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function artweel_settings_menu() {
	add_options_page(
		__( 'Artweel Booking', 'artweel-booking' ),
		__( 'Artweel Booking', 'artweel-booking' ),
		'manage_options',
		'artweel-booking',
		'artweel_settings_page'
	);
}
add_action( 'admin_menu', 'artweel_settings_menu' );

function artweel_register_settings() {
	register_setting(
		'artweel_booking',
		'artweel_slug',
		array( 'sanitize_callback' => 'sanitize_title' )
	);
	register_setting(
		'artweel_booking',
		'artweel_origin',
		array( 'sanitize_callback' => 'esc_url_raw' )
	);
}
add_action( 'admin_init', 'artweel_register_settings' );

function artweel_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$slug = get_option( 'artweel_slug', '' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Artweel Booking', 'artweel-booking' ); ?></h1>

		<form action="options.php" method="post">
			<?php settings_fields( 'artweel_booking' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">
						<label for="artweel_slug"><?php esc_html_e( 'Studio address', 'artweel-booking' ); ?></label>
					</th>
					<td>
						<input name="artweel_slug" id="artweel_slug" type="text"
							value="<?php echo esc_attr( $slug ); ?>" class="regular-text" />
						<p class="description">
							<?php
							printf(
								/* translators: %s: example booking page URL */
								esc_html__( 'The last part of your booking page address. If it is %s, enter clay-and-co.', 'artweel-booking' ),
								'<code>' . esc_html( artweel_origin() ) . '/public/clay-and-co</code>'
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">
						<label for="artweel_origin"><?php esc_html_e( 'Artweel address', 'artweel-booking' ); ?></label>
					</th>
					<td>
						<input name="artweel_origin" id="artweel_origin" type="url"
							value="<?php echo esc_attr( get_option( 'artweel_origin', ARTWEEL_DEFAULT_ORIGIN ) ); ?>"
							class="regular-text" />
						<p class="description">
							<?php esc_html_e( 'Leave this alone unless you were told otherwise.', 'artweel-booking' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<?php submit_button(); ?>
		</form>

		<h2><?php esc_html_e( 'Putting it on a page', 'artweel-booking' ); ?></h2>
		<p><?php esc_html_e( 'Add the Artweel Booking block, or paste this shortcode:', 'artweel-booking' ); ?></p>
		<p><code>[artweel<?php echo $slug ? ' slug="' . esc_html( $slug ) . '"' : ''; ?>]</code></p>
		<p class="description">
			<?php esc_html_e( 'Nothing about your bookings is stored in WordPress. The booking page runs on Artweel, so it stays up to date on its own.', 'artweel-booking' ); ?>
		</p>
	</div>
	<?php
}
