// the chat. discord, but it fits in a school laptop's tab bar and nobody asks
// you to verify your phone number. state is a pile of useStates that grew
// one feature at a time; it's held together by the realtime socket and hope.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { openProfile } from "../components/ProfileCard.jsx";
import { get, post, patch, del } from "../lib/api.js";
import { me } from "../lib/account.js";
import { on, send, onlineUsers } from "../lib/realtime.js";
import { navigate, route, segments } from "../lib/router.js";
import { toast } from "../lib/notify.js";
import { openAuth } from "../lib/ui.js";
import { renderMessage, mentionsMe } from "../lib/markup.jsx";
import { CHANNELS, REACTIONS, MESSAGE_MAX } from "../../shared/chat.js";
import "../styles/social.css";

const GROUP_GAP = 5 * 60 * 1000;

function time(at) {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Message({ message, grouped, self, onReply, onEdit }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const user = me.value;
  const mine = user && message.author.id === user.id;
  const pinged = !mine && mentionsMe(message.content, user?.username);

  const react = async (emoji) => {
    setPicker(false);
    if (!user) return openAuth("login");
    try {
      await post(`/api/chat/messages/${message.id}/react`, { emoji });
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };

  const saveEdit = async () => {
    setEditing(false);
    if (draft.trim() === message.content) return;
    try {
      await onEdit(message.id, draft.trim());
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };

  return (
    <div class={`msg ${grouped ? "grouped" : ""} ${pinged ? "pinged" : ""}`} id={`m-${message.id}`}>
      {message.reply && (
        <button class="msg-reply-ref" onClick={() => document.getElementById(`m-${message.reply.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          <Icon name="reply" size={12} />
          <strong>{message.reply.author}</strong>
          <span class="muted">{message.reply.content}</span>
        </button>
      )}
      <div class="msg-row">
        {grouped && !message.reply ? (
          <span class="msg-gutter faint">{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        ) : (
          <button class="msg-avatar" onClick={() => openProfile(message.author.username)} aria-label={`${message.author.displayName}'s profile`}>
            <Avatar user={message.author} size={40} still />
          </button>
        )}
        <div class="msg-body">
          {(!grouped || message.reply) && (
            <div class="msg-head">
              <button class="msg-name" style={{ color: message.author.accent }} onClick={() => openProfile(message.author.username)}>
                {message.author.displayName}
              </button>
              {message.author.title && <span class="msg-title">{message.author.title}</span>}
              {message.author.badges?.includes("developer") && <span class="msg-dev">dev</span>}
              <span class="faint small">{time(message.createdAt)}</span>
            </div>
          )}
          {editing ? (
            <div class="msg-edit">
              <textarea
                class="textarea"
                value={draft}
                maxLength={MESSAGE_MAX}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    saveEdit();
                  }
                  if (event.key === "Escape") setEditing(false);
                }}
                ref={(el) => el?.focus()}
              />
              <span class="faint small">enter to save · esc to cancel</span>
            </div>
          ) : (
            <div class="msg-content">
              {renderMessage(message.content, user?.username)}
              {message.editedAt && <span class="faint small"> (edited)</span>}
            </div>
          )}
          {message.reactions.length > 0 && (
            <div class="reactions">
              {message.reactions.map((reaction) => (
                <button key={reaction.emoji} class={`reaction ${reaction.me ? "mine" : ""}`} onClick={() => react(reaction.emoji)}>
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div class="msg-actions glass">
          <button aria-label="Add reaction" data-tip="React" onClick={() => setPicker(!picker)}>
            <Icon name="smile" size={16} />
          </button>
          <button aria-label="Reply" data-tip="Reply" onClick={() => (user ? onReply(message) : openAuth("login"))}>
            <Icon name="reply" size={16} />
          </button>
          {mine && (
            <button aria-label="Edit" data-tip="Edit" onClick={() => (setDraft(message.content), setEditing(true))}>
              <Icon name="edit" size={16} />
            </button>
          )}
          {(mine || user?.admin) && (
            <button
              aria-label="Delete"
              data-tip="Delete"
              class="danger"
              onClick={async () => {
                if (!confirm("Delete this message?")) return;
                try {
                  await del(`/api/chat/messages/${message.id}`);
                } catch (error) {
                  toast(error.message, { kind: "error" });
                }
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
          {picker && (
            <div class="emoji-picker glass">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => react(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ channel, readOnly, replyTo, onCancelReply, label }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const lastTyping = useRef(0);
  const user = me.value;

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  if (!user) {
    return (
      <div class="composer locked">
        <span class="muted">Sign in to chat, earn coins and DM people.</span>
        <button class="btn primary sm" onClick={() => openAuth("login")}>
          Sign in
        </button>
      </div>
    );
  }
  if (readOnly && !user.admin) {
    return (
      <div class="composer locked">
        <Icon name="lock" size={16} />
        <span class="muted">Only the devs can post here.</span>
      </div>
    );
  }

  const submit = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await post("/api/chat/messages", { channel, content, replyTo: replyTo?.id });
      setText("");
      onCancelReply();
    } catch (error) {
      toast(error.message, { kind: "error" });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <div class="composer-wrap">
      {replyTo && (
        <div class="replying">
          <span class="muted small">
            Replying to <strong>{replyTo.author.displayName}</strong>
          </span>
          <button class="btn ghost sm icon-only" aria-label="Cancel reply" onClick={onCancelReply}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div class="composer glass">
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          placeholder={`Message ${label}`}
          aria-label={`Message ${label}`}
          onInput={(event) => {
            setText(event.currentTarget.value);
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(200, event.currentTarget.scrollHeight)}px`;
            if (Date.now() - lastTyping.current > 2500) {
              lastTyping.current = Date.now();
              send({ t: "typing", channel });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") onCancelReply();
          }}
        />
        {text.length > MESSAGE_MAX - 200 && <span class="faint small">{MESSAGE_MAX - text.length}</span>}
        <button class="btn primary icon-only sm" aria-label="Send" onClick={submit} disabled={!text.trim() || busy}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Chat() {
  const [, rawChannel] = segments(route.value);
  const channel = rawChannel || "general";
  const isDm = channel.startsWith("dm:");
  const meta = CHANNELS.find((entry) => entry.id === channel);
  const user = me.value;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [dms, setDms] = useState([]);
  const [members, setMembers] = useState([]);
  const [showMembers, setShowMembers] = useState(() => window.innerWidth > 1100);
  const [showSidebar, setShowSidebar] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [typing, setTyping] = useState({});
  const scroller = useRef(null);
  const stick = useRef(true);
  const [dmUser, setDmUser] = useState(null);

  const loadDms = () => user && get("/api/chat/dms").then((data) => setDms(data.dms)).catch(() => {});
  const loadMembers = () => get("/api/chat/members").then((data) => setMembers(data.members)).catch(() => {});

  useEffect(() => {
    loadDms();
    loadMembers();
    const timer = setInterval(loadMembers, 60_000);
    return () => clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (isDm && !user) {
      navigate("/chat/general", { replace: true });
      return;
    }
    setLoading(true);
    setError("");
    setMessages([]);
    setReplyTo(null);
    setHasMore(true);
    stick.current = true;
    get(`/api/chat/messages?channel=${encodeURIComponent(channel)}`)
      .then((data) => {
        setMessages(data.messages);
        setHasMore(data.messages.length >= 50);
        const last = data.messages[data.messages.length - 1];
        if (isDm && last) post("/api/chat/read", { channel, id: last.id }).then(loadDms).catch(() => {});
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    if (isDm) {
      const otherId = channel.split(":").slice(1).map(Number).find((id) => id !== user?.id) ?? user?.id;
      get(`/api/users/${otherId}`).then((data) => setDmUser(data.user)).catch(() => setDmUser(null));
    } else setDmUser(null);
  }, [channel, user?.id]);

  // realtime: new, edited, deleted messages, reactions and typing
  useEffect(() => {
    const offs = [
      on("message", ({ message }) => {
        if (message.channel === channel) {
          setMessages((list) => (list.some((entry) => entry.id === message.id) ? list : [...list, message]));
          setTyping((current) => {
            const next = { ...current };
            delete next[message.author.id];
            return next;
          });
          if (isDm && message.author.id !== user?.id) post("/api/chat/read", { channel, id: message.id }).catch(() => {});
        }
        if (message.channel.startsWith("dm:")) loadDms();
      }),
      on("edit", ({ message }) => message.channel === channel && setMessages((list) => list.map((entry) => (entry.id === message.id ? { ...message, reactions: entry.reactions } : entry)))),
      on("delete", (data) => data.channel === channel && setMessages((list) => list.filter((entry) => entry.id !== data.id))),
      on("react", (data) => {
        if (data.channel !== channel) return;
        setMessages((list) =>
          list.map((entry) => {
            if (entry.id !== data.id) return entry;
            const mineBefore = new Set(entry.reactions.filter((reaction) => reaction.me).map((reaction) => reaction.emoji));
            if (data.userId === user?.id) {
              if (data.added) mineBefore.add(data.emoji);
              else mineBefore.delete(data.emoji);
            }
            return { ...entry, reactions: data.reactions.map((reaction) => ({ ...reaction, me: mineBefore.has(reaction.emoji) })) };
          }),
        );
      }),
      on("typing", (data) => {
        if (data.channel !== channel || data.userId === user?.id) return;
        setTyping((current) => ({ ...current, [data.userId]: { name: data.name, at: Date.now() } }));
      }),
    ];
    const sweep = setInterval(() => {
      setTyping((current) => {
        const fresh = Object.fromEntries(Object.entries(current).filter(([, entry]) => Date.now() - entry.at < 5000));
        return Object.keys(fresh).length === Object.keys(current).length ? current : fresh;
      });
    }, 1500);
    return () => {
      offs.forEach((off) => off());
      clearInterval(sweep);
    };
  }, [channel, user?.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const el = scroller.current;
    if (!messages.length || !hasMore) return;
    const before = el.scrollHeight;
    const data = await get(`/api/chat/messages?channel=${encodeURIComponent(channel)}&before=${messages[0].id}`);
    setHasMore(data.messages.length >= 50);
    setMessages((list) => [...data.messages, ...list]);
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - before));
  };

  const onScroll = (event) => {
    const el = event.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && !loading) void loadOlder();
  };

  const editMessage = (id, content) => patch(`/api/chat/messages/${id}`, { content });

  const grouped = useMemo(
    () =>
      messages.map((message, index) => {
        const prev = messages[index - 1];
        return Boolean(prev && prev.author.id === message.author.id && message.createdAt - prev.createdAt < GROUP_GAP);
      }),
    [messages],
  );

  const online = members.filter((member) => onlineUsers.value.has(member.id));
  const offline = members.filter((member) => !onlineUsers.value.has(member.id));
  const typers = Object.values(typing).map((entry) => entry.name);
  const label = isDm ? `@${dmUser?.displayName || "..."}` : `#${meta?.name || channel}`;

  const go = (target) => {
    setShowSidebar(false);
    navigate(`/chat/${target}`);
  };

  return (
    <main class="chat-page">
      <div class={`chat glass ${showMembers ? "with-members" : ""} ${showSidebar ? "sidebar-open" : ""}`}>
        <aside class="chat-sidebar">
          <div class="chat-server">
            <img class="logo-img" src="/favicon.ico" alt="" />
            <strong>blackwaves</strong>
          </div>
          <nav class="chat-channels" aria-label="Channels">
            <span class="chat-group">Channels</span>
            {CHANNELS.map((entry) => (
              <button key={entry.id} class={`channel ${channel === entry.id ? "active" : ""}`} onClick={() => go(entry.id)}>
                <Icon name={entry.readOnly ? "bell" : "hash"} size={17} />
                <span>{entry.name}</span>
              </button>
            ))}
            {user && (
              <>
                <span class="chat-group">Direct messages</span>
                {dms.length === 0 && <span class="faint small chat-hint">Click anyone's name to message them.</span>}
                {dms.map((dm) => (
                  <button key={dm.channel} class={`channel dm ${channel === dm.channel ? "active" : ""}`} onClick={() => go(dm.channel)}>
                    <Avatar user={dm.user} size={28} showStatus online={onlineUsers.value.has(dm.user.id)} still />
                    <span class="dm-text">
                      <span>{dm.user.displayName}</span>
                      {dm.last && <span class="faint small">{dm.last.mine ? "you: " : ""}{dm.last.content}</span>}
                    </span>
                    {dm.unread > 0 && <span class="unread">{dm.unread}</span>}
                  </button>
                ))}
              </>
            )}
          </nav>
          {user && (
            <button class="chat-self" onClick={() => openProfile(user.username)}>
              <Avatar user={user} size={34} showStatus online />
              <span>
                <strong>{user.displayName}</strong>
                <span class="faint small">@{user.username}</span>
              </span>
            </button>
          )}
        </aside>

        <section class="chat-main">
          <header class="chat-head">
            <button class="btn ghost icon-only sm chat-burger" aria-label="Channels" onClick={() => setShowSidebar(!showSidebar)}>
              <Icon name="menu" size={18} />
            </button>
            {isDm ? (
              <>
                {dmUser && <Avatar user={dmUser} size={26} showStatus online={onlineUsers.value.has(dmUser.id)} />}
                <strong>{dmUser?.displayName || "Direct message"}</strong>
              </>
            ) : (
              <>
                <Icon name="hash" size={20} />
                <strong>{meta?.name || channel}</strong>
                <span class="chat-topic muted small">{meta?.topic}</span>
              </>
            )}
            <button class="btn ghost icon-only sm chat-members-toggle" aria-label="Member list" data-tip="Members" aria-pressed={showMembers} onClick={() => setShowMembers(!showMembers)}>
              <Icon name="users" size={18} />
            </button>
          </header>

          <div class="chat-scroll" ref={scroller} onScroll={onScroll}>
            {!hasMore && !loading && (
              <div class="chat-start">
                <div class="chat-start-icon">{isDm ? <Icon name="at" size={28} /> : <Icon name="hash" size={28} />}</div>
                <h2>{isDm ? dmUser?.displayName : `Welcome to #${meta?.name || channel}`}</h2>
                <p class="muted">{isDm ? "This is the beginning of your conversation." : meta?.topic}</p>
              </div>
            )}
            {loading ? (
              <div class="empty">
                <div class="spinner" />
              </div>
            ) : error ? (
              <div class="empty">
                <p>{error}</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <Message key={message.id} message={message} grouped={grouped[index]} onReply={setReplyTo} onEdit={editMessage} />
              ))
            )}
          </div>
          <div class="typing faint small" aria-live="polite">
            {typers.length > 0 && (
              <>
                <span class="typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {typers.length > 2 ? "Several people are typing..." : `${typers.join(" and ")} ${typers.length > 1 ? "are" : "is"} typing...`}
              </>
            )}
          </div>
          <Composer channel={channel} readOnly={meta?.readOnly} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} label={label} />
        </section>

        {showMembers && (
          <aside class="chat-members" aria-label="Members">
            <span class="chat-group">Online · {online.length}</span>
            {online.map((member) => (
              <button key={member.id} class="member" onClick={() => openProfile(member.username)}>
                <Avatar user={member} size={32} showStatus online still />
                <span class="member-text">
                  <span style={{ color: member.accent }}>{member.displayName}</span>
                  {member.status && <span class="faint small">{member.status}</span>}
                </span>
              </button>
            ))}
            <span class="chat-group">Offline · {offline.length}</span>
            {offline.map((member) => (
              <button key={member.id} class="member offline" onClick={() => openProfile(member.username)}>
                <Avatar user={member} size={32} showStatus online={false} still />
                <span class="member-text">
                  <span>{member.displayName}</span>
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>
    </main>
  );
}
