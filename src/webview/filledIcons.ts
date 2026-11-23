/**
 * Filled icons for the buttons of the view, as SVG markup on a 16px grid like the codicons.
 * The codicon font holds no filled trash or sliders.
 * Each icon paints in `currentColor` and takes the color of its button.
 */

function svg(paths: string): string {
    return `<svg class="filled-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd" aria-hidden="true">${paths}</svg>`
}

/** A trash can with two slits cut out of its body. */
export const TRASH_ICON = svg(
    `<path d="M6 1h4a1 1 0 0 1 1 1v1h3a.75.75 0 0 1 0 1.5H2A.75.75 0 0 1 2 3h3V2a1 1 0 0 1 1-1z"/>` +
        `<path d="M3.25 5.5h9.5l-.75 8.6A1 1 0 0 1 11 15H5a1 1 0 0 1-1-.9zM6.25 7.5v5.5h1V7.5zM8.75 7.5v5.5h1V7.5z"/>`
)

/** Three sliders, for the search details. */
export const SLIDERS_ICON = svg(
    `<rect x="1" y="3.25" width="14" height="1.5" rx=".75"/>` +
        `<rect x="1" y="7.25" width="14" height="1.5" rx=".75"/>` +
        `<rect x="1" y="11.25" width="14" height="1.5" rx=".75"/>` +
        `<circle cx="10.5" cy="4" r="2"/><circle cx="5" cy="8" r="2"/><circle cx="11" cy="12" r="2"/>`
)
