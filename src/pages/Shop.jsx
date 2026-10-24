import { useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { Modal } from "../components/Modal.jsx";
import { ProfileBody } from "../components/ProfileCard.jsx";
import { SHOP_ITEMS, ECONOMY, RARITY_ORDER } from "../../shared/shop.js";
import { me, updateProfile, claimDaily, canClaimDaily, coinPulse } from "../lib/account.js";
import { post } from "../lib/api.js";
import { toast } from "../lib/notify.js";
import { openAuth } from "../lib/ui.js";
import { confetti } from "../lib/fx/overlay.js";
import "../styles/social.css";

const GUEST = { displayName: "you", username: "you", accent: "#7aa7ff", avatar: "" };

function useShopActions() {
  const user = me.value;
  const owned = new Set(user?.owned || []);
  const buy = async (item, event) => {
    if (!user) return openAuth("register");
    try {
      const { user: updated } = await post("/api/shop/buy", { itemId: item.id });
      me.value = updated;
      coinPulse.value++;
      confetti(event?.clientX ?? innerWidth / 2, event?.clientY ?? innerHeight / 2, item.price >= 1000 ? 180 : 80);
      toast(`you bought ${item.name}`, { kind: "success", action: { label: "equip", run: () => equip(item) } });
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };
  const equip = async (item) => {
    try {
      const field = item.kind === "decoration" ? "decoration" : "title";
      const current = me.value?.[item.kind === "decoration" ? "decoration" : "titleId"];
      await updateProfile({ [field]: current === item.id ? "" : item.id });
      toast(current === item.id ? `took off ${item.name}` : `${item.name} equipped`, { kind: "success" });
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };
  return { user, owned, buy, equip };
}

function ItemAction({ item, actions, wide = false }) {
  const { user, owned, buy, equip } = actions;
  const isOwned = owned.has(item.id);
  const equipped = user && (item.kind === "decoration" ? user.decoration === item.id : user.titleId === item.id);
  if (isOwned) {
    return (
      <button class={`btn ${equipped ? "" : "primary"} sm ${wide ? "wide" : ""}`} onClick={() => equip(item)}>
        {equipped ? (
          <>
            <Icon name="check" size={14} /> Equipped
          </>
        ) : (
          "Equip"
        )}
      </button>
    );
  }
  const short = user ? item.price - user.coins : 0;
  return (
    <button class={`btn sm buy ${wide ? "wide" : ""}`} onClick={(event) => buy(item, event)} disabled={user && short > 0} data-tip={short > 0 ? `${short.toLocaleString()} more coins` : undefined}>
      <Icon name="coin" size={14} /> {item.price.toLocaleString()}
    </button>
  );
}

export function Shop() {
  const actions = useShopActions();
  const { user, owned } = actions;
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("rarity");
  const [preview, setPreview] = useState(null);

  const items = SHOP_ITEMS.filter((item) => (filter === "all" ? true : filter === "owned" ? owned.has(item.id) : item.kind === filter)).sort((a, b) =>
    sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || b.price - a.price,
  );
  const viewer = user || GUEST;

  return (
    <main class="page shop-page">
      <div class="shop-hero glass liquid">
        <div>
          <h1>Shop</h1>
          <p class="muted">Decorations go around your avatar, titles go under your name. Everyone sees them in chat and on your profile.</p>
        </div>
        <div class="shop-wallet">
          {user ? (
            <>
              <span class="wallet-amount">
                <Icon name="coin" size={26} /> {user.coins.toLocaleString()}
              </span>
              {canClaimDaily(user) ? (
                <button class="btn primary sm" onClick={() => claimDaily().catch((error) => toast(error.message, { kind: "error" }))}>
                  <Icon name="gift" size={14} /> Claim daily coins
                </button>
              ) : (
                <span class="faint small">Daily coins claimed · {user.dailyStreak} day streak</span>
              )}
            </>
          ) : (
            <button class="btn primary" onClick={() => openAuth("register")}>
              Create an account for {ECONOMY.startingCoins} free coins
            </button>
          )}
        </div>
      </div>

      <details class="earn glass">
        <summary>How do I get coins?</summary>
        <ul>
          <li>{ECONOMY.dailyBase} coins every day you claim, plus {ECONOMY.dailyStreakBonus} more for each day in a row (up to {ECONOMY.dailyStreakMax} days).</li>
          <li>{ECONOMY.perActiveMinute} coin for every minute you're actually using blackwaves, up to {ECONOMY.activeDailyCap} a day.</li>
          <li>{ECONOMY.perChatMessage} coins per chat message, up to {ECONOMY.chatDailyCap} a day. Spamming gets you rate limited, not rich.</li>
        </ul>
      </details>

      <div class="shop-filters">
        <div class="chips scroll">
          {[
            ["all", "Everything"],
            ["decoration", "Decorations"],
            ["title", "Titles"],
            ["owned", `Owned (${owned.size})`],
          ].map(([id, label]) => (
            <button key={id} class="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <select class="select shop-sort" value={sort} onChange={(event) => setSort(event.currentTarget.value)} aria-label="Sort">
          <option value="rarity">Rarest first</option>
          <option value="low">Cheapest first</option>
          <option value="high">Priciest first</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div class="empty">
          <Icon name="shop" />
          <p>You don't own anything yet. Everything above is buyable.</p>
        </div>
      ) : (
        <div class="card-grid shop-grid">
          {items.map((item, index) => (
            <div key={item.id} class={`shop-item glass r-${item.rarity}`} style={{ "--i": Math.min(index, 20) }}>
              <button class="shop-preview" onClick={() => setPreview(item)} aria-label={`Preview ${item.name}`}>
                {item.kind === "decoration" ? (
                  <Avatar user={{ ...viewer, decoration: item.id }} size={92} still />
                ) : (
                  <span class="title-preview">
                    <span>{viewer.displayName}</span>
                    <span class="profile-title" style={{ "--pacc": viewer.accent }}>
                      {item.name}
                    </span>
                  </span>
                )}
              </button>
              <div class="shop-info">
                <span class={`rarity r-${item.rarity}`}>{item.rarity}</span>
                <strong>{item.name}</strong>
                <span class="faint small">{item.kind === "decoration" ? "Avatar decoration" : "Profile title"}</span>
              </div>
              <ItemAction item={item} actions={actions} />
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} class="profile-modal" hideHead>
          <ProfileBody
            user={{
              ...viewer,
              id: viewer.id || 0,
              badges: viewer.badges || [],
              banner: viewer.banner || "#5b8cff",
              createdAt: viewer.createdAt || Date.now(),
              decoration: preview.kind === "decoration" ? preview.id : viewer.decoration,
              title: preview.kind === "title" ? preview.name : viewer.title,
            }}
            actions={
              <div class="profile-actions">
                <span class={`rarity r-${preview.rarity}`}>{preview.rarity}</span>
                <ItemAction item={preview} actions={actions} wide />
              </div>
            }
          />
        </Modal>
      )}
    </main>
  );
}
