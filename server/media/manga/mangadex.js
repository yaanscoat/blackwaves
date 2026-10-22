// ported to js from x8rr/manga (https://github.com/x8rr/manga), mangadex source.
// images go through /api/manga/img so school filters only ever see us.
const API = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 24;
const MAX_OFFSET = 9000;
const proxied = (url)=>`/api/manga/img?u=${encodeURIComponent(url)}`;
const RATINGS = [
    "safe"
];
function offsetOf(params) {
    const offset = Number(params.get("offset") || 0);
    return Number.isInteger(offset) && offset >= 0 && offset <= MAX_OFFSET ? offset : 0;
}
function localized(map) {
    if (!map) return "";
    return map.en || Object.values(map)[0] || "";
}
function titleOf(attributes) {
    const alt = (attributes.altTitles || []).find((entry)=>entry.en);
    return attributes.title?.en || alt?.en || localized(attributes.title) || "Untitled";
}
function coverOf(manga, size = 256) {
    const file = manga.relationships?.find((rel)=>rel.type === "cover_art")?.attributes?.fileName;
    return file ? proxied(`${COVERS}/${manga.id}/${file}.${size}.jpg`) : "";
}
export function summarizeManga(manga) {
    return {
        id: manga.id,
        title: titleOf(manga.attributes),
        cover: coverOf(manga)
    };
}
export function detailManga(manga) {
    const attrs = manga.attributes;
    return {
        ...summarizeManga(manga),
        cover: coverOf(manga, 512),
        description: localized(attrs.description).split("\n---")[0].trim(),
        status: attrs.status || "",
        year: attrs.year || null,
        tags: (attrs.tags || []).map((tag)=>localized(tag.attributes?.name)).filter(Boolean).slice(0, 8),
        authors: (manga.relationships || []).filter((rel)=>rel.type === "author").map((rel)=>rel.attributes?.name).filter(Boolean)
    };
}
export function summarizeChapters(entries) {
    const seen = new Set();
    const chapters = [];
    for (const { id, attributes } of entries){
        if (!attributes.pages || attributes.externalUrl) continue;
        const chapter = String(attributes.chapter ?? "");
        const key = chapter || id;
        if (seen.has(key)) continue;
        seen.add(key);
        chapters.push({
            id,
            chapter,
            title: attributes.title || "",
            pages: attributes.pages
        });
    }
    return chapters;
}
export function summarizePages(data) {
    const { hash, dataSaver } = data.chapter;
    return dataSaver.map((file)=>proxied(`${data.baseUrl}/data-saver/${hash}/${file}`));
}
const LATEST_CHAPTERS = 100;
function latestRoute(params) {
    const upstream = new URL(`${API}/chapter`);
    upstream.searchParams.set("limit", String(LATEST_CHAPTERS));
    upstream.searchParams.set("offset", String(offsetOf(params)));
    upstream.searchParams.append("translatedLanguage[]", "en");
    upstream.searchParams.set("order[readableAt]", "desc");
    upstream.searchParams.set("includeExternalUrl", "0");
    upstream.searchParams.append("includes[]", "manga");
    for (const rating of RATINGS)upstream.searchParams.append("contentRating[]", rating);
    const start = offsetOf(params);
    return {
        upstream,
        shape: ()=>null,
        followUp: (body)=>{
            const ids = [];
            for (const chapter of body.data || []){
                if (!chapter.attributes?.pages) continue;
                const id = chapter.relationships?.find((rel)=>rel.type === "manga")?.id;
                if (id && !ids.includes(id)) ids.push(id);
            }
            if (!ids.length) return null;
            const next = (body.data || []).length === LATEST_CHAPTERS && start + LATEST_CHAPTERS <= MAX_OFFSET ? start + LATEST_CHAPTERS : null;
            const manga = new URL(`${API}/manga`);
            ids.forEach((id)=>manga.searchParams.append("ids[]", id));
            manga.searchParams.set("limit", String(ids.length));
            manga.searchParams.append("includes[]", "cover_art");
            for (const rating of RATINGS)manga.searchParams.append("contentRating[]", rating);
            return {
                upstream: manga,
                shape: (found)=>{
                    const byId = new Map((found.data || []).map((entry)=>[
                            entry.id,
                            entry
                        ]));
                    const items = ids.map((id)=>byId.get(id)).filter(Boolean).map((entry)=>summarizeManga(entry));
                    return {
                        total: 0,
                        items,
                        next
                    };
                }
            };
        }
    };
}
export function mangaRoute(pathname, params) {
    const parts = pathname.replace(/^\/?(mangadex)\/?/, "").split("/").filter(Boolean);
    const upstream = new URL(API);
    const ratings = ()=>RATINGS.forEach((rating)=>upstream.searchParams.append("contentRating[]", rating));
    if (parts.length === 1 && parts[0] === "search") {
        upstream.pathname = "/manga";
        const title = (params.get("title") || "").trim().slice(0, 100);
        if (title) upstream.searchParams.set("title", title);
        else upstream.searchParams.set("order[latestUploadedChapter]", "desc");
        upstream.searchParams.set("limit", String(PAGE_SIZE));
        upstream.searchParams.set("offset", String(offsetOf(params)));
        upstream.searchParams.append("includes[]", "cover_art");
        upstream.searchParams.append("availableTranslatedLanguage[]", "en");
        upstream.searchParams.set("hasAvailableChapters", "true");
        ratings();
        const start = offsetOf(params);
        return {
            upstream,
            shape: (body)=>{
                const items = (body.data || []).map(summarizeManga);
                const end = start + items.length;
                return {
                    total: body.total ?? 0,
                    items,
                    next: items.length && end < Math.min(body.total ?? 0, MAX_OFFSET) ? end : null
                };
            }
        };
    }
    if (parts.length === 1 && parts[0] === "latest") {
        return latestRoute(params);
    }
    if (parts.length === 1 && UUID.test(parts[0])) {
        upstream.pathname = `/manga/${parts[0]}`;
        upstream.searchParams.append("includes[]", "cover_art");
        upstream.searchParams.append("includes[]", "author");
        return {
            upstream,
            shape: (body)=>detailManga(body.data)
        };
    }
    if (parts.length === 2 && parts[1] === "chapters" && UUID.test(parts[0])) {
        upstream.pathname = `/manga/${parts[0]}/feed`;
        upstream.searchParams.set("limit", "500");
        upstream.searchParams.set("offset", String(offsetOf(params)));
        upstream.searchParams.append("translatedLanguage[]", "en");
        upstream.searchParams.set("order[chapter]", "asc");
        upstream.searchParams.set("includeExternalUrl", "0");
        ratings();
        return {
            upstream,
            shape: (body)=>({
                    total: body.total ?? 0,
                    chapters: summarizeChapters(body.data || [])
                })
        };
    }
    if (parts.length === 3 && parts[0] === "chapter" && parts[2] === "pages" && UUID.test(parts[1])) {
        upstream.pathname = `/at-home/server/${parts[1]}`;
        return {
            upstream,
            shape: (body)=>({
                    pages: summarizePages(body)
                })
        };
    }
    return null;
}
export async function proxyMangadex(pathname, params, fetchImpl = fetch) {
    const route = mangaRoute(pathname, params);
    if (!route) return {
        status: 404,
        body: {
            error: "not found"
        }
    };
    try {
        const response = await fetchImpl(route.upstream, {
            headers: {
                accept: "application/json",
                "user-agent": "manga-api/1.0"
            },
            signal: AbortSignal.timeout(10_000)
        });
        if (response.status === 404) return {
            status: 404,
            body: {
                error: "not found"
            }
        };
        if (!response.ok) return {
            status: 502,
            body: {
                error: "mangadex request failed"
            }
        };
        const body = await response.json();
        if (route.followUp) {
            const step = route.followUp(body);
            if (!step) return {
                status: 200,
                body: {
                    total: 0,
                    items: [],
                    next: null
                }
            };
            const second = await fetchImpl(step.upstream, {
                headers: {
                    accept: "application/json",
                    "user-agent": "manga-api/1.0"
                },
                signal: AbortSignal.timeout(10_000)
            });
            if (!second.ok) return {
                status: 502,
                body: {
                    error: "mangadex request failed"
                }
            };
            return {
                status: 200,
                body: step.shape(await second.json())
            };
        }
        return {
            status: 200,
            body: route.shape(body)
        };
    } catch  {
        return {
            status: 502,
            body: {
                error: "mangadex is unreachable"
            }
        };
    }
}
