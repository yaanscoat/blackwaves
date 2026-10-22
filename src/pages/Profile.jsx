import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { ProfileBody } from "../components/ProfileCard.jsx";
import { me, updateProfile } from "../lib/account.js";
import { get, post } from "../lib/api.js";
import { navigate, route, segments } from "../lib/router.js";
import { toast } from "../lib/notify.js";
import { openAuth } from "../lib/ui.js";
import { SHOP_BY_ID } from "../../shared/shop.js";
import "../styles/social.css";

/** squish whatever image you pick into a 256px webp so avatars stay small */
async function shrinkImage(file) {
  if (file.type === "image/gif" && file.size < 280_000) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/webp", 0.85);
}

function Editor() {
  const user = me.value;
  const [form, setForm] = useState(() => ({
    displayName: user.displayName,
    pronouns: user.pronouns,
    status: user.status,
    bio: user.bio,
    banner: user.banner,
    accent: user.accent,
  }));
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState([]);
  const set = (key) => (event) => setForm({ ...form, [key]: event.currentTarget.value });

  useEffect(() => {
    get("/api/coins/ledger").then((data) => setLedger(data.entries)).catch(() => {});
  }, [user.coins]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      toast("profile saved", { kind: "success" });
    } catch (error) {
      toast(error.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      await updateProfile({ avatar: await shrinkImage(file) });
      toast("new avatar, who dis", { kind: "success" });
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };

  const owned = (user.owned || []).map((id) => SHOP_BY_ID.get(id)).filter(Boolean);
  const decorations = owned.filter((item) => item.kind === "decoration");
  const titles = owned.filter((item) => item.kind === "title");
  const preview = { ...user, ...form };

  return (
    <div class="profile-editor">
      <form class="editor-form glass" onSubmit={save}>
        <h2>Your profile</h2>
        <div class="avatar-pick">
          <Avatar user={user} size={84} />
          <div class="btn-row">
            <label class="btn sm">
              <Icon name="upload" size={14} /> Change avatar
              <input type="file" accept="image/*" hidden onChange={pickAvatar} />
            </label>
            {user.avatar && (
              <button type="button" class="btn ghost sm" onClick={() => updateProfile({ avatar: "" })}>
                Remove
              </button>
            )}
          </div>
        </div>
        <label class="field">
          <span>Display name</span>
          <input class="input" value={form.displayName} onInput={set("displayName")} maxLength={32} required />
        </label>
        <div class="field-row">
          <label class="field">
            <span>Pronouns</span>
            <input class="input" value={form.pronouns} onInput={set("pronouns")} maxLength={24} placeholder="they/them" />
          </label>
          <label class="field">
            <span>Status</span>
            <input class="input" value={form.status} onInput={set("status")} maxLength={80} placeholder="playing retro bowl in maths" />
          </label>
        </div>
        <label class="field">
          <span>About me</span>
          <textarea class="textarea" value={form.bio} onInput={set("bio")} maxLength={300} />
        </label>
        <div class="field-row">
          <label class="field color-field">
            <span>Banner</span>
            <input type="color" value={form.banner} onInput={set("banner")} />
          </label>
          <label class="field color-field">
            <span>Name color</span>
            <input type="color" value={form.accent} onInput={set("accent")} />
          </label>
        </div>

        <h3>Decoration</h3>
        {decorations.length === 0 ? (
          <p class="muted small">
            You don't own any decorations yet. <a href="/shop" onClick={(event) => (event.preventDefault(), navigate("/shop"))}>Visit the shop</a>.
          </p>
        ) : (
          <div class="equip-grid">
            <button type="button" class="equip" aria-pressed={!user.decoration} onClick={() => updateProfile({ decoration: "" })}>
              <Avatar user={{ ...user, decoration: "" }} size={52} />
              <span class="small">None</span>
            </button>
            {decorations.map((item) => (
              <button key={item.id} type="button" class="equip" aria-pressed={user.decoration === item.id} onClick={() => updateProfile({ decoration: item.id })}>
                <Avatar user={{ ...user, decoration: item.id }} size={52} />
                <span class="small">{item.name}</span>
              </button>
            ))}
          </div>
        )}

        <h3>Title</h3>
        {titles.length === 0 ? (
          <p class="muted small">No titles yet. They're in the shop too.</p>
        ) : (
          <div class="chips">
            <button type="button" class="chip" aria-pressed={!user.titleId} onClick={() => updateProfile({ title: "" })}>
              None
            </button>
            {titles.map((item) => (
              <button key={item.id} type="button" class="chip" aria-pressed={user.titleId === item.id} onClick={() => updateProfile({ title: item.id })}>
                {item.name}
              </button>
            ))}
          </div>
        )}

        <button class="btn primary" disabled={saving}>
          {saving ? "Saving..." : "Save profile"}
        </button>
      </form>

      <div class="editor-side">
        <div class="glass preview-card">
          <ProfileBody user={preview} compact />
        </div>
        <div class="glass ledger">
          <h3>Coin history</h3>
          {ledger.length === 0 ? (
            <p class="muted small">Nothing yet.</p>
          ) : (
            <ul>
              {ledger.slice(0, 12).map((entry, index) => (
                <li key={index}>
                  <span>{entry.reason}</span>
                  <span class={entry.amount > 0 ? "plus" : "minus"}>
                    {entry.amount > 0 ? "+" : ""}
                    {entry.amount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Viewer({ name }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    get(`/api/users/${encodeURIComponent(name)}`)
      .then((data) => setUser(data.user))
      .catch((err) => setError(err.message));
  }, [name]);
  if (error) {
    return (
      <div class="empty">
        <Icon name="user" />
        <p>{error}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div class="empty">
        <div class="spinner" />
      </div>
    );
  }
  const self = me.value?.id === user.id;
  return (
    <div class="profile-page glass">
      <ProfileBody
        user={user}
        actions={
          <div class="profile-actions">
            {self ? (
              <button class="btn primary" onClick={() => navigate("/profile")}>
                <Icon name="edit" size={16} /> Edit profile
              </button>
            ) : (
              <button
                class="btn primary"
                onClick={async () => {
                  if (!me.value) return openAuth("login");
                  try {
                    const { channel } = await post("/api/chat/dms", { userId: user.id });
                    navigate(`/chat/${channel}`);
                  } catch (err) {
                    toast(err.message, { kind: "error" });
                  }
                }}
              >
                <Icon name="chat" size={16} /> Message
              </button>
            )}
          </div>
        }
      />
    </div>
  );
}

export function Profile() {
  const [first, name] = segments(route.value);
  const user = me.value;
  if (first === "u" && name) {
    return (
      <main class="page">
        <Viewer name={name} />
      </main>
    );
  }
  return (
    <main class="page">
      {user ? (
        <Editor key={user.id} />
      ) : (
        <div class="empty">
          <Icon name="user" />
          <h3>Make yourself a profile</h3>
          <p>Sign in to CloudSync to get a profile, chat and shop.</p>
          <button class="btn primary" onClick={() => openAuth("register")}>
            Create account
          </button>
        </div>
      )}
    </main>
  );
}
