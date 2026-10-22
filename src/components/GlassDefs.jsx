// the svg filter that gives glass its wobble. a soft noise field displaces the
// backdrop by a few pixels, which reads as light bending through thick glass.
export function GlassDefs() {
  return (
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <filter id="bw-liquid" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="38" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
