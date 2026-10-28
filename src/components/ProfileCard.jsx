import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Avatar } from "./Avatar.jsx";
import { Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { get, post } from "../lib/api.js";
import { me } from "../lib/account.js";
import { onlineUsers } from "../lib/realtime.js";
import { navigate } from "../lib/router.js";
import { toast } from "../lib/notify.js";

export const profileTarget = signal(null);

export function openProfile(username) {
  profileTarget.value = username;
}

const BADGES = {
  developer: { label: "blackwaves developer", icon: "zap" },
  premium: { label: "blackwaves Premium", icon: "crown" },
  early: { label: "early wave (one of the first 100)", icon: "wave" },
  "pink-ears": { label: "owns the pink cat ears", icon: "crown" },
  collector: { label: "collector: 10+ shop items", icon: "gift" },
};

export function Badges({ badges = [] }) {
  if (!badges.length) return null;
  return (
    <span class="badges">
      {badges.map((badge) => (
        <span key={badge} class={`profile-badge b-${badge}`} data-tip={BADGES[badge]?.label || badge}>
          <Icon name={BADGES[badge]?.icon || "star"} size={14} />
        </span>
      ))}
    </span>
  );
}

export function ProfileBody({ user, compact = false, actions = null }) {
  const online = onlineUsers.value.has(user.id) || user.online;
  const since = new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <div class={`profile-card ${compact ? "compact" : ""}`} style={{ "--banner": user.banner, "--pacc": user.accent }}>
      <div class="profile-banner" />
      <div class="profile-avatar-row">
        <Avatar user={user} size={compact ? 76 : 96} showStatus online={online} />
        <Badges badges={user.badges} />
      </div>
      <div class="profile-main">
        <div class="profile-names">
          <h2>{user.displayName}</h2>
          <span class="muted">@{user.username}{user.pronouns ? ` · ${user.pronouns}` : ""}</span>
        </div>
        {user.title && <span class="profile-title">{user.title}</span>}
        {user.status && <p class="profile-status">{user.status}</p>}
        {user.bio && (
          <div class="profile-section">
            <h4>About me</h4>
            <p>{user.bio}</p>
          </div>
        )}
        <div class="profile-section">
          <h4>Member since</h4>
          <p class="muted">{since}</p>
        </div>
        {actions}
      </div>
    </div>
  );
}

export function ProfileCardHost() {
  const username = profileTarget.value;
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!username) return;
    setUser(null);
    setError("");
    get(`/api/users/${encodeURIComponent(username)}`)
      .then((data) => setUser(data.user))
      .catch((err) => setError(err.message));
  }, [username]);

  if (!username) return null;
  const close = () => (profileTarget.value = null);
  const self = me.value && user && me.value.id === user.id;

  const message = async () => {
    if (!me.value) return toast("sign in to cloudsync to send messages", { kind: "error" });
    try {
      const { channel } = await post("/api/chat/dms", { userId: user.id });
      close();
      navigate(`/chat/${channel}`);
    } catch (err) {
      toast(err.message, { kind: "error" });
    }
  };

  return (
    <Modal title={user ? user.displayName : "profile"} onClose={close} class="profile-modal" hideHead>
      {(closeModal) =>
        error ? (
          <div class="empty">
            <Icon name="user" />
            <p>{error}</p>
          </div>
        ) : !user ? (
          <div class="empty">
            <div class="spinner" />
          </div>
        ) : (
          <ProfileBody
            user={user}
            actions={
              <div class="profile-actions">
                {self ? (
                  <button class="btn primary" onClick={() => (closeModal(), navigate("/profile"))}>
                    <Icon name="edit" size={16} /> Edit profile
                  </button>
                ) : (
                  <button class="btn primary" onClick={message}>
                    <Icon name="chat" size={16} /> Message
                  </button>
                )}
                <button class="btn" onClick={() => (closeModal(), navigate(`/u/${user.username}`))}>
                  View full profile
                </button>
              </div>
            }
          />
        )
      }
    </Modal>
  );
}
