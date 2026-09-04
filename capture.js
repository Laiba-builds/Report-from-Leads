var LeadLedgerCapture = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/capture.js
  var capture_exports = {};
  __export(capture_exports, {
    readCurrentPage: () => readCurrentPage
  });

  // src/model.js
  function normalizeUrl(value) {
    try {
      const u = new URL(value);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return "";
      if (/(^|\.)linkedin\.com$/i.test(u.hostname)) {
        const id = u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || u.searchParams.get("currentJobId");
        if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
      }
      u.hash = "";
      for (const key of [...u.searchParams.keys()]) if (/^utm_|^(?:trk|trackingId|refId|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
      return u.href;
    } catch {
      return "";
    }
  }

  // src/linkedin-dom.js
  var text = (el) => String(el?.innerText?.trim() || el?.textContent || "").replace(/[\t ]+/g, " ").trim();
  var normalized = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  var ignored = /^(?:about the job|job description|people you can reach out to|meet the hiring team|use ai|similar jobs|recommended|more jobs|sign in|join linkedin|welcome|search|messaging)/i;
  function companies(root, loc) {
    return [...root.querySelectorAll("a[href]")].filter((a) => {
      try {
        const u = new URL(a.getAttribute("href"), loc.href);
        return /(^|\.)linkedin\.com$/.test(u.hostname) && /^\/company\/[^/]+/.test(u.pathname);
      } catch {
        return false;
      }
    }).map((a) => text(a) || a.querySelector("img")?.getAttribute("alt")?.replace(/\s+logo$/i, "") || "").filter((v) => v && v.length < 200 && !/^(?:follow|company|view company)$/i.test(v));
  }
  function linkedInFallback(doc, loc, knownRoot) {
    if (!/\/jobs\/view\/\d+|[?&]currentJobId=\d+/.test(loc.href)) return {};
    const root = knownRoot || doc.querySelector('[role="main"]') || doc;
    const pageTitle = normalized(doc.title).replace(/^\(\d+\)\s*/, "");
    const headings = [...root.querySelectorAll('h1,h2,[role="heading"],[data-testid="job-title"]')].filter((h) => {
      const t = text(h);
      return t.length > 5 && t.length < 250 && !ignored.test(t) && !h.closest('aside,nav,footer,[role="navigation"]');
    });
    const matches = headings.filter((h) => pageTitle.includes(normalized(text(h))));
    const candidates = matches.length ? matches : headings;
    for (const heading of candidates) {
      let header = null, names = [];
      for (let el = heading.parentElement, depth = 0; el && depth < 9; el = el.parentElement, depth++) {
        if (el === doc.body || el === doc.documentElement || el.querySelectorAll('h1,h2,[role="heading"]').length > 3) break;
        const found = [...new Set(companies(el, loc))];
        if (found.length === 1) {
          header = el;
          names = found;
          break;
        }
        if (found.length > 1 || el === root) break;
      }
      if (!header) continue;
      let description = "";
      const descriptionHeading = [...root.querySelectorAll('h2,h3,[role="heading"]')].find((h) => /^(?:about the job|job description)$/i.test(text(h)));
      if (descriptionHeading) {
        for (let el = descriptionHeading.parentElement, depth = 0; el && el !== root && depth < 6; el = el.parentElement, depth++) {
          const body = text(el), other = [...el.querySelectorAll('h1,h2,h3,[role="heading"]')].filter((h) => h !== descriptionHeading);
          if (other.length) break;
          if (body.length > text(descriptionHeading).length + 20) {
            description = body;
            break;
          }
        }
      }
      const title = text(heading);
      const chips = [...header.querySelectorAll('button,[role="button"],li,[data-testid],span,p')].map(text).filter((t) => t && t.length < 180 && !t.includes(title));
      const employment = chips.filter((t) => /^(?:(?:on[ -]site|hybrid|remote|contract|full[ -]time|part[ -]time|w-?2|c2c|temporary|internship|corp to corp)[\s·,|/-]*)+$/i.test(t)).join("\n");
      const pay = chips.filter((t) => /[$£€]|\b(?:USD|GBP|EUR|CAD|AUD)\b/.test(t));
      return { root: knownRoot || header, jobTitle: title, vendors: names, description, pay, employment, layout: "LinkedIn job-card fallback" };
    }
    return {};
  }

  // src/capture-dom.js
  function collectSnapshot(doc, loc) {
    const host = loc.hostname.toLowerCase();
    const linked = /(^|\.)linkedin\.com$/.test(host);
    const dice = /(^|\.)dice\.com$/.test(host);
    const monster = /(^|\.)monster\.com$/.test(host);
    const zip = /(^|\.)ziprecruiter\.com$/.test(host);
    const text2 = (el) => (el?.innerText?.trim() || el?.textContent || "").replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
    const first = (root2, selectors) => {
      for (const selector of selectors) {
        const el = root2.querySelector(selector);
        if (el && text2(el)) return el;
      }
      return null;
    };
    const texts = (root2, selectors) => [...new Set(selectors.flatMap((selector) => [...root2.querySelectorAll(selector)].map(text2)).filter(Boolean))];
    const bodyText = text2(doc.body).slice(0, 2e3);
    const pageTitle = doc.title ?? "";
    const blocked = /(?:\/checkpoint\/|\/authwall|\/login(?:[/?]|$)|\/uas\/login)/i.test(loc.href) ? "Sign-in or verification required. Open this lead, finish it in Chrome, then retry." : /access denied|just a moment|security verification|verify you are human|captcha|request blocked/i.test(pageTitle) || /^(?:please verify you are a human|checking your browser|access denied)/i.test(bodyText) ? "The website is showing an access check. Open the lead and complete it, then retry." : "";
    const schemas = [];
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        if (el.textContent.length < 1e6) schemas.push(JSON.parse(el.textContent));
      } catch {
      }
    }
    let root, description = "", vendors = [], pay = [], employment = "", jobTitle = "";
    if (linked) {
      root = first(doc, [".jobs-search__job-details--container", ".job-view-layout", ".jobs-details__main-content", ".jobs-details", "main", '[role="main"]']);
      if (root) {
        jobTitle = text2(first(root, [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"]));
        vendors = texts(root, [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link", ".topcard__flavor--black-link"]);
        description = text2(first(root, ["#job-details", ".jobs-description__content", ".jobs-description-content__text", ".show-more-less-html__markup", ".description__text"]));
        pay = texts(root, [".job-details-jobs-unified-top-card__job-insight", ".jobs-unified-top-card__job-insight", ".job-details-fit-level-preferences", ".compensation__salary", ".salary"]);
        employment = texts(root, [".job-details-jobs-unified-top-card__job-insight", ".jobs-unified-top-card__job-insight", ".job-details-fit-level-preferences", ".description__job-criteria-item"]).join("\n");
      }
      const fallback = linkedInFallback(doc, loc, root);
      root ??= fallback.root;
      jobTitle ||= fallback.jobTitle || "";
      vendors = vendors.length ? vendors : fallback.vendors || [];
      description ||= fallback.description || "";
      pay.push(...fallback.pay || []);
      employment += "\n" + (fallback.employment || "");
    } else {
      root = first(doc, ['[itemtype$="/JobPosting"]', '[data-testid="job-details"]', '[data-testid="job-detail"]', "#job-details", "#jobDetail", ".job-details", ".job_details", ".job-detail", "main", "article"]);
      if (root) {
        jobTitle = text2(first(root, ['[itemprop="title"]', '[data-testid="job-title"]', '[data-automation-id="jobPostingHeader"]', "h1"]));
        const companySelectors = ['[itemprop="hiringOrganization"]', '[data-testid="company-name"]', '[data-testid="employer-name"]', '[data-test-id="company-name"]', ".company-name", ".companyName", ".employer-name"];
        if (dice) companySelectors.unshift('[data-cy="companyNameLink"]', 'a[href*="/company-profile/"]', 'a[href*="/company/"]');
        if (monster) companySelectors.unshift('[data-testid="job-company"]', '[data-test-id="svx-job-company-name"]');
        if (zip) companySelectors.unshift('[data-testid="job-details-company-name"]', ".hiring_company_text", '[class*="JobHeader_company"]');
        vendors = texts(root, companySelectors);
        const descriptions = ['[itemprop="description"]', '[data-automation-id="jobPostingDescription"]', '[data-testid="job-description"]', '[data-test-id="job-description"]', "#jobDescription", "#job-description", "#jobDescriptionText", ".job-description", ".job_description", ".jobDescription", ".jobDescriptionSection", "#content .content-intro"];
        description = text2(first(root, descriptions));
        if (!description && jobTitle) description = text2(root).split(/Similar Jobs|Recommended Jobs|People also viewed|Related jobs/i)[0];
        pay = texts(root, ['[itemprop="baseSalary"]', '[data-testid="salary"]', '[data-testid="salary-range"]', '[data-test-id="job-salary"]', ".salary", ".salary-range", ".compensation"]);
        employment = texts(root, ['[itemprop="employmentType"]', '[data-testid="employment-type"]', '[data-testid="job-type"]', ".employment-type", ".job-type"]).join("\n");
        employment += "\n" + text2(root).split(/\n/).filter((line) => /^(?:(?:contract|full[ -]time|part[ -]time|w-?2|c2c|temporary|internship|corp to corp)[\s·,/-]*)+$/i.test(line.trim())).join("\n");
        if (dice && jobTitle) {
          const main = text2(root);
          const at = main.indexOf(jobTitle);
          const header = main.slice(at + jobTitle.length).split(/Job Details|Job Description|Similar Jobs/i)[0].slice(0, 2500);
          pay.push(header);
          employment += "\n" + header;
        }
      }
    }
    const specificJob = Boolean(jobTitle && (linked ? /\/jobs\/view\/\d+|currentJobId=\d+/.test(loc.href) : !/(?:\/search(?:[/?]|$)|\/jobs\/?(?:\?|$))/.test(loc.href)));
    const diagnostics = linked ? { jobRoot: Boolean(root), jobHeading: Boolean(jobTitle), companyCandidates: vendors.length, descriptionChars: description.length } : void 0;
    if (!blocked && !root && !schemas.length) return { url: normalizeUrl(loc.href) || loc.href, schemas: [], waiting: true, jobTitle: "", diagnostics };
    return {
      url: normalizeUrl(loc.href) || loc.href,
      schemas,
      blocked,
      diagnostics,
      jobTitle: jobTitle.slice(0, 250),
      vendors,
      pay,
      employment: employment.slice(0, 1e4),
      description: description.slice(0, 15e4),
      specificJob,
      expired: /job (?:is )?no longer available|job (?:has )?expired|position (?:has been|is) filled|no longer accepting applications/i.test((root ? text2(root) : bodyText).slice(0, 5e3))
    };
  }

  // shared/employment.ts
  var order = ["Contract", "C2C", "W2", "Full-time", "Part-time", "Temporary", "Internship"];
  var patterns = { Contract: /\bcontract(?:or|ing)?\b/i, C2C: /\b(?:c\s*2\s*c|corp(?:oration)?\s*(?:to|-)\s*corp(?:oration)?)\b/i, W2: /\bw\s*[-–]?\s*2\b/i, "Full-time": /\bfull[\s_-]*time\b/i, "Part-time": /\bpart[\s_-]*time\b/i, Temporary: /\btemporary\b/i, Internship: /\binternship\b/i };
  function notAllowed(text2, index, length) {
    const before = text2.slice(Math.max(0, index - 70), index), after = text2.slice(index + length, index + length + 50);
    return /(?:\bno|\bnot|\bwithout|\bexclude[ds]?|\bexcluding|\bdoes\s+not\s+(?:accept|allow)|\bcannot\s+(?:accept|consider)|\bdo\s+not\s+(?:accept|allow|consider))\s+(?:any\s+|a\s+|an\s+)?$/i.test(before) || /^\s*(?:(?:candidates?|arrangements?|engagements?)\s+)?(?:are\s+|is\s+)?(?:not\s+(?:accepted|allowed|available|eligible|considered)|(?:will\s+not|cannot)\s+be\s+(?:accepted|considered))/i.test(after);
  }
  function detectEmployment(structured, header = "", description = "") {
    const found = /* @__PURE__ */ new Set();
    const evidence = [];
    const scan = (text2, allowed = order) => {
      const normalized2 = text2.replace(/_/g, " ");
      for (const label of allowed) {
        const pattern = new RegExp(patterns[label].source, "gi");
        let match;
        while (match = pattern.exec(normalized2)) {
          if (notAllowed(normalized2, match.index, match[0].length)) continue;
          found.add(label);
          const snippet = normalized2.slice(Math.max(0, match.index - 35), Math.min(normalized2.length, match.index + match[0].length + 85)).replace(/\s+/g, " ").trim();
          if (snippet && !evidence.includes(snippet)) evidence.push(snippet);
          break;
        }
      }
    };
    const structuredText = (Array.isArray(structured) ? structured : [structured]).filter((v) => typeof v === "string").join(" \xB7 ");
    if (structuredText) scan(structuredText);
    if (header) scan(header);
    for (const line of description.split(/[\n\r]+/)) {
      if (/^\s*(?:position\s+type|employment\s+type|job\s+type|engagement\s+type|contract\s+type|type\s+of\s+(?:employment|position)|duration)\s*[:–-]/i.test(line) || /\b(?:this|the)\s+(?:role|position|job)\s+(?:is|will be)\b/i.test(line)) scan(line);
    }
    scan(description, ["W2", "C2C"]);
    return { employmentType: order.filter((v) => found.has(v)).join(" \xB7 "), employmentEvidence: evidence.join(" | ").slice(0, 500) };
  }

  // shared/job-extraction.ts
  var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  function decodeEntities(s) {
    return s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|dollar);/gi, (_, key) => {
      const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "\u2013", mdash: "\u2014", dollar: "$" };
      if (key[0] !== "#") return named[key.toLowerCase()] ?? _;
      const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
    });
  }
  function plainText(s) {
    return decodeEntities(s.replace(/<(script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<\/(?:p|div|li|h[1-6]|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").trim();
  }
  function clean(s, max = 250) {
    return typeof s === "string" ? plainText(s).replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function nodes(value, depth = 0) {
    if (depth > 18) return [];
    if (Array.isArray(value)) return value.flatMap((v) => nodes(v, depth + 1));
    const o = object(value);
    return Object.keys(o).length ? [o, ...Object.values(o).flatMap((v) => typeof v === "object" ? nodes(v, depth + 1) : [])] : [];
  }
  function isJob(o) {
    const type = o["@type"];
    return (Array.isArray(type) ? type : [type]).some((t) => typeof t === "string" && /(?:^|[/#])JobPosting$/.test(t));
  }
  function sameJob(a, b) {
    if (typeof a !== "string") return false;
    try {
      const x = new URL(a, b), y = new URL(b);
      return x.hostname === y.hostname && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && x.search === y.search;
    } catch {
      return false;
    }
  }
  var units = { HOUR: "hr", HOURLY: "hr", DAY: "day", DAILY: "day", WEEK: "week", WEEKLY: "week", MONTH: "month", MONTHLY: "month", YEAR: "yr", YEARLY: "yr", ANNUAL: "yr" };
  function structuredSalary(value) {
    if (Array.isArray(value)) {
      const all = [...new Set(value.map(structuredSalary).filter(Boolean))];
      return all.length === 1 ? all[0] : "";
    }
    const amount = object(value);
    const quantity = object(amount.value);
    const q = Object.keys(quantity).length ? quantity : amount;
    const num = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v) && Number(v) > 0 ? Number(v) : null;
    const lo = num(q.minValue), hi = num(q.maxValue), one = num(q.value);
    let range = "";
    const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (lo !== null && hi !== null && lo <= hi) range = lo === hi ? fmt(lo) : `${fmt(lo)}\u2013${fmt(hi)}`;
    else if (one !== null) range = fmt(one);
    else if (lo !== null && hi === null) range = `from ${fmt(lo)}`;
    else if (hi !== null && lo === null) range = `up to ${fmt(hi)}`;
    if (!range) return "";
    const currency = clean(amount.currency || q.currency, 12);
    const prefix = currency === "USD" ? "$" : currency ? currency + " " : "";
    const unit = units[clean(q.unitText || amount.unitText, 20).toUpperCase()];
    return `${prefix}${range}${unit ? "/" + unit : ""}`;
  }
  function markedText(html, attribute, token) {
    const results = [];
    const openings = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    let match;
    while (match = openings.exec(html)) {
      const attrs = match[2];
      const attr = attrs.match(new RegExp("\\b" + attribute + `\\s*=\\s*["']([^"']*)["']`, "i"));
      if (!attr || !attr[1].split(/\s+/).includes(token)) continue;
      const ending = new RegExp("<\\/" + match[1] + "\\s*>", "i").exec(html.slice(openings.lastIndex));
      if (!ending) continue;
      const value = plainText(html.slice(openings.lastIndex, openings.lastIndex + Math.min(ending.index, 4e4)));
      if (value) results.push(value);
    }
    return results;
  }
  function textSalary(text2, explicit = false) {
    const number = "\\d[\\d,]*(?:\\.\\d{1,2})?\\s*[kK]?";
    const money = "(?:US\\$|USD\\s*|CAD\\s*|AUD\\s*|GBP\\s*|EUR\\s*|[$\xA3\u20AC])\\s*" + number;
    const payUnit = "hour|hr|year|yr|annum|month|week|day";
    const repeatedUnits = new RegExp("(" + money + ")\\s*(?:/|per\\s+|an?\\s+)\\s*(" + payUnit + ")\\s*([-\u2013\u2014]|to)\\s*(" + money + ")\\s*(?:/|per\\s+|an?\\s+)\\s*(" + payUnit + ")", "gi");
    const norm = (unit) => /^(?:hour|hr)$/i.test(unit) ? "hr" : /^(?:year|yr|annum)$/i.test(unit) ? "yr" : unit.toLowerCase();
    text2 = text2.replace(repeatedUnits, (full, a, u, separator, b, v) => norm(u) === norm(v) ? `${a} ${separator} ${b}/${norm(v)}` : full);
    const pattern = new RegExp("(" + money + "(?:\\s*(?:-|\u2013|\u2014|to)\\s*(?:(?:US\\$|USD\\s*|CAD\\s*|AUD\\s*|GBP\\s*|EUR\\s*|[$\xA3\u20AC])\\s*)?" + number + ")?)(?:\\s*(?:/|per\\s+|an?\\s+)\\s*(hour|hr|year|yr|annum|month|week|day)|\\s*(hourly|annually|annual|yearly))?", "gi");
    const found = [];
    let m;
    while (m = pattern.exec(text2)) {
      const before = text2.slice(Math.max(0, m.index - 100), m.index);
      const after = text2.slice(m.index + m[0].length, m.index + m[0].length + 100);
      const nearby = before + m[0] + after;
      if (/(?:bonus|sign[- ]?on|referral|401\(?k|reimbursement|allowance|benefit|equity|stock)[^.!?\n]{0,50}$/i.test(before) && !/(?:base\s+(?:pay|salary)|pay\s+(?:rate|range)|salary\s+range)[^.!?\n]{0,45}$/i.test(before)) continue;
      const unit = m[2] || m[3];
      if (!explicit && !unit && !/(?:salary|compensation|pay\s+(?:rate|range)|hourly\s+rate|base\s+pay)[^.!?\n]{0,100}$/i.test(before)) continue;
      let rate = m[1].trim().replace(/\s+(?=[kK](?:\s|$))/g, "");
      if (unit) {
        const u = /^(?:hour|hr|hourly)$/i.test(unit) ? "hr" : /^(?:year|yr|annum|annually|annual|yearly)$/i.test(unit) ? "yr" : unit.toLowerCase();
        rate += "/" + u;
      }
      found.push({ rate, evidence: nearby.replace(/\s+/g, " ").trim().slice(0, 300) });
    }
    const unique = [...new Map(found.map((f) => [f.rate.replace(/[\s,]/g, "").replace(/–|—|to/g, "-"), f])).values()];
    return { rate: unique.length === 1 ? unique[0].rate : "", evidence: unique.length === 1 ? unique[0].evidence : "", ambiguous: unique.length > 1 };
  }
  function extractJob(html, url) {
    const result = { pageRead: true, vendor: "", rate: "", status: "unavailable", message: "", sourceUrl: url, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), vendorEvidence: "", rateEvidence: "" };
    const all = [];
    for (const s of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      try {
        all.push(...nodes(JSON.parse(s[1].trim())).filter(isJob));
      } catch {
        try {
          all.push(...nodes(JSON.parse(decodeEntities(s[1].trim()))).filter(isJob));
        } catch {
        }
      }
    }
    const jobs = [...new Map(all.map((o) => [JSON.stringify(o), o])).values()];
    const matched = jobs.filter((o) => sameJob(o.url, url) || sameJob(o["@id"], url));
    const job = matched.length === 1 ? matched[0] : jobs.length === 1 ? jobs[0] : null;
    if (jobs.length > 1 && !job) {
      result.message = "This page contains multiple jobs. Paste the URL for one specific job.";
      return result;
    }
    const title = plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    if (!job && /(?:access denied|just a moment|security verification|sign in|log in|page not found|verify you are human|captcha)/i.test(title)) {
      result.pageRead = false;
      result.message = "This page requires sign-in or blocks automatic reading. Open the lead and paste its job details, or enter the missing fields.";
      return result;
    }
    let ambiguous = false;
    if (job) {
      const hiring = job.hiringOrganization;
      const org = Array.isArray(hiring) ? hiring.length === 1 ? hiring[0] : null : hiring;
      result.vendor = clean(typeof org === "string" ? org : object(org).name);
      result.vendorEvidence = result.vendor ? "Company named in the job posting: " + result.vendor : "";
      result.rate = structuredSalary(job.baseSalary);
      if (result.rate) result.rateEvidence = "Published base salary: " + result.rate;
      if (!result.rate && typeof job.description === "string") {
        const extracted = textSalary(plainText(job.description));
        result.rate = extracted.rate;
        result.rateEvidence = extracted.evidence;
        ambiguous = extracted.ambiguous;
      }
    }
    if (!result.vendor) {
      const vendorTexts = [...markedText(html, "class", "topcard__org-name-link"), ...markedText(html, "class", "topcard__flavor--black-link"), ...markedText(html, "class", "posting-categories").filter((s) => /^company\s*:/i.test(s)), ...markedText(html, "itemprop", "hiringOrganization")];
      const unique = [...new Set(vendorTexts.map((s) => clean(s)).filter((s) => s && s.length < 180 && !/^confidential$/i.test(s)))];
      if (unique.length === 1) {
        result.vendor = unique[0];
        result.vendorEvidence = "Company shown on the job page: " + result.vendor;
      }
    }
    if (!result.rate && !ambiguous) {
      const salary = [...markedText(html, "class", "salary"), ...markedText(html, "class", "compensation__salary"), ...markedText(html, "class", "salary-range"), ...markedText(html, "itemprop", "baseSalary")];
      const content = salary.length ? salary.join("\n") : !job ? markedText(html, "class", "show-more-less-html__markup").join("\n") : "";
      if (content) {
        const extracted = textSalary(content, salary.length > 0);
        result.rate = extracted.rate;
        result.rateEvidence = extracted.evidence;
        ambiguous = extracted.ambiguous;
      }
    }
    if (/(^|\.)dice\.com$/i.test(new URL(url).hostname) && new URL(url).pathname.startsWith("/job-detail/")) {
      const start = html.search(/<h1\b/i);
      const header = start >= 0 ? plainText(html.slice(start)).split(/Job Details|Similar Jobs/i)[0] : "";
      const posted = textSalary(header, true);
      const numbers = (s) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replaceAll(",", ""))).join("|");
      if (posted.rate && (!result.rate || !result.rate.includes("/") && numbers(result.rate) === numbers(posted.rate))) {
        result.rate = posted.rate;
        result.rateEvidence = "Pay shown in the job header: " + posted.rate;
      }
    }
    const isDice = /(^|\.)dice\.com$/i.test(new URL(url).hostname) && new URL(url).pathname.startsWith("/job-detail/");
    const h1end = html.search(/<\/h1\s*>/i);
    const diceHeader = isDice && h1end >= 0 ? plainText(html.slice(h1end + 5)).split(/Job Details|Similar Jobs/i)[0] : "";
    const criteria = [...markedText(html, "class", "description__job-criteria-item"), ...markedText(html, "itemprop", "employmentType")].join("\n");
    const description = typeof job?.description === "string" ? plainText(job.description) : markedText(html, "class", "show-more-less-html__markup").join("\n");
    Object.assign(result, detectEmployment(job?.employmentType, [diceHeader, criteria].filter(Boolean).join("\n"), description));
    const missing = [!result.vendor ? "Company" : "", !result.rate ? "Rate" : "", !result.employmentType ? "Employment type" : ""].filter(Boolean);
    result.status = missing.length === 0 ? "complete" : result.vendor || result.rate || result.employmentType ? "partial" : "unavailable";
    result.message = ambiguous ? "Multiple pay figures found. Review the job page and enter the applicable rate." : result.status === "complete" ? "Company, published rate and employment type read from the job page. Please review before sharing." : result.status === "partial" ? `${missing.join(" and ")} not disclosed in readable job details. You can edit these fields.` : "No readable job details found. The page may require JavaScript or sign-in; paste the job description or enter the details.";
    if (job && typeof job.validThrough === "string" && Date.parse(job.validThrough) < Date.now()) result.message = "This posting is marked expired. " + result.message;
    return result;
  }

  // src/extract.js
  var clean2 = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  function extractSnapshot(s) {
    const base = { vendor: "", rate: "", employmentType: "", jobTitle: clean2(s.jobTitle).slice(0, 250), sourceUrl: s.url, evidence: {}, diagnostics: s.diagnostics, status: "unavailable", message: "" };
    if (s.blocked) return { ...base, status: "blocked", message: s.blocked };
    if (s.waiting) return { ...base, status: "loading", message: "Waiting for the job content to appear." };
    const scripts = (s.schemas ?? []).map((j) => '<script type="application/ld+json">' + JSON.stringify(j).replace(/</g, "\\u003c") + "<\/script>").join("");
    const parsed = extractJob(scripts, s.url);
    if (/multiple jobs/i.test(parsed.message) && !s.specificJob) return { ...base, message: "This is a list of jobs. Use the URL for one specific job." };
    const vendorChoices = [...new Set((s.vendors ?? []).map(clean2).filter((v) => v && v.length < 200 && !/^(?:company|employer|confidential|follow|view company)$/i.test(v)))];
    base.vendor = parsed.vendor || (vendorChoices.length === 1 ? vendorChoices[0] : "");
    base.evidence.vendor = parsed.vendorEvidence || (base.vendor ? "Company on the job page: " + base.vendor : "");
    let pay = textSalary((s.pay ?? []).join("\n"), true);
    if (!pay.rate && !pay.ambiguous) pay = textSalary(s.description ?? "");
    base.rate = parsed.rate || pay.rate;
    const numbers = (v) => (v.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replaceAll(",", ""))).join("|");
    if (parsed.rate && pay.rate && !parsed.rate.includes("/") && numbers(parsed.rate) === numbers(pay.rate)) base.rate = pay.rate;
    base.evidence.rate = base.rate === pay.rate ? pay.evidence : parsed.rateEvidence;
    const employment = detectEmployment(parsed.employmentType, s.employment ?? "", s.description ?? "");
    base.employmentType = employment.employmentType;
    base.evidence.employment = employment.employmentEvidence;
    const count = [base.vendor, base.rate, base.employmentType].filter(Boolean).length;
    base.contentLength = (s.description ?? "").length;
    base.contentReady = base.contentLength > 0 || parsed.status === "complete";
    base.status = count === 3 ? "complete" : count ? "partial" : !s.jobTitle && !s.description ? "loading" : "unavailable";
    base.message = count === 3 ? "Read from the job page." : count ? "Some details were not stated or could not be identified. Edit any missing fields." : "No job details could be identified. Open the lead to check access or retry after it loads.";
    if (pay.ambiguous && !parsed.rate) base.message = "Multiple pay amounts found. Check which range applies and edit the rate.";
    if (/marked expired/.test(parsed.message) || s.expired) base.message = "This posting appears expired. " + base.message;
    return base;
  }

  // src/capture.js
  function readCurrentPage() {
    return extractSnapshot(collectSnapshot(document, location));
  }
  return __toCommonJS(capture_exports);
})();
LeadLedgerCapture.readCurrentPage();
