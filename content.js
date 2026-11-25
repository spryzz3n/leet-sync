// Isolated content script on leetcode.com.
// Gets "submission <id>" signals (from background webRequest, inject.js, or URL change),
// fetches the submission from LeetCode itself, and only syncs if LeetCode says Accepted.
(() => {
  const log = (...a) => console.log("[LeetSync]", ...a);
  log("content.js loaded");

  const done = new Set();
  const busy = new Set();

  const SUBMISSION_QUERY = `
  query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      runtimeDisplay runtimePercentile memoryDisplay memoryPercentile
      code timestamp statusCode
      lang { name verboseName }
      question { questionId titleSlug }
    }
  }`;

  const QUESTION_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId title titleSlug difficulty content
      topicTags { name }
    }
  }`;

  const getCookie = (name) => {
    const row = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
    return row ? decodeURIComponent(row.split("=")[1]) : "";
  };

  async function gql(query, variables) {
    const res = await fetch("/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrftoken": getCookie("csrftoken") },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`LeetCode GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error("LeetCode GraphQL: " + JSON.stringify(json.errors));
    return json.data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getSubmission(id) {
    for (let i = 0; i < 5; i++) {
      const d = (await gql(SUBMISSION_QUERY, { submissionId: Number(id) })).submissionDetails;
      if (d && d.code && d.statusCode != null) return d;
      await sleep(1000);
    }
    throw new Error("Could not load submission details");
  }

  async function handle(id, via) {
    id = String(id);
    if (!/^\d+$/.test(id) || done.has(id) || busy.has(id)) return;
    busy.add(id);
    log(`submission ${id} detected via ${via}`);
    try {
      const sub = await getSubmission(id);
      if (sub.statusCode !== 10) return log(`status ${sub.statusCode}, not Accepted (yet)`); // retry on next signal

      const ageMin = (Date.now() / 1000 - Number(sub.timestamp)) / 60;
      if (via === "url" && ageMin > 15) {
        done.add(id);
        return log(`old submission (${ageMin.toFixed(0)} min), skipping`);
      }

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
      const resp = await chrome.runtime.sendMessage({ type: "sync", payload });
      if (resp && resp.ok) {
        done.add(id);
        log("synced:", resp.path, resp.result || "");
      } else {
        console.warn("[LeetSync] failed:", resp && resp.error);
      }
    } catch (err) {
      console.warn("[LeetSync] error:", err);
    } finally {
      busy.delete(id);
    }
  }

  // Signal 1: background saw LeetCode's check request (most reliable)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "check") handle(msg.submissionId, "background");
  });

  // Signal 2: inject.js network hook
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const msg = e.data;
    if (msg && msg.source === "leetsync" && msg.type === "accepted") handle(msg.submissionId, "network");
  });

  // Signal 3: URL changes to /problems/<slug>/submissions/<id>/
  let lastUrl = "";
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const m = location.pathname.match(/^\/problems\/[^/]+\/submissions\/(\d+)\/?$/);
    if (m) handle(m[1], "url");
  }, 1000);
})();
