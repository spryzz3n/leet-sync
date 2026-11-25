// Runs in the extension's isolated world on leetcode.com.
// Receives "accepted" pings from inject.js, then fetches the submission itself
// from LeetCode (same-origin, your session cookies) and hands it to background.js.
//
// Security: we do NOT trust the ping's contents. We re-fetch the submission from
// LeetCode and only sync if LeetCode itself says it's Accepted (statusCode 10).

const seen = new Set();

const SUBMISSION_QUERY = `
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtimeDisplay
    runtimePercentile
    memoryDisplay
    memoryPercentile
    code
    timestamp
    statusCode
    lang { name verboseName }
    question { questionId titleSlug }
  }
}`;

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    difficulty
    content
    topicTags { name }
  }
}`;

function getCookie(name) {
  const row = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return row ? decodeURIComponent(row.split("=")[1]) : "";
}

async function gql(query, variables) {
  const res = await fetch("/graphql/", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-csrftoken": getCookie("csrftoken"),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("LeetCode GraphQL: " + JSON.stringify(json.errors));
  return json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSubmission(id) {
  // Details can lag a moment behind the "check" response, so retry briefly.
  for (let i = 0; i < 4; i++) {
    const d = (await gql(SUBMISSION_QUERY, { submissionId: Number(id) })).submissionDetails;
    if (d && d.code) return d;
    await sleep(1000);
  }
  throw new Error("Could not load submission details");
}

const log = (...a) => console.log("[LeetSync]", ...a);
log("content.js loaded");

// Path 1: signal from inject.js (network watcher)
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || msg.source !== "leetsync" || msg.type !== "accepted") return;
  handle(String(msg.submissionId), "network");
});

// Path 2 (fallback): after submitting, LeetCode's UI navigates to
// /problems/<slug>/submissions/<id>/ - watch the URL for that.
let lastUrl = "";
setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  const m = location.pathname.match(/^\/problems\/[^/]+\/submissions\/(\d+)\/?$/);
  if (m) handle(m[1], "url");
}, 1000);

async function handle(id, via) {
  if (!/^\d+$/.test(id) || seen.has(id)) return;
  seen.add(id);
  log(`submission ${id} detected via ${via}`);

  try {
    const sub = await getSubmission(id);
    log("submission details", { statusCode: sub.statusCode, lang: sub.lang && sub.lang.name, slug: sub.question && sub.question.titleSlug });
    if (sub.statusCode !== 10) return log("not Accepted, skipping");

    // URL path also fires when you just browse old submissions: only sync recent ones.
    const ageMin = (Date.now() / 1000 - Number(sub.timestamp)) / 60;
    if (via === "url" && ageMin > 15) return log(`old submission (${ageMin.toFixed(0)} min), skipping`);

    const q = (await gql(QUESTION_QUERY, { titleSlug: sub.question.titleSlug })).question;

    const payload = {
      submissionId: id,
      code: sub.code,
      lang: sub.lang.name,
      langVerbose: sub.lang.verboseName,
      runtime: sub.runtimeDisplay,
      runtimePct: sub.runtimePercentile,
      memory: sub.memoryDisplay,
      memoryPct: sub.memoryPercentile,
      frontendId: q.questionFrontendId,
      title: q.title,
      slug: q.titleSlug,
      difficulty: q.difficulty,
      content: q.content,
      tags: (q.topicTags || []).map((t) => t.name),
    };

    log("sending to background", q.titleSlug);
    chrome.runtime.sendMessage({ type: "sync", payload }, (resp) => {
      if (chrome.runtime.lastError) console.warn("[LeetSync]", chrome.runtime.lastError.message);
      else if (resp && resp.ok) log("synced:", resp.path, resp.result || "");
      else console.warn("[LeetSync] failed:", resp && resp.error);
    });
  } catch (err) {
    console.warn("[LeetSync] error:", err);
    seen.delete(id);
  }
}
