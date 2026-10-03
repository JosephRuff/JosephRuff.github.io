/*
 * Loads a Jupyter notebook that was exported to HTML (nbconvert) from GitHub and shows it
 * in an iframe on the page.
 *
 * Why an iframe: the exported file brings its own <head> (a large JupyterLab stylesheet,
 * MathJax and its settings, require.js ...). Inside an iframe all of that runs exactly as it
 * does when you open the exported file directly, and it cannot restyle - or be restyled by -
 * the rest of the site.
 *
 * Why fetch() + srcdoc instead of <iframe src="...">: raw.githubusercontent.com serves files
 * as text/plain with a sandbox policy, so a browser will not render them as a web page.
 *
 * The frame is same-origin with the site (no sandbox attribute). That is deliberate: it lets
 * this script size the frame to its content and scroll the page for #links, and it keeps
 * MathJax's cookie access working. The content comes from your own repo, so it is as trusted
 * as the site's own code.
 */
(function () {
  "use strict";

  var root = document.getElementById("notebook");
  if (!root) { return; }

  var statusEl = document.getElementById("notebook-status");
  var errorEl = document.getElementById("notebook-error");
  var reasonEl = document.getElementById("notebook-error-reason");

  var SRC = root.getAttribute("data-src");
  var TITLE = root.getAttribute("data-title") || "Notebook";
  var NAV_OFFSET = 90;       // px: keeps a scrolled-to heading clear of the fixed navbar
  var TIMEOUT_MS = 20000;

  // ---- failure -------------------------------------------------------------------------

  function fail(reason) {
    if (statusEl) { statusEl.hidden = true; }
    if (reasonEl) { reasonEl.textContent = reason; }
    if (errorEl) { errorEl.hidden = false; }
  }

  // ---- fetch ---------------------------------------------------------------------------

  function looksLikeNotebook(html) {
    return /<main[\s>]/i.test(html) && html.indexOf("jp-Notebook") !== -1;
  }

  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer = setTimeout(function () { if (controller) { controller.abort(); } }, TIMEOUT_MS);

  fetch(SRC, controller ? { signal: controller.signal } : {})
    .then(function (res) {
      if (!res.ok) { throw new Error("GitHub answered with status " + res.status + "."); }
      return res.text();
    })
    .then(function (html) {
      clearTimeout(timer);
      if (!looksLikeNotebook(html)) {
        throw new Error("The file was found, but it does not look like an exported Jupyter notebook.");
      }
      showNotebook(html);
    })
    .catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") {
        fail("GitHub took too long to respond.");
      } else if (err instanceof TypeError) {
        fail("Could not reach GitHub.");
      } else {
        fail((err && err.message) || "Unknown error.");
      }
    });

  // ---- display -------------------------------------------------------------------------

  function showNotebook(html) {
    var frame = document.createElement("iframe");
    frame.className = "notebook-frame";
    frame.title = TITLE;
    frame.addEventListener("load", function () { onFrameLoad(frame); });
    frame.srcdoc = html;
    root.appendChild(frame);
  }

  function onFrameLoad(frame) {
    var doc = frame.contentDocument;
    var win = frame.contentWindow;
    if (!doc || !doc.body) { return; }
    if (statusEl) { statusEl.hidden = true; }

    // Links that leave the notebook open in a new tab instead of replacing it.
    var links = doc.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (href.charAt(0) !== "#") {
        links[i].setAttribute("target", "_blank");
        links[i].setAttribute("rel", "noopener");
      }
    }

    // Links inside the notebook (contents, equation references) scroll the page, not the frame.
    doc.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) { return; }
      var id = decode(a.getAttribute("href").slice(1));
      if (scrollToId(frame, id, true)) {
        e.preventDefault();
        if (window.history && history.replaceState) { history.replaceState(null, "", "#" + id); }
      }
    });

    // Keep the frame exactly as tall as the notebook, so the page scrolls, not the frame.
    function resize() {
      var h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
      if (h > 0) { frame.style.height = h + "px"; }
    }
    resize();
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(resize);
      ro.observe(doc.documentElement);
      ro.observe(doc.body);
    }
    win.addEventListener("resize", resize);

    // Deep link, e.g. /pharmacokinetics/01_equations/#Problem-Definition
    if (location.hash.length > 1) {
      var jump = function () { scrollToId(frame, decode(location.hash.slice(1)), false); };
      jump();
      // Typesetting equations changes the layout, so jump again once MathJax has finished.
      if (win.MathJax && win.MathJax.Hub && win.MathJax.Hub.Queue) { win.MathJax.Hub.Queue(jump); }
    }
  }

  // ---- helpers -------------------------------------------------------------------------

  function decode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function scrollToId(frame, id, smooth) {
    var doc = frame.contentDocument;
    var el = doc.getElementById(id) || doc.getElementsByName(id)[0];
    if (!el) { return false; }
    var top = frame.getBoundingClientRect().top + window.pageYOffset +
              el.getBoundingClientRect().top - NAV_OFFSET;
    window.scrollTo({ top: top, behavior: smooth ? "smooth" : "auto" });
    return true;
  }
})();
