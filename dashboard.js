// src/model.js
var ND = "Not disclosed";
var missing = (v) => !String(v ?? "").trim() || /^not\s+disclosed?$/i.test(String(v).trim());
var today = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function validDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = /* @__PURE__ */ new Date(v + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
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
function sourceName(value) {
  try {
    const h = new URL(value).hostname.replace(/^www\./, "");
    for (const [domain, name] of [["linkedin.com", "LinkedIn"], ["dice.com", "Dice"], ["monster.com", "Monster"], ["ziprecruiter.com", "ZipRecruiter"]]) if (h === domain || h.endsWith("." + domain)) return name;
    return h;
  } catch {
    return "";
  }
}
function csvCell(value) {
  const str = String(value ?? "");
  return '"' + (/^[\s]*[=+@-]/.test(str) ? "'" + str : str).replaceAll('"', '""') + '"';
}
function csvReport(rows) {
  return "\uFEFF" + [["Lead URL", "Rate", "Vendor name", "Job type"], ...rows.map((r) => [r.url, r.rate || ND, r.vendor || ND, r.employmentType || ND])].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
function excelPasteReport(rows) {
  const cell = (value) => {
    let text = String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
    if (/^[\s]*[=+@]/.test(text)) text = "'" + text;
    return text;
  };
  return [["Lead URL", "Rate", "Vendor name", "Job type"], ...rows.map((r) => [r.url, r.rate || ND, r.vendor || ND, r.employmentType || ND])].map((row) => row.map(cell).join("\t")).join("\r\n");
}

// shared/rate-sort.ts
var periodOrder = ["hour", "year", "month", "week", "day", "unknown", "missing"];
function rateInfo(value) {
  const text = value.trim();
  const period = /\b(?:hr|hrs|hour|hours|hourly)\b/i.test(text) ? "hour" : /\b(?:yr|year|annual|annually|yearly|annum)\b/i.test(text) ? "year" : /\b(?:month|monthly)\b/i.test(text) ? "month" : /\b(?:week|weekly)\b/i.test(text) ? "week" : /\b(?:day|daily)\b/i.test(text) ? "day" : "unknown";
  const currency = /\bCAD\b|CA\$/i.test(text) ? "CAD" : /\bAUD\b|AU\$/i.test(text) ? "AUD" : /\bEUR\b|€/.test(text) ? "EUR" : /\bGBP\b|£/.test(text) ? "GBP" : /\bUSD\b|\$/.test(text) ? "USD" : /\bINR\b|₹/.test(text) ? "INR" : "Unspecified currency";
  const numericText = text.replace(/\b(?:w-?2|c2c|1099)\b/gi, "").split(/\s*(?:\/|per\s+|an?\s+)(?:hr|hour|yr|year|annum|month|week|day)/i)[0];
  const matches = [...numericText.matchAll(/\d[\d,]*(?:\.\d+)?\s*([kK])?/g)];
  let amounts = matches.map((m) => Number(m[0].replace(/[kK,\s]/g, "")) * (m[1] ? 1e3 : 1)).filter((n) => Number.isFinite(n) && n > 0);
  if (matches.length === 2 && !matches[0][1] && matches[1][1] && amounts[0] < 1e3) amounts = [amounts[0] * 1e3, amounts[1]];
  if (!amounts.length || /not disclosed|depends on experience|\bDOE\b/i.test(text)) return { amount: null, low: null, period: "missing", currency: "", group: "Rate not disclosed" };
  const labels = { hour: "Hourly", year: "Yearly", month: "Monthly", week: "Weekly", day: "Daily", unknown: "Pay period not stated" };
  return { amount: Math.max(...amounts), low: Math.min(...amounts), period, currency, group: `${labels[period]} \xB7 ${currency === "USD" ? "USD / $" : currency}` };
}
function sortLeads(rows, direction = "high") {
  if (direction === "original") return [...rows];
  return rows.map((row, index) => ({ row, index, rate: rateInfo(row.rate) })).sort((a, b) => {
    const group = periodOrder.indexOf(a.rate.period) - periodOrder.indexOf(b.rate.period);
    if (group) return group;
    if (a.rate.amount === null || b.rate.amount === null) return a.index - b.index;
    const currency = (a.rate.currency === "USD" ? "0" : a.rate.currency).localeCompare(b.rate.currency === "USD" ? "0" : b.rate.currency);
    if (currency) return currency;
    const diff = a.rate.amount - b.rate.amount || a.rate.low - b.rate.low;
    return (direction === "high" ? -diff : diff) || a.index - b.index;
  }).map((x) => x.row);
}
function matchesPeriod(rate, filter) {
  return filter === "all" || rateInfo(rate).period === filter;
}

// shared/employment.ts
var patterns = { Contract: /\bcontract(?:or|ing)?\b/i, C2C: /\b(?:c\s*2\s*c|corp(?:oration)?\s*(?:to|-)\s*corp(?:oration)?)\b/i, W2: /\bw\s*[-–]?\s*2\b/i, "Full-time": /\bfull[\s_-]*time\b/i, "Part-time": /\bpart[\s_-]*time\b/i, Temporary: /\btemporary\b/i, Internship: /\binternship\b/i };
function matchesEmployment(value, filter) {
  if (filter === "all") return true;
  if (filter === "unknown") return !value?.trim() || /^not disclosed$/i.test(value.trim());
  const pattern = patterns[filter];
  return pattern ? pattern.test(value ?? "") : false;
}

// src/excel-template.json
var excel_template_default = {
  parts: {
    "xl/workbook.xml": '<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Lead report" sheetId="1" r:id="R03cf3ccfddca47e9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>',
    "xl/styles.xml": '<?xml version="1.0" encoding="utf-8"?><x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:fonts count="6"><x:font><x:sz val="11" /><x:name val="Carlito" /></x:font><x:font><x:sz val="11" /><x:color rgb="FF202020" /><x:name val="Calibri" /></x:font><x:font><x:b /><x:sz val="20" /><x:color rgb="FFFFFFFF" /><x:name val="Calibri" /></x:font><x:font><x:sz val="11" /><x:color rgb="FF555555" /><x:name val="Calibri" /></x:font><x:font><x:sz val="10" /><x:color rgb="FF666666" /><x:name val="Calibri" /></x:font><x:font><x:b /><x:sz val="11" /><x:color rgb="FFFFFFFF" /><x:name val="Calibri" /></x:font></x:fonts><x:fills count="6"><x:fill><x:patternFill patternType="none" /></x:fill><x:fill><x:patternFill patternType="gray125" /></x:fill><x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF171717" /></x:patternFill></x:fill><x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF242424" /></x:patternFill></x:fill><x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FFFFFFFF" /></x:patternFill></x:fill><x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FFF2F2F2" /></x:patternFill></x:fill></x:fills><x:borders count="1"><x:border /></x:borders><x:cellStyleXfs count="1"><x:xf numFmtId="0" fontId="0" fillId="0" borderId="0" /></x:cellStyleXfs><x:cellXfs count="13"><x:xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" /><x:xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment wrapText="1" /></x:xf><x:xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" /><x:xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment wrapText="1" /></x:xf><x:xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment vertical="center" wrapText="1" /></x:xf><x:xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment vertical="center" wrapText="1" /></x:xf><x:xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment vertical="center" wrapText="1" /></x:xf></x:cellXfs><x:cellStyles count="1"><x:cellStyle name="Normal" xfId="0" /></x:cellStyles></x:styleSheet>',
    "xl/theme/theme1.xml": '<?xml version="1.0" encoding="utf-8"?><a:theme name="ChatGPT" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="ChatGPT"><a:dk1><a:sysClr val="windowText" lastClr="000000" /></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF" /></a:lt1><a:dk2><a:srgbClr val="0E2841" /></a:dk2><a:lt2><a:srgbClr val="E8E8E8" /></a:lt2><a:accent1><a:srgbClr val="156082" /></a:accent1><a:accent2><a:srgbClr val="E97132" /></a:accent2><a:accent3><a:srgbClr val="196B24" /></a:accent3><a:accent4><a:srgbClr val="0F9ED5" /></a:accent4><a:accent5><a:srgbClr val="A02B93" /></a:accent5><a:accent6><a:srgbClr val="4EA72E" /></a:accent6><a:hlink><a:srgbClr val="467886" /></a:hlink><a:folHlink><a:srgbClr val="96607D" /></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" /><a:ea typeface="Calibri Light" /><a:cs typeface="Calibri Light" /></a:majorFont><a:minorFont><a:latin typeface="Calibri" /><a:ea typeface="Calibri" /><a:cs typeface="Calibri" /></a:minorFont></a:fontScheme><a:fmtScheme name="ChatGPT"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr" /></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="67000" /><a:lumMod val="110000" /><a:satMod val="105000" /></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="73000" /><a:lumMod val="105000" /><a:satMod val="103000" /></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="81000" /><a:lumMod val="105000" /><a:satMod val="109000" /></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0" /></a:gradFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="94000" /><a:lumMod val="102000" /><a:satMod val="103000" /></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:shade val="100000" /><a:lumMod val="100000" /><a:satMod val="110000" /></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="78000" /><a:lumMod val="99000" /><a:satMod val="120000" /></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0" /></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr" /></a:solidFill><a:prstDash val="solid" /></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr" /></a:solidFill><a:prstDash val="solid" /></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr" /></a:solidFill><a:prstDash val="solid" /></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst /></a:effectStyle><a:effectStyle><a:effectLst /></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000"><a:srgbClr val="000000"><a:alpha val="63000" /></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr" /></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000" /><a:satMod val="170000" /></a:schemeClr></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000" /><a:shade val="98000" /><a:lumMod val="102000" /><a:satMod val="150000" /></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000" /><a:shade val="90000" /><a:lumMod val="103000" /><a:satMod val="130000" /></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000" /><a:satMod val="120000" /></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0" /></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
    "xl/sharedStrings.xml": '<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" />',
    "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetViews><x:sheetView showGridLines="0" workbookViewId="0" /></x:sheetViews><x:sheetFormatPr defaultRowHeight="15" /><x:cols><x:col min="1" max="1" width="78" hidden="0" customWidth="1" /><x:col min="2" max="2" width="25" hidden="0" customWidth="1" /><x:col min="3" max="3" width="34" hidden="0" customWidth="1" /><x:col min="4" max="4" width="29" hidden="0" customWidth="1" /></x:cols><x:sheetData><x:row r="1" ht="40" customHeight="1"><x:c r="A1" s="3" t="str"><x:v>Daily leads report</x:v></x:c><x:c r="B1" s="3" /><x:c r="C1" s="3" /><x:c r="D1" s="3" /></x:row><x:row r="2" ht="27" customHeight="1"><x:c r="A2" s="4" t="str"><x:v>Report date \xB7 2026-09-03   |   Exported leads \xB7 2</x:v></x:c><x:c r="B2" s="4" /><x:c r="C2" s="4" /><x:c r="D2" s="4" /></x:row><x:row r="3" ht="28" customHeight="1"><x:c r="A3" s="6" t="str"><x:v>Editable report \u2022 Rate order and filters match the extension view. Rates with different units/currencies are grouped.</x:v></x:c><x:c r="B3" s="6" /><x:c r="C3" s="6" /><x:c r="D3" s="6" /></x:row><x:row r="4" ht="29" customHeight="1"><x:c r="A4" s="8" t="str"><x:v>Lead URL</x:v></x:c><x:c r="B4" s="8" t="str"><x:v>Rate</x:v></x:c><x:c r="C4" s="8" t="str"><x:v>Vendor name</x:v></x:c><x:c r="D4" s="8" t="str"><x:v>Job type</x:v></x:c></x:row><x:row r="5" ht="38" customHeight="1"><x:c r="A5" s="11" t="str"><x:v>https://jobs.example.com/job/123</x:v></x:c><x:c r="B5" s="11" t="str"><x:v>$85\u201390/hr</x:v></x:c><x:c r="C5" s="11" t="str"><x:v>Example company</x:v></x:c><x:c r="D5" s="11" t="str"><x:v>Contract \xB7 W2</x:v></x:c></x:row><x:row r="6" ht="38" customHeight="1"><x:c r="A6" s="12" t="str"><x:v>https://careers.example.com/job/456</x:v></x:c><x:c r="B6" s="12" t="str"><x:v>Not disclosed</x:v></x:c><x:c r="C6" s="12" t="str"><x:v>Example employer</x:v></x:c><x:c r="D6" s="12" t="str"><x:v>Full-time</x:v></x:c></x:row></x:sheetData><x:mergeCells><x:mergeCell ref="A1:D1" /><x:mergeCell ref="A2:D2" /><x:mergeCell ref="A3:D3" /></x:mergeCells><x:pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" /><x:tableParts count="1"><x:tablePart r:id="Re70be2a344f7460b" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:tableParts></x:worksheet>',
    "xl/tables/table1.xml": '<?xml version="1.0" encoding="utf-8"?><x:table id="1" name="LeadReport" displayName="LeadReport" ref="A4:D6" headerRowCount="1" totalsRowCount="0" totalsRowShown="0" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:autoFilter ref="A4:D6" /><x:tableColumns count="4"><x:tableColumn id="1" name="Lead URL" /><x:tableColumn id="2" name="Rate" /><x:tableColumn id="3" name="Vendor name" /><x:tableColumn id="4" name="Job type" /></x:tableColumns><x:tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0" /></x:table>',
    "_rels/.rels": '\uFEFF<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="R4a8c48e25a624d9f" /></Relationships>',
    "xl/_rels/workbook.xml.rels": '\uFEFF<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml" Id="Re9ade7927ff44f79" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="/xl/theme/theme1.xml" Id="R65599f5511f04df9" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml" Id="Rc573a0cdf56a4cb0" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R03cf3ccfddca47e9" /></Relationships>',
    "xl/worksheets/_rels/sheet1.xml.rels": '\uFEFF<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="/xl/tables/table1.xml" Id="Re70be2a344f7460b" /></Relationships>',
    "[Content_Types].xml": '\uFEFF<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" /><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml" /><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" /></Types>'
  },
  styles: {
    title: "3",
    meta: "4",
    note: "6",
    header: "8",
    odd: "11",
    even: "12"
  }
};

// src/excel.js
var enc = new TextEncoder();
var xml = (value) => String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
var crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 3988292384 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
var crc32 = (bytes) => {
  let n = 4294967295;
  for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ n >>> 8;
  return (n ^ 4294967295) >>> 0;
};
function join(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
function zip(parts) {
  const files = [], directory = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const path = enc.encode(name), body = enc.encode(content), crc = crc32(body), head = new Uint8Array(30), h = new DataView(head.buffer);
    h.setUint32(0, 67324752, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 2048, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true);
    h.setUint32(22, body.length, true);
    h.setUint16(26, path.length, true);
    files.push(head, path, body);
    const center = new Uint8Array(46), c = new DataView(center.buffer);
    c.setUint32(0, 33639248, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 2048, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, body.length, true);
    c.setUint16(28, path.length, true);
    c.setUint32(42, offset, true);
    directory.push(center, path);
    offset += head.length + path.length + body.length;
  }
  const dir = join(directory), end = new Uint8Array(22), e = new DataView(end.buffer), count = Object.keys(parts).length;
  e.setUint32(0, 101010256, true);
  e.setUint16(8, count, true);
  e.setUint16(10, count, true);
  e.setUint32(12, dir.length, true);
  e.setUint32(16, offset, true);
  return join([...files, dir, end]);
}
function excelReport(rows, { title = "Daily leads report", date: date2 = "", note = "" } = {}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error("Export between 1 and 500 leads.");
  const styles = excel_template_default.styles, parts = { ...excel_template_default.parts }, last = rows.length + 4;
  const cell = (ref, value, style) => `<x:c r="${ref}" s="${style}" t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value)}</x:t></x:is></x:c>`;
  const row = (n, values, style, height) => `<x:row r="${n}" ht="${height}" customHeight="1">${values.map((v, i) => cell("ABCD"[i] + n, v, style)).join("")}</x:row>`;
  const content = [row(1, [title, "", "", ""], styles.title, 40), row(2, [`Report date \xB7 ${date2}   |   Exported leads \xB7 ${rows.length}`, "", "", ""], styles.meta, 27), row(3, [(note ? note + " " : "") + "Not disclosed = no value obtained; check flagged leads in the extension.", "", "", ""], styles.note, 32), row(4, ["Lead URL", "Rate", "Vendor name", "Job type"], styles.header, 29)];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    content.push(row(i + 5, [r.url, r.rate || ND, r.vendor || ND, r.employmentType || ND], i % 2 ? styles.even : styles.odd, Math.min(160, Math.max(38, Math.ceil(String(r.url).length / 74) * 15))));
  }
  const ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const links = rows.map((r, i) => normalizeUrl(r.url) ? `<x:hyperlink ref="A${i + 5}" r:id="rIdLead${i + 1}" xmlns:r="${ns}"/>` : "").join("");
  let sheet = parts["xl/worksheets/sheet1.xml"].replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/, `<x:sheetData>${content.join("")}</x:sheetData>`);
  sheet = sheet.replace(/<x:sheetViews>[\s\S]*?<\/x:sheetViews>/, `<x:dimension ref="A1:D${last}"/><x:sheetViews><x:sheetView showGridLines="0" workbookViewId="0"><x:pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><x:selection pane="bottomLeft" activeCell="A5" sqref="A5"/></x:sheetView></x:sheetViews>`);
  sheet = sheet.replace("</x:mergeCells>", "</x:mergeCells><x:hyperlinks>" + links + "</x:hyperlinks>");
  parts["xl/worksheets/sheet1.xml"] = sheet;
  parts["xl/tables/table1.xml"] = parts["xl/tables/table1.xml"].replaceAll("A4:D6", `A4:D${last}`);
  const relationships = rows.map((r, i) => normalizeUrl(r.url) ? `<Relationship Id="rIdLead${i + 1}" Type="${ns}/hyperlink" Target="${xml(r.url)}" TargetMode="External"/>` : "").join("");
  parts["xl/worksheets/_rels/sheet1.xml.rels"] = parts["xl/worksheets/_rels/sheet1.xml.rels"].replace("</Relationships>", relationships + "</Relationships>");
  return zip(parts);
}

