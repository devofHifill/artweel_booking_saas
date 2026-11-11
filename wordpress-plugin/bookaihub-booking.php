<?php
/**
 * Plugin Name:       BookAIHub Booking
 * Plugin URI:        https://bookaihub.com
 * Description:       Embed your pottery studio's booking page on any WordPress page with a shortcode or block.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       bookaihub-booking
 *
 * ---------------------------------------------------------------------------
 * This plugin contains NO booking logic, and that is the whole design.
 *
 * Everything — availability, seats, payment, cancellation — happens on the
 * BookAIHub side, inside an iframe. A WordPress plugin that reimplemented any of
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

define( 'BOOKAIHUB_VERSION', '1.0.0' );
define( 'BOOKAIHUB_DEFAULT_ORIGIN', 'https://bookaihub.com' );

/**
 * Where the widget is loaded from.
 *
 * Overridable so a studio on a custom domain, or anyone running this against a
 * staging instance, does not need a forked plugin.
 */
function bookaihub_origin() {
	$origin = get_option( 'bookaihub_origin', BOOKAIHUB_DEFAULT_ORIGIN );
	$origin = untrailingslashit( trim( $origin ) );

	// Refuse anything that is not a plain http(s) origin. A javascript: or
	// data: URL here would become a script tag on every page of the site.
	if ( ! preg_match( '#^https?://[A-Za-z0-9.\-]+(:\d+)?$#', $origin ) ) {
		return BOOKAIHUB_DEFAULT_ORIGIN;
	}

	return $origin;
}

/**
 * Registers the loader script.
 *
 * Not enqueued globally — only on pages that actually contain the shortcode or
 * block, so a site with one booking page does not ship this on every post.
 */
function bookaihub_register_assets() {
	wp_register_script(
		'bookaihub-embed',
		bookaihub_origin() . '/embed.js',
		array(),
		BOOKAIHUB_VERSION,
		true
	);
}
add_action( 'init', 'bookaihub_register_assets' );

/**
 * Renders the embed.
 *
 * @param array $atts Shortcode or block attributes.
 * @return string HTML.
 */
function bookaihub_render( $atts = array() ) {
	$atts = shortcode_atts(
		array(
			'slug'   => get_option( 'bookaihub_slug', '' ),
			'height' => '900',
		),
		$atts,
		'bookaihub'
	);

	$slug = sanitize_title( $atts['slug'] );

	if ( empty( $slug ) ) {
		// Visible to an editor, silent for a visitor. A studio that has not
		// set their slug should be told; their customers should not see it.
		if ( current_user_can( 'edit_posts' ) ) {
			return '<p><strong>' .
				esc_html__( 'BookAIHub: set your studio address in Settings → BookAIHub Booking, or pass slug="your-studio".', 'bookaihub-booking' ) .
				'</strong></p>';
		}
		return '';
	}

	wp_enqueue_script( 'bookaihub-embed' );

	$height = absint( $atts['height'] );
	if ( $height < 200 || $height > 5000 ) {
		$height = 900;
	}

	return sprintf(
		'<div class="bookaihub-booking" data-studio="%s" data-height="%d"></div>',
		esc_attr( $slug ),
		$height
	);
}
add_shortcode( 'bookaihub', 'bookaihub_render' );

/**
 * The same thing as a block, so the editor is not a hostile place.
 *
 * Registered server-side and rendered by the same function, so the block and
 * the shortcode cannot drift apart.
 *
 * The `editor_script` is not optional decoration. Server-side registration
 * alone gives a block that RENDERS but cannot be INSERTED — the inserter is
 * built entirely from client-side registration, so without `block.js` the
 * block is invisible to the person trying to add it.
 */
function bookaihub_register_block() {
	if ( ! function_exists( 'register_block_type' ) ) {
		return;
	}

	wp_register_script(
		'bookaihub-block',
		plugins_url( 'block.js', __FILE__ ),
		array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
		BOOKAIHUB_VERSION,
		true
	);

	register_block_type(
		'bookaihub/booking',
		array(
			'api_version'     => 2,
			'title'           => __( 'BookAIHub Booking', 'bookaihub-booking' ),
			'category'        => 'embed',
			'icon'            => 'calendar-alt',
			'description'     => __( "Your studio's booking page, embedded.", 'bookaihub-booking' ),
			'editor_script'   => 'bookaihub-block',
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
			'render_callback' => 'bookaihub_render',
		)
	);
}
add_action( 'init', 'bookaihub_register_block' );

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function bookaihub_settings_menu() {
	add_options_page(
		__( 'BookAIHub Booking', 'bookaihub-booking' ),
		__( 'BookAIHub Booking', 'bookaihub-booking' ),
		'manage_options',
		'bookaihub-booking',
		'bookaihub_settings_page'
	);
}
add_action( 'admin_menu', 'bookaihub_settings_menu' );

function bookaihub_register_settings() {
	register_setting(
		'bookaihub_booking',
		'bookaihub_slug',
		array( 'sanitize_callback' => 'sanitize_title' )
	);
	register_setting(
		'bookaihub_booking',
		'bookaihub_origin',
		array( 'sanitize_callback' => 'esc_url_raw' )
	);
}
add_action( 'admin_init', 'bookaihub_register_settings' );

function bookaihub_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$slug = get_option( 'bookaihub_slug', '' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'BookAIHub Booking', 'bookaihub-booking' ); ?></h1>

		<form action="options.php" method="post">
			<?php settings_fields( 'bookaihub_booking' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">
						<label for="bookaihub_slug"><?php esc_html_e( 'Studio address', 'bookaihub-booking' ); ?></label>
					</th>
					<td>
						<input name="bookaihub_slug" id="bookaihub_slug" type="text"
							value="<?php echo esc_attr( $slug ); ?>" class="regular-text" />
						<p class="description">
							<?php
							printf(
								/* translators: %s: example booking page URL */
								esc_html__( 'The last part of your booking page address. If it is %s, enter clay-and-co.', 'bookaihub-booking' ),
								'<code>' . esc_html( bookaihub_origin() ) . '/public/clay-and-co</code>'
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">
						<label for="bookaihub_origin"><?php esc_html_e( 'BookAIHub address', 'bookaihub-booking' ); ?></label>
					</th>
					<td>
						<input name="bookaihub_origin" id="bookaihub_origin" type="url"
							value="<?php echo esc_attr( get_option( 'bookaihub_origin', BOOKAIHUB_DEFAULT_ORIGIN ) ); ?>"
							class="regular-text" />
						<p class="description">
							<?php esc_html_e( 'Leave this alone unless you were told otherwise.', 'bookaihub-booking' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<?php submit_button(); ?>
		</form>

		<h2><?php esc_html_e( 'Putting it on a page', 'bookaihub-booking' ); ?></h2>
		<p><?php esc_html_e( 'Add the BookAIHub Booking block, or paste this shortcode:', 'bookaihub-booking' ); ?></p>
		<p><code>[bookaihub<?php echo $slug ? ' slug="' . esc_html( $slug ) . '"' : ''; ?>]</code></p>
		<p class="description">
			<?php esc_html_e( 'Nothing about your bookings is stored in WordPress. The booking page runs on BookAIHub, so it stays up to date on its own.', 'bookaihub-booking' ); ?>
		</p>
	</div>
	<?php
}
