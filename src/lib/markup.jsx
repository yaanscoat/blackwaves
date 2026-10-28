// tiny chat markdown: **bold**, *italic*, __underline__, ~~strike~~, `code`,
// ```code blocks```, ||spoilers||, links and @mentions. no html ever gets through.
import { useState } from "preact/hooks";
import { openProfile } from "../components/ProfileCard.jsx";

function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <span class={`spoiler ${shown ? "shown" : ""}`} onClick={() => setShown(true)} role="button" tabIndex={0}>
      {children}
    </span>
  );
}

const INLINE_SOURCE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||`[^`]+`|\*[^*\s][^*]*\*|https?:\/\/[^\s<]+|@[a-zA-Z0-9_.-]{3,20})/.source;

function inline(text, keyBase, selfName) {
  const out = [];
  let last = 0;
  let match;
  // a fresh regex per call: sharing one global regex across the recursive
  // calls below reset lastIndex and froze the tab on the first **bold** message
  const INLINE = new RegExp(INLINE_SOURCE, "g");
  while ((match = INLINE.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${match.index}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{inline(token.slice(2, -2), key, selfName)}</strong>);
    else if (token.startsWith("__")) out.push(<u key={key}>{inline(token.slice(2, -2), key, selfName)}</u>);
    else if (token.startsWith("~~")) out.push(<s key={key}>{inline(token.slice(2, -2), key, selfName)}</s>);
    else if (token.startsWith("||")) out.push(<Spoiler key={key}>{inline(token.slice(2, -2), key, selfName)}</Spoiler>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("*")) out.push(<em key={key}>{inline(token.slice(1, -1), key, selfName)}</em>);
    else if (token.startsWith("http")) {
      const url = token.replace(/[),.!?]+$/, "");
      out.push(
        <a key={key} href={url} target="_blank" rel="noreferrer noopener">
          {url}
        </a>,
      );
      if (url.length < token.length) out.push(token.slice(url.length));
    } else if (token.startsWith("@")) {
      const name = token.slice(1);
      out.push(
        <button key={key} class={`mention ${selfName && name.toLowerCase() === selfName.toLowerCase() ? "self" : ""}`} onClick={() => openProfile(name)}>
          {token}
        </button>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMessage(content, selfName) {
  const parts = content.split(/```/);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <pre key={index} class="codeblock">
        <code>{part.replace(/^[a-z]*\n/, "")}</code>
      </pre>
    ) : (
      <span key={index}>{inline(part, String(index), selfName)}</span>
    ),
  );
}

export function mentionsMe(content, selfName) {
  return Boolean(selfName) && new RegExp(`@${selfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content);
}