// src/dashboard.js
var $ = (id) => document.getElementById(id);
var state = { reports: {}, runner: {} };
var date = today();
var visible = [];
var inFlight = 0;
var lastTableKey = "";
var safe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var dateText = (v) => (/* @__PURE__ */ new Date(v + "T12:00:00")).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
var send = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "The extension did not respond. Reload it from Chrome extensions.");
  return result.data;
};
var notify = (message, error = false) => {
  $("feedback").textContent = message;
  $("feedback").classList.toggle("error", error);
};
async function action(message, success = "") {
  try {
    inFlight++;
    $("save-state").textContent = "Saving\u2026";
    const result = await send(message);
    state = await send({ type: "get" });
    if (success) notify(success);
    paint();
    return result;
  } catch (e) {
    notify(e.message, true);
    $("save-state").textContent = "Could not save \u2014 retry";
    throw e;
  } finally {
    inFlight--;
  }
}
function rowHTML(r, index) {
  const labels = { complete: "Details found", partial: "Some details found", blocked: "Needs review", unavailable: "Needs review", queued: "Queued", reading: "Reading\u2026" };
  const input = (field, value) => `<input class="cell no-print" data-id="${r.id}" data-field="${field}" aria-label="Lead ${index + 1} ${field}" maxlength="${field === "url" ? 4e3 : 250}" value="${safe(value)}"><span class="print-only">${safe(value || ND)}</span>`;
  const run = state.runner;
  const locked = ["running", "paused"].includes(run.status) && run.date === date;
  return `<tr><td><div class="url-line"><span class="number">${String(index + 1).padStart(2, "0")}</span>${input("url", r.url)}<a class="open no-print" href="${safe(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open lead ${index + 1}">\u2197</a></div><div class="row-meta no-print"><span>${safe(sourceName(r.url))}</span><span class="badge ${r.status === "complete" ? "ok" : ""}">${safe(labels[r.status] || "Review")}</span></div><details class="evidence no-print"><summary>${safe(r.jobTitle || "Reading details")}</summary><p>${safe(r.message)}</p>${Object.entries(r.evidence ?? {}).filter(([, v]) => v).map(([k, v]) => `<p><b>${safe(k)}:</b> ${safe(v)}</p>`).join("")}${r.checkedAt ? `<p>Read: ${safe(new Date(r.checkedAt).toLocaleString())}</p>` : ""}<button data-retry="${r.id}" ${locked ? "disabled" : ""}>Retry this lead</button></details></td><td>${input("rate", r.rate)}</td><td>${input("vendor", r.vendor)}</td><td>${input("employmentType", r.employmentType)}</td><td class="no-print"><button class="remove" data-remove="${r.id}" aria-label="Remove lead ${index + 1}" ${locked ? "disabled" : ""}>\xD7</button></td></tr>`;
}
function paint() {
  const report = state.reports[date] ?? { title: "Daily leads report", rows: [] };
  const q = state.runner;
  const busy = ["running", "paused"].includes(q.status);
  $("date").value = date;
  if (document.activeElement !== $("title")) $("title").value = report.title;
  $("print-title").textContent = report.title;
  $("date-label").textContent = dateText(date);
  $("footer-date").textContent = dateText(date);
  $("history").innerHTML = '<option value="">Saved reports</option>' + Object.keys(state.reports).sort().reverse().map((d) => `<option value="${d}">${safe(dateText(d))} \xB7 ${state.reports[d].rows.length} leads</option>`).join("");
  $("batch").hidden = !q.total;
  $("batch-label").textContent = q.status === "done" ? "Batch complete" : q.status === "stopped" ? "Batch stopped" : q.status === "paused" ? "Reading paused" : "Reading your job pages";
  const modeNames = { fast: "Smart Silent \xB7 current tab untouched \xB7 max 2 workers", balanced: "Low CPU Silent \xB7 1 worker", thorough: "Thorough Silent \xB7 max 2 workers" };
  $("batch-detail").textContent = `${q.done ?? 0} of ${q.total ?? 0} checked \xB7 ${(q.active ?? []).length} reading${q.speed ? " \xB7 " + modeNames[q.speed] : ""}${q.date ? " \xB7 " + dateText(q.date) : ""}${q.error ? " \xB7 " + q.error : ""}`;
  $("progress").max = q.total || 1;
  $("progress").value = q.done || 0;
  $("pause").hidden = q.status !== "running";
  $("resume").hidden = q.status !== "paused";
  $("end").hidden = !busy;
  $("start").disabled = busy;
  $("retry").disabled = busy || !report.rows.some((r) => r.status !== "complete");
  $("clear").disabled = busy || !report.rows.length;
  $("restore").disabled = busy;
  $("speed").disabled = busy;
  $("saved-at").textContent = report.updatedAt ? "Last saved " + new Date(report.updatedAt).toLocaleTimeString() : "";
  if (!inFlight) $("save-state").textContent = "Automatically saved";
  if (document.activeElement?.matches("[data-field]")) return;
  const tableKey = JSON.stringify([date, report.revision, report.updatedAt, report.title, busy, $("type").value, $("period").value, $("status").value, $("sort").value]);
  if (lastTableKey === tableKey) return;
  lastTableKey = tableKey;
  visible = sortLeads(report.rows.filter((r) => matchesEmployment(r.employmentType, $("type").value) && matchesPeriod(r.rate, $("period").value) && ($("status").value === "all" || ($("status").value === "complete" ? r.status === "complete" : r.status !== "complete"))), $("sort").value);
  $("total").textContent = String(visible.length).padStart(2, "0");
  $("vendors").textContent = String(new Set(visible.filter((r) => !missing(r.vendor)).map((r) => r.vendor.toLowerCase())).size).padStart(2, "0");
  $("review").textContent = String(visible.filter((r) => r.status !== "complete").length).padStart(2, "0");
  $("shown").textContent = `${visible.length} of ${report.rows.length} leads`;
  $("sort-note").textContent = ($("sort").value === "original" ? "Original order." : `Rates ${$("sort").value === "high" ? "high to low" : "low to high"}, using the highest amount in each range. Grouped by pay period and currency; hourly first.`) + ` Filters: ${$("type").selectedOptions[0].text}, ${$("period").selectedOptions[0].text}, ${$("status").selectedOptions[0].text}.`;
  $("rows").innerHTML = visible.map((r, i) => ($("sort").value !== "original" && (i === 0 || rateInfo(r.rate).group !== rateInfo(visible[i - 1].rate).group) ? `<tr class="group"><td colspan="5">${safe(rateInfo(r.rate).group)}</td></tr>` : "") + rowHTML(r, i)).join("");
  $("empty").hidden = visible.length > 0;
  $("empty").querySelector("h3").textContent = report.rows.length ? "No leads match these filters." : "Your report starts here.";
  $("empty").querySelector("p").textContent = report.rows.length ? "Choose All types, All periods and All leads to show the full report." : "Paste your job links above and click Read leads & build report.";
  $("copy").disabled = !visible.length;
  $("csv").disabled = !visible.length;
  $("xlsx").disabled = !visible.length;
  $("print").disabled = !visible.length;
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5e3);
}
async function begin(retry = false, ids) {
  const result = await action({ type: "start", date, urls: retry ? void 0 : $("urls").value, retry, ids, foreground: false, speed: $("speed").value }, "Silent background reading started. Your current tab will not be switched; worker pages stay minimized and close automatically.");
  if (result && !retry) {
    $("urls").value = "";
    await chrome.storage.local.remove("leadLedgerDraft");
  }
}
var catchEvent = (fn) => (...args) => {
  Promise.resolve().then(() => fn(...args)).catch((e) => notify(e.message, true));
};
$("start").addEventListener("click", catchEvent(() => begin()));
$("retry").addEventListener("click", catchEvent(() => begin(true)));
$("clear").addEventListener("click", catchEvent(async () => {
  const count = state.reports[date]?.rows?.length ?? 0;
  if (!count) return;
  if (!confirm(`Remove all ${count} leads from this report? This clears the table so you can start the next technology.`)) return;
  const result = await action({ type: "clear", date });
  notify(`${result.removed} leads removed. The report is ready for your next technology.`);
}));
for (const type of ["pause", "resume", "end"]) $(type).addEventListener("click", catchEvent(() => action({ type })));
$("date").addEventListener("change", () => {
  if (validDate($("date").value)) {
    date = $("date").value;
    paint();
  }
});
$("history").addEventListener("change", () => {
  if ($("history").value) {
    date = $("history").value;
    paint();
  }
});
for (const id of ["type", "period", "sort", "status"]) $(id).addEventListener("change", paint);
$("title").addEventListener("change", catchEvent(() => action({ type: "title", date, title: $("title").value })));
$("rows").addEventListener("change", catchEvent((e) => {
  const el = e.target;
  if (el.dataset.field) return action({ type: "patch", date, id: el.dataset.id, field: el.dataset.field, value: el.value });
}));
$("rows").addEventListener("focusout", () => setTimeout(paint, 30));
$("rows").addEventListener("click", catchEvent((e) => {
  const retry = e.target.closest("[data-retry]");
  if (retry) return begin(true, [retry.dataset.retry]);
  const remove = e.target.closest("[data-remove]");
  if (remove && confirm("Remove this lead from the daily report?")) return action({ type: "remove", date, id: remove.dataset.remove });
}));
$("copy").addEventListener("click", catchEvent(async () => {
  const text = excelPasteReport(visible);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    if (!document.execCommand("copy")) throw new Error("Chrome could not copy the table. Try again or use Export Excel.");
    box.remove();
  }
  notify(`${visible.length} leads copied as an Excel-ready table. Paste directly into Excel or Google Sheets.`);
}));
$("csv").addEventListener("click", () => download(`leads-${date}.csv`, csvReport(visible), "text/csv;charset=utf-8"));
$("xlsx").addEventListener("click", catchEvent(() => {
  if (inFlight) throw new Error("An edit is still saving. Please export again in a moment.");
  const report = state.reports[date];
  download(`leads-${date}.xlsx`, excelReport(visible, { title: report?.title || "Daily leads report", date, note: $("sort-note").textContent }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  notify("Excel report downloaded. Open it in Excel or import into Google Sheets to edit.");
}));
$("print").addEventListener("click", () => window.print());
$("backup").addEventListener("click", catchEvent(async () => {
  const data = await send({ type: "backup" });
  download(`report-from-leads-backup-${today()}.json`, JSON.stringify({ schema: 1, reports: data.reports }, null, 2), "application/json");
}));
$("restore").addEventListener("click", () => $("restore-file").click());
$("restore-file").addEventListener("change", catchEvent(async () => {
  const file = $("restore-file").files[0];
  if (!file) return;
  if (file.size > 15e6) throw new Error("This backup is too large.");
  const data = JSON.parse(await file.text());
  const result = await action({ type: "restore", data });
  notify(`${result.added} new leads restored. Existing leads were kept.`);
  $("restore-file").value = "";
}));
var draftTimer;
$("urls").addEventListener("input", () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => chrome.storage.local.set({ leadLedgerDraft: $("urls").value }), 350);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.leadLedger?.newValue) {
    state = changes.leadLedger.newValue;
    paint();
  }
});
try {
  state = await send({ type: "get" });
  $("urls").value = (await chrome.storage.local.get("leadLedgerDraft")).leadLedgerDraft ?? "";
  paint();
} catch (e) {
  notify(e.message, true);
}
