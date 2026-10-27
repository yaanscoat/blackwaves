// markdown for ai replies: headings, lists, quotes, tables, code blocks with a
// copy button, and the usual inline bits. builds elements directly, so nothing
// a model writes can ever become real html on the page.
import { useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { openInBrowser } from "./browser.js";

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div class="md-code">
      <div class="md-code-head">
        <span>{lang || "code"}</span>
        <button onClick={copy} aria-label="Copy code">
          <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\s\n][^*\n]*\*|_[^_\s\n][^_\n]*_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<)]+)/g;

function Link({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        // links open in the blackwaves browser, through the proxy, like everything else
        event.preventDefault();
        openInBrowser(href);
      }}
    >
      {children}
    </a>
  );
}

function inline(text, key = "i") {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(INLINE.source, "g"))) {
    const token = match[0];
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${at}`;
    if (token.startsWith("`")) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else if (token.startsWith("~~")) out.push(<s key={k}>{inline(token.slice(2, -2), k)}</s>);
    else if (token.startsWith("*") || token.startsWith("_")) out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      out.push(
        <Link key={k} href={href}>
          {inline(label, k)}
        </Link>,
      );
    } else {
      const href = token.replace(/[.,!?;:]+$/, "");
      out.push(
        <Link key={k} href={href}>
          {href}
        </Link>,
      );
      if (href.length < token.length) out.push(token.slice(href.length));
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

export function Markdown({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    const fence = /^\s*```\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<CodeBlock key={key} lang={fence[1]} code={code.join("\n")} />);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 2, 6)}`;
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} class="md-table">
          <table>
            <thead>
              <tr>{head.map((cell, c) => <th key={c}>{inline(cell, `${key}h${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{head.map((_, c) => <td key={c}>{inline(row[c] || "", `${key}r${r}c${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join(" "), key)}</blockquote>);
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && (listItem.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (listItem.test(lines[i])) items.push(lines[i].replace(listItem, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `${key}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
    if (!paragraph.length) paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraph.join("\n"), key)}</p>);
  }
  return <div class="md">{blocks}</div>;
}
