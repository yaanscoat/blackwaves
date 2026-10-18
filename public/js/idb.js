// Tiny IndexedDB key/value store for things too big for localStorage,
// like an uploaded background.
export const dbName = "blackwaves";
const storeName = "files";
let opening = null;

const open = () => {
    opening ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return opening;
};

const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const get = (key) => run("readonly", store => store.get(key)).catch(() => undefined);
export const set = (key, value) => run("readwrite", store => store.put(value, key));
export const del = (key) => run("readwrite", store => store.delete(key)).catch(() => { });

// Scramjet's controller keeps every proxied site's cookies in one string.
const cookieDb = "__scramjet_controller";

const withCookieDb = (fn) => new Promise((resolve) => {
    const request = indexedDB.open(cookieDb, 1);
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("state"))
            request.result.createObjectStore("state");
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
        const db = request.result;
        try {
            fn(db, value => {
                db.close();
                resolve(value);
            });
        }
        catch {
            db.close();
            resolve(null);
        }
    };
});

export const readCookies = () => withCookieDb((db, done) => {
    const req = db.transaction("state", "readonly").objectStore("state").get("cookies");
    req.onsuccess = () => done(typeof req.result?.cookies === "string" ? req.result.cookies : null);
    req.onerror = () => done(null);
});

export const writeCookies = (cookies) => withCookieDb((db, done) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put({ updatedAt: Date.now(), cookies }, "cookies");
    tx.oncomplete = () => done(true);
    tx.onerror = () => done(false);
});

const deleteDatabase = (name) => new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
});

export const clearCookies = () => deleteDatabase(cookieDb);

// Everything proxied sites stored that is not ours: their localStorage keys,
// IndexedDB databases and the HTTP cache plugin's Cache Storage.
export const clearSiteData = async () => {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && !key.startsWith("blackwaves:"))
                keys.push(key);
        }
        keys.forEach(key => localStorage.removeItem(key));
    }
    catch { }
    try {
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs
            .map(db => db.name)
            .filter(name => name && name !== dbName && name !== cookieDb)
            .map(deleteDatabase));
    }
    catch { }
    try {
        const names = await caches.keys();
        await Promise.all(names.filter(name => !name.startsWith("blackwaves-shell-")).map(name => caches.delete(name)));
    }
    catch { }
};
