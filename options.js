const $ = (id) => document.getElementById(id);
const FIELDS = ["owner", "repo", "branch", "token"];

function show(msg, cls) {
  $("status").textContent = msg;
  $("status").className = cls || "";
}

async function load() {
  const data = await chrome.storage.local.get([...FIELDS, "lastSync", "lastError"]);
  FIELDS.forEach((f) => ($(f).value = data[f] || ""));
  const parts = [];
  if (data.lastSync) parts.push(`Last sync: ${data.lastSync.title} → ${data.lastSync.path} (${data.lastSync.result}) at ${new Date(data.lastSync.at).toLocaleString()}`);
  if (data.lastError) parts.push(`Last error: ${data.lastError}`);
  $("last").textContent = parts.join("\n");
}

$("save").onclick = async () => {
  const vals = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  if (!vals.owner || !vals.repo || !vals.token) return show("Owner, repo and token are required.", "err");
  if (!/^github_pat_/.test(vals.token)) show("Warning: this doesn't look like a fine-grained token (github_pat_...). Saved anyway.", "err");
  else show("Saved.", "ok");
  await chrome.storage.local.set(vals);
};

$("test").onclick = async () => {
  const owner = $("owner").value.trim(), repo = $("repo").value.trim(), token = $("token").value.trim();
  if (!owner || !repo || !token) return show("Fill in owner, repo and token first.", "err");
  show("Testing...");
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return show(`Failed: HTTP ${res.status}\n${await res.text()}`, "err");
    const r = await res.json();
    show(`OK: ${r.full_name} (${r.private ? "private" : "public"}), default branch "${r.default_branch}".\nToken can reach this repo.`, "ok");
  } catch (e) {
    show("Error: " + e.message, "err");
  }
};

load();
