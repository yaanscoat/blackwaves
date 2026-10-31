<p align="center">
  <img src="favicon.ico" alt="blackwaves" width="300">
</p>

<h1 align="center">blackwaves!</h1>
<p align="center">Surf the Web UwU</p>
<p align="center">blackwaves is a slick UBG/Web-Proxy that's designed to bypass internet censorship.</p>

## Features
- Cool UI
- Music
- Chatroom
- Shop
- Over 4000 Games
- Manga
- Cloudsync
- Shop for pfp decorations
- AI chat, Paraphraser and Humanizer (free models)

## Self-hosting

>[!WARNING]
>You **CANNOT** host blackwaves on serverless hosts. This includes Github Pages, Cloudflare Workers, etc. You need to use something like Render, Railway or a dedicated server.

1. Open your terminal
2. Paste in these commands

```sh
#clone gh repo
git clone https://github.com/yaanscoat/blackwaves

#cd
cd blackwaves

npm i      #npm install

npm start  #nodejs server command
```

then open http://localhost:8080 and you're finished!

>[!TIP]
>If YouTube asks you to "sign in to confirm you're not a bot", YouTube doesn't like your server's IP. Set `YOUTUBE_PROXY=http://user:pass@host:port` to send only YouTube traffic (music and youtube.com in the browser) through another proxy. Music also falls back to SoundCloud on its own.

>[!NOTE]
>blackwaves keeps itself under 3 GB of RAM (tested with 300 people on at once). Change that with `MEMORY_BUDGET_MB`; check usage at `/health?memory`.

## Credits!

* lyra by gayq the codebase  that **ALL** of blackwaves is built on
* x8rr/movies - movies & shows API
* x8rr/manga manga API - MangaDex + MangaPill
* edideaur/monochrome - where blackwaves music started
* YouTube.js by LuanRT - YouTube Music search and playback
* SoundCloud - the other half of music search
* TMDB - movie and show metadata
* Mercury Workshop - Scramjet, Wisp, epoxy and libcurl
* x8rr/sapphire - the base of lyra's extension runtime
* gn-math, Selenite, Truffled, Edurocks, wasm.rip, Velara, gmshelf (UGS, CKV, Seraph) - game sources
* Font Awesome Free - every icon ([CC BY 4.0](https://fontawesome.com/license/free))
* Lexend - the only font we use
* oneko - the cat (you'll find it)

## LICENSE

This project is protected by the [GNU AGPL-v3!](LICENSE)

## Star History

<a href="https://www.star-history.com/?repos=yaanscoat%2Fblackwaves&type=timeline&logscale=&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=yaanscoat/blackwaves&type=timeline&theme=dark&logscale&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=yaanscoat/blackwaves&type=timeline&logscale&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=yaanscoat/blackwaves&type=timeline&logscale&legend=top-left" />
 </picture>
</a>
