import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

// CloudSync: one JSON file per account under data/cloudsync. Passwords are
// scrypt-hashed, session tokens are stored only as SHA-256 digests, and the
// synced payload is opaque to the server.
const usernamePattern = /^[a-zA-Z0-9_.-]{3,24}$/;
const maxTokens = 10;
const maxPayload = "12mb";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));

export const syncRouter = (dataDir) => {
    const dir = path.join(dataDir, "cloudsync");
    const ready = fs.mkdir(dir, { recursive: true });
    const fileFor = (username) => path.join(dir, `${sha256(username.toLowerCase())}.json`);
    const locks = new Map();

    // Serialise writes per account so two tabs syncing at once cannot
    // interleave a read-modify-write.
    const withLock = async (username, task) => {
        const key = username.toLowerCase();
        const previous = locks.get(key) ?? Promise.resolve();
        const next = previous.then(task, task);
        locks.set(key, next.catch(() => { }));
        try {
            return await next;
        }
        finally {
            if (locks.get(key) === next)
                locks.delete(key);
        }
    };

    const readUser = async (username) => {
        await ready;
        try {
            return JSON.parse(await fs.readFile(fileFor(username), "utf8"));
        }
        catch {
            return null;
        }
    };

    const writeUser = async (user) => {
        const file = fileFor(user.username);
        const temp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
        await fs.writeFile(temp, JSON.stringify(user));
        await fs.rename(temp, file);
    };

    const attempts = new Map();
    const rateLimited = (ip) => {
        const now = Date.now();
        const entry = attempts.get(ip);
        if (!entry || now - entry.start > 60_000) {
            attempts.set(ip, { start: now, count: 1 });
            return false;
        }
        entry.count += 1;
        return entry.count > 20;
    };

    const issueToken = (user) => {
        const token = crypto.randomBytes(32).toString("base64url");
        user.tokens = [sha256(token), ...(user.tokens ?? [])].slice(0, maxTokens);
        return token;
    };

    const credentials = (body) => {
        const username = typeof body?.username === "string" ? body.username.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!usernamePattern.test(username))
            return { error: "Usernames are 3-24 letters, numbers, dots, dashes or underscores." };
        if (password.length < 6 || password.length > 128)
            return { error: "Passwords must be 6-128 characters." };
        return { username, password };
    };

    const verify = async (user, password) => {
        if (!user)
            return false;
        const key = await scrypt(password, Buffer.from(user.salt, "hex"));
        const stored = Buffer.from(user.hash, "hex");
        return stored.length === key.length && crypto.timingSafeEqual(stored, key);
    };

    // Tokens look like "<username>:<secret>" so the account file can be found
    // without an index.
    const authenticate = async (req) => {
        const header = req.headers.authorization ?? "";
        const match = /^Bearer ([a-zA-Z0-9_.-]{3,24}):([A-Za-z0-9_-]{20,})$/.exec(header);
        if (!match)
            return null;
        const user = await readUser(match[1]);
        if (!user?.tokens?.includes(sha256(match[2])))
            return null;
        return { user, secret: match[2] };
    };

    const router = express.Router();
    router.use("/api/sync", express.json({ limit: maxPayload }));

    router.post("/api/sync/register", async (req, res) => {
        if (rateLimited(req.ip)) {
            res.status(429).json({ error: "Too many attempts. Wait a minute." });
            return;
        }
        const parsed = credentials(req.body);
        if (parsed.error) {
            res.status(400).json({ error: parsed.error });
            return;
        }
        const result = await withLock(parsed.username, async () => {
            if (await readUser(parsed.username))
                return null;
            const salt = crypto.randomBytes(16);
            const user = {
                username: parsed.username,
                salt: salt.toString("hex"),
                hash: (await scrypt(parsed.password, salt)).toString("hex"),
                tokens: [],
                createdAt: Date.now(),
                updatedAt: 0,
                data: null
            };
            const token = issueToken(user);
            await writeUser(user);
            return { token: `${user.username}:${token}`, username: user.username };
        });
        if (!result) {
            res.status(409).json({ error: "That username is taken." });
            return;
        }
        res.json(result);
    });

    router.post("/api/sync/login", async (req, res) => {
        if (rateLimited(req.ip)) {
            res.status(429).json({ error: "Too many attempts. Wait a minute." });
            return;
        }
        const parsed = credentials(req.body);
        if (parsed.error) {
            res.status(400).json({ error: "Wrong username or password." });
            return;
        }
        const result = await withLock(parsed.username, async () => {
            const user = await readUser(parsed.username);
            if (!(await verify(user, parsed.password)))
                return null;
            const token = issueToken(user);
            await writeUser(user);
            return {
                token: `${user.username}:${token}`,
                username: user.username,
                updatedAt: user.updatedAt
            };
        });
        if (!result) {
            res.status(401).json({ error: "Wrong username or password." });
            return;
        }
        res.json(result);
    });

    router.get("/api/sync/data", async (req, res) => {
        const auth = await authenticate(req);
        if (!auth) {
            res.status(401).json({ error: "Signed out." });
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json({ data: auth.user.data, updatedAt: auth.user.updatedAt });
    });

    router.put("/api/sync/data", async (req, res) => {
        const auth = await authenticate(req);
        if (!auth) {
            res.status(401).json({ error: "Signed out." });
            return;
        }
        const data = req.body?.data;
        if (!data || typeof data !== "object") {
            res.status(400).json({ error: "Nothing to save." });
            return;
        }
        const updatedAt = await withLock(auth.user.username, async () => {
            const user = await readUser(auth.user.username);
            user.data = data;
            user.updatedAt = Date.now();
            await writeUser(user);
            return user.updatedAt;
        });
        res.json({ updatedAt });
    });

    router.post("/api/sync/logout", async (req, res) => {
        const auth = await authenticate(req);
        if (auth) {
            await withLock(auth.user.username, async () => {
                const user = await readUser(auth.user.username);
                user.tokens = user.tokens.filter(token => token !== sha256(auth.secret));
                await writeUser(user);
            });
        }
        res.json({ ok: true });
    });

    router.delete("/api/sync/account", async (req, res) => {
        const auth = await authenticate(req);
        if (!auth || !(await verify(auth.user, String(req.body?.password ?? "")))) {
            res.status(401).json({ error: "Wrong password." });
            return;
        }
        await withLock(auth.user.username, () => fs.rm(fileFor(auth.user.username), { force: true }));
        res.json({ ok: true });
    });

    router.use("/api/sync", (error, _req, res, _next) => {
        res.status(error.status ?? 500).json({
            error: error.type === "entity.too.large"
                ? "Your data is too large to sync (custom backgrounds over ~8MB are the usual cause)."
                : "CloudSync failed on the server."
        });
    });

    return router;
};
