// font awesome free glyphs (see scripts/build-icons.js). every icon sits in a
// square box with a little breathing room, because font awesome draws to the
// very edge of its canvas. wide glyphs like the gamepad keep their height
// as long as they fit, so they don't shrink next to the square ones.
import { GLYPHS } from "./glyphs.js";

const ROOM = 1.18;
const WIDE_ROOM = 1.04;

export function Icon({ name, size = 20, class: className = "", fill = false, title }) {
  const [width, height, path, solid] = GLYPHS[name] || GLYPHS.info;
  const box = Math.max(height * ROOM, width * WIDE_ROOM);
  const viewBox = `${((width - box) / 2).toFixed(1)} ${((height - box) / 2).toFixed(1)} ${box.toFixed(1)} ${box.toFixed(1)}`;
  return (
    <svg
      class={`icon ${className}`}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={fill && solid ? solid : path} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(GLYPHS);
