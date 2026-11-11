/**
 * Client-side registration for the BookAIHub Booking block.
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

	blocks.registerBlockType('bookaihub/booking', {
		apiVersion: 2,
		title: __('BookAIHub Booking', 'bookaihub-booking'),
		category: 'embed',
		icon: 'calendar-alt',
		description: __("Your studio's booking page, embedded.", 'bookaihub-booking'),
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
						{ title: __('Booking page', 'bookaihub-booking') },
						el(components.TextControl, {
							label: __('Studio address', 'bookaihub-booking'),
							help: __(
								'Leave empty to use the studio set in Settings → BookAIHub Booking.',
								'bookaihub-booking'
							),
							value: slug,
							onChange: function (value) {
								props.setAttributes({ slug: value });
							},
						}),
						el(components.RangeControl, {
							label: __('Height', 'bookaihub-booking'),
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
						label: __('BookAIHub Booking', 'bookaihub-booking'),
						instructions: slug
							? __('Your booking page appears here when the page is published.', 'bookaihub-booking')
							: __(
									'Using the studio set in Settings → BookAIHub Booking. Set a studio address on the right to override it.',
									'bookaihub-booking'
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
