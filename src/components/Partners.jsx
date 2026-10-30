// partner logos (assets/partners, listed in data/changelog.js). the pngs are
// big squares with the logo somewhere inside, so each card shows just the
// `crop` box [left, top, right, bottom] (in image pixels) and takes its shape.
import { PARTNERS } from "../data/changelog.js";

function Logo({ partner }) {
  const [size, height] = [partner.size[0], partner.size[1]];
  const [left, top, right, bottom] = partner.crop || [0, 0, size, height];
  const width = right - left;
  const tall = bottom - top;
  return (
    <img
      src={partner.image}
      alt={partner.name}
      loading="lazy"
      draggable={false}
      style={{ width: `${(size / width) * 100}%`, left: `${(-left / width) * 100}%`, top: `${(-top / tall) * 100}%` }}
    />
  );
}

export function Partners() {
  if (!PARTNERS.length) return null;
  return (
    <div class="partners">
      {PARTNERS.map((partner) => {
        const [left, top, right, bottom] = partner.crop || [0, 0, ...partner.size];
        const style = { background: partner.background, aspectRatio: `${right - left} / ${bottom - top}` };
        return partner.url ? (
          <a key={partner.name} class="partner" href={partner.url} target="_blank" rel="noopener" title={partner.name} style={style}>
            <Logo partner={partner} />
          </a>
        ) : (
          <span key={partner.name} class="partner" title={partner.name} style={style}>
            <Logo partner={partner} />
          </span>
        );
      })}
    </div>
  );
}
