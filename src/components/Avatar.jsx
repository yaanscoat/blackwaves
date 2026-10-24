import { useState } from "preact/hooks";
import { SHOP_BY_ID, decorationUrl, decorationStill } from "../../shared/shop.js";

function initials(name = "?") {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * decorations are drawn 1.2x the avatar size, on top of it, so ears, hats and
 * fists overlap your picture the way they do on discord. pass still to show the
 * first frame until someone hovers (chat lists, member lists).
 */
export function Avatar({ user, size = 40, online, showStatus = false, decorate = true, still = false }) {
  const [hover, setHover] = useState(false);
  const decoration = decorate && user?.decoration ? SHOP_BY_ID.get(user.decoration) : null;
  const color = user?.accent || "#5b8cff";
  const animate = !still || hover;
  return (
    <span
      class="avatar"
      style={{ "--size": `${size}px`, "--av": color }}
      onMouseEnter={still && decoration ? () => setHover(true) : undefined}
      onMouseLeave={still && decoration ? () => setHover(false) : undefined}
    >
      {user?.avatar ? (
        <img class="avatar-img" src={user.avatar} alt="" loading="lazy" draggable={false} />
      ) : (
        <span class="avatar-img avatar-fallback">{initials(user?.displayName || user?.username)}</span>
      )}
      {decoration && <img class={`avatar-decor ${decoration.front ? "front" : ""}`} src={animate ? decorationUrl(decoration) : decorationStill(decoration)} alt="" loading="lazy" draggable={false} />}
      {showStatus && <span class={`avatar-status ${online ?? user?.online ? "on" : ""}`} />}
    </span>
  );
}
