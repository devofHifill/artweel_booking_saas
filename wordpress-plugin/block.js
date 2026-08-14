/**
 * Client-side registration for the Artweel Booking block.
 *
 * Registering a block server-side with `render_callback` makes it RENDER, but
 * not appear — the inserter is driven entirely by client-side registration, so
 * without this file the block existed and no one could add it.
 *
 * Deliberately plain ES5 with `createElement` rather than JSX: the plugin has
 * no build step and should not grow one to place a div. WordPress ships all of
 * these globals to the editor already.
 */
(function (blocks, element, blockEditor, components, i18n) {
	'use strict';

	var el = element.createElement;
	var __ = i18n.__;

	blocks.registerBlockType('artweel/booking', {
		apiVersion: 2,
		title: __('Artweel Booking', 'artweel-booking'),
		category: 'embed',
		icon: 'calendar-alt',
		description: __("Your studio's booking page, embedded.", 'artweel-booking'),
		attributes: {
			slug: { type: 'string', default: '' },
			height: { type: 'number', default: 900 },
		},

		edit: function (props) {
			var slug = props.attributes.slug;
			var height = props.attributes.height;

			/**
			 * The editor shows a placeholder rather than the real booking page.
			 * Loading the live iframe here would let an editor take a booking
			 * by accident while writing the page.
			 */
			return el(
				'div',
				blockEditor.useBlockProps(),
				el(
					blockEditor.InspectorControls,
					null,
					el(
						components.PanelBody,
						{ title: __('Booking page', 'artweel-booking') },
						el(components.TextControl, {
							label: __('Studio address', 'artweel-booking'),
							help: __(
								'Leave empty to use the studio set in Settings → Artweel Booking.',
								'artweel-booking'
							),
							value: slug,
							onChange: function (value) {
								props.setAttributes({ slug: value });
							},
						}),
						el(components.RangeControl, {
							label: __('Height', 'artweel-booking'),
							value: height,
							min: 200,
							max: 5000,
							step: 50,
							onChange: function (value) {
								props.setAttributes({ height: value });
							},
						})
					)
				),
				el(
					components.Placeholder,
					{
						icon: 'calendar-alt',
						label: __('Artweel Booking', 'artweel-booking'),
						instructions: slug
							? __('Your booking page appears here when the page is published.', 'artweel-booking')
							: __(
									'Using the studio set in Settings → Artweel Booking. Set a studio address on the right to override it.',
									'artweel-booking'
							  ),
					},
					slug ? el('code', null, slug) : null
				)
			);
		},

		/** Server-rendered, so nothing is saved into the post but the tag. */
		save: function () {
			return null;
		},
	});
})(
	window.wp.blocks,
	window.wp.element,
	window.wp.blockEditor,
	window.wp.components,
	window.wp.i18n
);
