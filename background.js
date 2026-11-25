// Service worker: the ONLY place that reads the GitHub token and talks to GitHub.

const EXT = {
  cpp: "cpp", c: "c", java: "java", python: "py", python3: "py", pythondata: "py",
  csharp: "cs", javascript: "js", typescript: "ts", php: "php", swift: "swift",
  kotlin: "kt", dart: "dart", golang: "go", ruby: "rb", scala: "scala", rust: "rs",
  racket: "rkt", erlang: "erl", elixir: "ex", mysql: "sql", mssql: "sql",
  oraclesql: "sql", postgresql: "sql", bash: "sh",
};

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own content script running on leetcode.com
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.url || !sender.url.startsWith("https://leetcode.com/")) return;
  if (!msg || msg.type !== "sync") return;

  sync(msg.payload)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((err) => {
      setBadge("!", "#d33");
      chrome.storage.local.set({ lastError: String(err.message || err), lastErrorAt: Date.now() });
      sendResponse({ ok: false, error: String(err.message || err) });
    });
  return true; // async response
});

// UTF-8 safe base64
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  if (text) setTimeout(() => chrome.action.setBadgeText({ text: "" }), 8000);
}

async function getConfig() {
  const { token, owner, repo, branch } = await chrome.storage.local.get(["token", "owner", "repo", "branch"]);
  if (!token || !owner || !repo) throw new Error("LeetSync not configured. Open the extension options.");
  return { token, owner, repo, branch: branch || "" };
}

async function gh(cfg, method, path, body) {
  const encPath = path.split("/").map(encodeURIComponent).join("/");
  let url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${encPath}`;
  if (method === "GET" && cfg.branch) url += `?ref=${encodeURIComponent(cfg.branch)}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Create or update a file. Skips the commit if content is identical.
// If onlyIfMissing is true, never overwrites an existing file.
async function putFile(cfg, path, content, message, { onlyIfMissing = false } = {}) {
  const existing = await gh(cfg, "GET", path);
  let sha;
  if (existing.ok) {
    const data = await existing.json();
    if (onlyIfMissing) return "exists";
    if (data.content && b64decode(data.content) === content) return "unchanged";
    sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub GET ${path}: ${existing.status} ${await existing.text()}`);
  }

  const body = { message, content: b64encode(content), ...(sha && { sha }), ...(cfg.branch && { branch: cfg.branch }) };
  const res = await gh(cfg, "PUT", path, body);
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  return sha ? "updated" : "created";
}

function safeSlug(s) {
  const slug = String(s || "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Refusing unsafe slug: ${s}`);
  return slug;
}

async function sync(p) {
  const cfg = await getConfig();

  // De-dupe across page reloads
  const { synced = [] } = await chrome.storage.local.get("synced");
  if (synced.includes(p.submissionId)) return { path: "(already synced)" };

  const slug = safeSlug(p.slug);
  const id = String(p.frontendId || "").replace(/[^0-9A-Za-z]/g, "");
  const folder = `${id.padStart(4, "0")}-${slug}`;
  const ext = EXT[p.lang] || "txt";
  const codePath = `${folder}/${slug}.${ext}`;

  const pct = (x) => (typeof x === "number" ? ` (beats ${x.toFixed(1)}%)` : "");
  const msg = `${p.title} [${p.difficulty}] - Time: ${p.runtime}${pct(p.runtimePct)}, Space: ${p.memory}${pct(p.memoryPct)}`;

  const codeResult = await putFile(cfg, codePath, p.code, msg);

  const readme =
    `# [${id}. ${p.title}](https://leetcode.com/problems/${slug}/)\n\n` +
    `**Difficulty:** ${p.difficulty}  \n` +
    (p.tags.length ? `**Topics:** ${p.tags.join(", ")}\n\n` : "\n") +
    `<hr>\n\n` +
    (p.content || "_Problem description unavailable (premium problem?)._") + "\n";
  await putFile(cfg, `${folder}/README.md`, readme, `Add README for ${p.title}`, { onlyIfMissing: true });

  await chrome.storage.local.set({
    synced: [...synced, p.submissionId].slice(-500),
    lastSync: { title: p.title, path: codePath, result: codeResult, at: Date.now() },
    lastError: null,
  });
  setBadge("✓", "#2a2");
  return { path: codePath, result: codeResult };
}
