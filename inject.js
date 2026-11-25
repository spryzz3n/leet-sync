// Runs in the PAGE's JavaScript world (world: "MAIN").
// Watches LeetCode's own "check submission" polling and tells content.js
// when a submission is Accepted. It never sees the GitHub token.
(() => {
  const RE = /\/submissions\/detail\/(\d+)\/check\/?/; // numeric id = real submit, not "Run"
  console.log("[LeetSync] inject.js loaded");

  const notify = (id, data) => {
    console.log("[LeetSync] check response", id, data && data.state, data && data.status_msg);
    if (data && data.state === "SUCCESS" && data.status_msg === "Accepted") {
      window.postMessage({ source: "leetsync", type: "accepted", submissionId: id }, location.origin);
    }
  };

  const urlOf = (input) => {
    try {
      return input instanceof Request ? input.url : String(input);
    } catch {
      return "";
    }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const m = urlOf(args[0]).match(RE);
      if (m) res.clone().json().then((d) => notify(m[1], d)).catch(() => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const m = String(url).match(RE);
    if (m) {
      this.addEventListener("load", () => {
        try {
          notify(m[1], JSON.parse(this.responseText));
        } catch {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
