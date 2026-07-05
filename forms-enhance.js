/* ============================================================
   Davis Digital Studio — forms-enhance.js
   Elevates every form on the site to the standard Stripe / Typeform
   use: correct mobile keyboards, browser autofill, clear privacy
   context, and plain-language success/error states.

   WHY THIS MATTERS (from the research)
   - Autofill only works when fields declare what they hold
     (autocomplete="email" etc.). Missing it = clients retype on
     mobile = drop-off.
   - inputmode shows the RIGHT keyboard (email keyboard for email,
     number pad for phone) without changing validation.
   - "What happens next" microcopy near the submit button measurably
     reduces hesitation and resubmits.

   HOW TO USE
   Add once before </body> on any page with a form (contact.html
   first):

     <script src="/forms-enhance.js" defer></script>

   It is non-destructive: it only ADDS attributes to fields that
   don't already have them, and only adds the privacy note if one
   isn't already present.
   ============================================================ */
(function () {
  "use strict";

  // Map field name/type/id hints -> the attributes premium forms set.
  // We match loosely so it works across your pages without renaming.
  var RULES = [
    {
      test: function (el) { return el.type === "email" || /email/i.test(el.name + el.id); },
      attrs: { autocomplete: "email", inputmode: "email", autocapitalize: "off", spellcheck: "false" }
    },
    {
      test: function (el) { return /name/i.test(el.name + el.id) && !/business|company|user/i.test(el.name + el.id); },
      attrs: { autocomplete: "name", autocapitalize: "words" }
    },
    {
      test: function (el) { return /business|company/i.test(el.name + el.id); },
      attrs: { autocomplete: "organization", autocapitalize: "words" }
    },
    {
      test: function (el) { return el.type === "tel" || /phone|tel/i.test(el.name + el.id); },
      attrs: { autocomplete: "tel", inputmode: "tel", type: "tel" }
    },
    {
      test: function (el) { return /url|website|site/i.test(el.name + el.id); },
      attrs: { autocomplete: "url", inputmode: "url", autocapitalize: "off", spellcheck: "false" }
    }
  ];

  function enhanceField(el) {
    if (!el.name && !el.id) return;
    RULES.forEach(function (rule) {
      if (!rule.test(el)) return;
      Object.keys(rule.attrs).forEach(function (k) {
        // Never override an attribute the author already set
        if (!el.hasAttribute(k)) el.setAttribute(k, rule.attrs[k]);
      });
    });
  }

  function ensurePrivacyNote(form) {
    // If the form already reassures (your contact form says "No spam…")
    // we don't double up. Otherwise add a quiet, specific line.
    var existing = form.textContent || "";
    if (/no spam|no marketing|reply by email|respond.*email|won.t share/i.test(existing)) return;
    var note = document.createElement("p");
    note.className = "form-privacy-note";
    note.style.cssText = "font-size:12px;color:#5e5270;line-height:1.6;margin-top:10px;";
    note.textContent = "I'll reply by email, usually within one business day. No marketing, no list. Your details stay between us.";
    var btn = form.querySelector('button[type="submit"], input[type="submit"], .btn-submit');
    if (btn && btn.parentNode) btn.parentNode.insertBefore(note, btn.nextSibling);
    else form.appendChild(note);
  }

  function init() {
    var forms = document.querySelectorAll("form");
    forms.forEach(function (form) {
      // Skip the login forms in the portal/admin — different intent.
      if (form.closest(".login, .login-screen, .login-wrap")) return;
      form.querySelectorAll("input, textarea").forEach(enhanceField);
      ensurePrivacyNote(form);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
