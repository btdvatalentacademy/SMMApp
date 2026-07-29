import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ClipboardCheck,
  CalendarDays,
  BarChart3,
  Sliders,
  Upload,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Download,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* design tokens: navy and white only                                  */
/* ------------------------------------------------------------------ */

const NAVY = "#0C4876";
const BLACK = "#000000";
const GREY = "#555555";
const GREY_MID = "#9A9A9A";
const TINT = "#F4F4F4";
const TINT_2 = "#E4E4E4";
const LINE = "#D4D4D4";
const WHITE = "#FFFFFF";

/* sidebar text ramp */
const SIDE_DIM = "#8C8C8C";
const SIDE_BODY = "#D6D6D6";

const DISPLAY = "'Archivo', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const BODY = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const UTIL = "'Archivo', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const HARD = { boxShadow: `4px 4px 0 ${BLACK}` };
const HARD_SM = { boxShadow: `2px 2px 0 ${BLACK}` };

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

const fallbackStore = {};

async function loadKey(key, fallback) {
  try {
    const r = await window.storage.get(key);
    if (r && r.value) return JSON.parse(r.value);
    return fallback;
  } catch (e) {
    if (key in fallbackStore) return fallbackStore[key];
    return fallback;
  }
}

async function saveKey(key, value) {
  fallbackStore[key] = value;
  try {
    await window.storage.set(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

const K_INDEX = "contentops:index";
const coreKey = (id) => `contentops:client:${id}:core`;
const fileKey = (id) => `contentops:client:${id}:file`;

/* writes are debounced so typing in admin settings does not fire a save per keystroke */
const saveTimers = {};
function saveSoon(key, value, wait) {
  if (saveTimers[key]) clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => saveKey(key, value), wait || 700);
}

async function deleteKey(key) {
  delete fallbackStore[key];
  try {
    await window.storage.delete(key);
    return true;
  } catch (e) {
    return false;
  }
}

const DEFAULT_SETTINGS = {
  platforms: ["Instagram", "Facebook", "LinkedIn", "TikTok"],
  pillars: ["Educate", "Authority", "Behind the Scenes", "Social Proof", "Promotion"],
  contentTypes: ["Static Graphic", "Carousel", "Reel", "Story", "Text Post"],
  statuses: ["Draft", "For Review", "Approved", "Scheduled", "Published"],
  postingDays: [1, 3, 5],
  captionRules:
    "Plain declarative sentences. No em dashes. Exactly five hashtags at the end of every caption. One clear call to action.",
};

function emptyCore() {
  return {
    settings: DEFAULT_SETTINGS,
    strategy: {},
    calendar: { rows: [] },
    reports: [],
  };
}

function normalizeCore(c) {
  const base = emptyCore();
  const src = c || {};
  return {
    settings: { ...base.settings, ...(src.settings || {}) },
    strategy: src.strategy || {},
    calendar: src.calendar && src.calendar.rows ? src.calendar : { rows: [] },
    reports: Array.isArray(src.reports) ? src.reports : [],
  };
}

/* ------------------------------------------------------------------ */
/* claude api                                                          */
/* ------------------------------------------------------------------ */

async function askClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error("No response came back. Try again in a moment.");
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJson(raw) {
  let t = String(raw || "").replace(/```json/g, "").replace(/```/g, "").trim();
  const marks = [t.indexOf("{"), t.indexOf("[")].filter((n) => n >= 0);
  if (marks.length) {
    const first = Math.min(...marks);
    if (first > 0) t = t.slice(first);
  }
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (last >= 0) t = t.slice(0, last + 1);
  return JSON.parse(t);
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function todayISO() {
  return toISO(new Date());
}

function addDaysISO(iso, n) {
  const d = isoToDate(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

function isoToDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmtDate(iso) {
  const d = isoToDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* handles quoted fields and commas inside captions */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim().length));
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function safeName(name) {
  return String(name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsText(file);
  });
}

/* status fill deepens as a post moves down the pipeline */
function statusStyle(name, statuses) {
  const ramp = [
    { bg: WHITE, fg: NAVY },
    { bg: TINT, fg: NAVY },
    { bg: TINT_2, fg: NAVY },
    { bg: GREY_MID, fg: WHITE },
    { bg: NAVY, fg: WHITE },
  ];
  const i = statuses.indexOf(name);
  if (i < 0) return ramp[0];
  const span = Math.max(1, statuses.length - 1);
  const idx = Math.round((i / span) * (ramp.length - 1));
  return ramp[idx];
}

/* ------------------------------------------------------------------ */
/* small ui pieces                                                     */
/* ------------------------------------------------------------------ */

function Eyebrow({ children, tone }) {
  return (
    <div
      className="text-xs uppercase mb-2"
      style={{ fontFamily: UTIL, letterSpacing: "0.16em", color: tone || NAVY, fontWeight: 600 }}
    >
      {children}
    </div>
  );
}

function Panel({ children, className }) {
  return (
    <div className={`bg-white p-5 ${className || ""}`} style={{ border: `1px solid ${BLACK}`, ...HARD }}>
      {children}
    </div>
  );
}

function Button({ children, onClick, tone, disabled, small, title }) {
  const base =
    tone === "primary"
      ? { background: NAVY, color: WHITE, border: `1px solid ${NAVY}` }
      : { background: WHITE, color: BLACK, border: `1px solid ${BLACK}` };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 uppercase transition-transform active:translate-x-px active:translate-y-px ${
        small ? "px-2 py-1 text-xs" : "px-4 py-2 text-xs"
      } ${disabled ? "opacity-40" : "hover:-translate-y-px"}`}
      style={{
        fontFamily: UTIL,
        letterSpacing: "0.1em",
        ...base,
        ...(small ? {} : HARD_SM),
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ active, onClick, children, width }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 text-xs uppercase ${width || "px-2"}`}
      style={{
        fontFamily: UTIL,
        letterSpacing: "0.08em",
        border: `1px solid ${NAVY}`,
        background: active ? NAVY : WHITE,
        color: active ? WHITE : NAVY,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs uppercase mb-1"
        style={{ fontFamily: UTIL, letterSpacing: "0.14em", color: GREY }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  fontFamily: BODY,
  border: `1px solid ${LINE}`,
  color: BLACK,
  background: WHITE,
};

function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full px-2 py-2 text-sm focus:outline-none ${props.className || ""}`}
      style={{ ...inputStyle, ...(props.style || {}) }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full px-2 py-2 text-sm focus:outline-none"
      style={inputStyle}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Empty({ icon, title, body }) {
  return (
    <div className="p-8 text-center" style={{ border: `1px dashed ${LINE}`, background: WHITE }}>
      <div className="flex justify-center mb-3" style={{ color: GREY_MID }}>
        {icon}
      </div>
      <div className="text-lg mb-1" style={{ fontFamily: DISPLAY, fontWeight: 600, color: BLACK }}>
        {title}
      </div>
      <div className="text-sm" style={{ fontFamily: BODY, color: GREY }}>
        {body}
      </div>
    </div>
  );
}

function Notice({ children }) {
  if (!children) return null;
  return (
    <div
      className="flex items-start gap-2 p-3 text-sm mb-4 mt-4"
      style={{ border: `1px solid ${BLACK}`, color: BLACK, background: TINT, fontFamily: BODY }}
    >
      <AlertTriangle size={16} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Chip({ children, solid }) {
  return (
    <span
      className="px-2 py-px text-xs uppercase shrink-0"
      style={{
        fontFamily: UTIL,
        letterSpacing: "0.1em",
        background: solid ? NAVY : TINT,
        color: solid ? WHITE : NAVY,
        border: `1px solid ${solid ? NAVY : LINE}`,
      }}
    >
      {children}
    </span>
  );
}

/* comments from older reviews were plain strings, so accept both shapes */
function asEvidence(item) {
  if (typeof item === "string") return { where: "", quote: "", note: item };
  return {
    where: item.where || item.section || "",
    quote: item.quote || "",
    note: item.note || item.point || "",
  };
}

function MarginNote({ item, dotted }) {
  const e = asEvidence(item);
  return (
    <li
      className="pl-3 py-1"
      style={{ borderLeft: `3px ${dotted ? "dotted" : "solid"} ${dotted ? GREY_MID : NAVY}` }}
    >
      {e.where ? (
        <div
          className="text-xs uppercase"
          style={{ fontFamily: UTIL, letterSpacing: "0.1em", color: GREY }}
        >
          {e.where}
        </div>
      ) : null}
      {e.quote ? (
        <div
          className="mt-1 px-2 py-1 text-xs"
          style={{ fontFamily: UTIL, color: BLACK, background: TINT, border: `1px solid ${LINE}` }}
        >
          &ldquo;{e.quote}&rdquo;
        </div>
      ) : null}
      <div className="mt-1 text-sm" style={{ fontFamily: BODY, color: BLACK }}>
        {e.note}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* the strategy template the VA fills in                               */
/* ------------------------------------------------------------------ */

const TEMPLATE_SECTIONS = [
  {
    title: "1. Client and offer",
    prompts: [
      "What the business does, in one paragraph a stranger would understand.",
      "The exact services or products being promoted this period, with prices or ranges.",
      "What makes this client the obvious choice over the nearest competitor.",
      "Anything we are not allowed to say, claim or show.",
    ],
  },
  {
    title: "2. Audience",
    prompts: [
      "Who we are talking to. Age, location, work, life stage, income if it matters.",
      "The problem they are already trying to solve before they ever meet this brand.",
      "The two or three objections that stop them from buying.",
      "Where they already spend attention online, and who else they follow.",
    ],
  },
  {
    title: "3. Goals and how we measure them",
    prompts: [
      "The business outcome this content exists to produce. Bookings, enquiries, sign ups, sales.",
      "The number we are aiming at, and by when.",
      "The two or three metrics we will report on, and where they come from.",
      "What would count as a failed month.",
    ],
  },
  {
    title: "4. Content pillars and messaging",
    prompts: [
      "Four or five pillars, each with a one line description of what belongs in it.",
      "For each pillar, the audience problem it answers.",
      "Three example post ideas per pillar.",
      "Proof assets we can draw on. Testimonials, results, data, founder story.",
    ],
  },
  {
    title: "5. Brand voice and visual direction",
    prompts: [
      "How the brand sounds in three adjectives, with a sentence written in that voice.",
      "Words and phrases to use, and words and phrases to avoid.",
      "Formatting rules. Hashtag count, emoji use, caption length, punctuation to avoid.",
      "Colour codes, fonts and any template or logo rules.",
    ],
  },
  {
    title: "6. Platforms and the path to action",
    prompts: [
      "Which platforms we are using, and the reason each one is on the list.",
      "The job each platform does. Discovery, nurture, conversion, community.",
      "The call to action per platform, and exactly where it sends people.",
      "What happens after the click. Landing page, DM script, booking link, form.",
    ],
  },
];

function templateDoc(clientName) {
  const sections = TEMPLATE_SECTIONS.map(
    (s) => `
    <h2 style="font-family:Arial,sans-serif;font-size:14pt;color:#0C4876;margin:22pt 0 4pt 0;">${s.title}</h2>
    <p style="font-family:Arial,sans-serif;font-size:9pt;color:#555555;margin:0 0 8pt 0;">Answer all of the following:</p>
    <ul style="font-family:Arial,sans-serif;font-size:10pt;color:#555555;margin:0 0 10pt 0;">
      ${s.prompts.map((p) => `<li style="margin-bottom:3pt;">${p}</li>`).join("")}
    </ul>
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="border:1px solid #000000;height:120pt;padding:8pt;font-family:Arial,sans-serif;font-size:11pt;vertical-align:top;">
        Type your answer here.
      </td>
    </tr></table>`
  ).join("");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head><meta charset="utf-8"><title>Content Strategy Template</title></head>
  <body style="font-family:Arial,sans-serif;color:#000000;">
    <h1 style="font-family:Arial,sans-serif;font-size:22pt;margin:0;">Content Strategy</h1>
    <p style="font-family:Arial,sans-serif;font-size:10pt;color:#555555;margin:4pt 0 0 0;">
      Fill in every section. Leave nothing blank. When you are done, save this file as a PDF and upload the PDF to ContentOps.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16pt 0;">
      ${["Client", "Prepared by", "Date", "Period this strategy covers"]
        .map(
          (label) => `<tr>
            <td style="border:1px solid #000000;padding:6pt;width:32%;font-family:Arial,sans-serif;font-size:10pt;background:#F4F4F4;"><b>${label}</b></td>
            <td style="border:1px solid #000000;padding:6pt;font-family:Arial,sans-serif;font-size:10pt;">${
              label === "Client" ? clientName || "" : ""
            }</td>
          </tr>`
        )
        .join("")}
    </table>
    ${sections}
    <p style="font-family:Arial,sans-serif;font-size:9pt;color:#555555;margin-top:24pt;">
      Note on posting frequency: leave it out of this document. The calendar builder sets dates and volume from your posting days and date range.
    </p>
  </body></html>`;
}

function downloadTemplate(clientName) {
  downloadBlob(
    templateDoc(clientName),
    `${safeName(clientName)}-content-strategy-template.doc`,
    "application/msword"
  );
}

/* ------------------------------------------------------------------ */
/* prompts                                                             */
/* ------------------------------------------------------------------ */

const SCORE_SYSTEM = `You are a senior social media strategist with twelve years of agency experience across service businesses, coaches, studios and nonprofits. You grade client content strategies the way a hiring reviewer would: specific, unsentimental, useful.
Rate from 1 to 100. Score honestly. A strategy with no measurable goals or no defined audience cannot score above 55, no matter how well written it is.
Judge these six areas only, in this order:
1. Client and offer. Is it clear what the business sells, at what price, and why it beats the alternative.
2. Audience. Is there a specific person described, with their problem and their objections, not a demographic label.
3. Goals and measurement. Is there a business outcome, a number to hit, and named metrics to report.
4. Content pillars and messaging. Are there distinct pillars, each tied to an audience problem, with example ideas and proof assets.
5. Brand voice and visual direction. Is the voice written out and usable, with formatting rules, words to avoid, colours and fonts.
6. Platform strategy and path to action. Is each platform justified, given a job, and given a call to action that leads somewhere real.
Do not judge posting frequency, cadence or volume. Those are set in the calendar, not the strategy. Never mention them.
Return ONLY valid JSON, no preamble, no markdown fences:
{"score":1-100,"grade":"letter grade","verdict":"one sentence, max 20 words","categories":[{"name":"Client and offer","score":0-10,"note":"max 12 words"},{"name":"Audience","score":0-10,"note":"max 12 words"},{"name":"Goals and measurement","score":0-10,"note":"max 12 words"},{"name":"Content pillars and messaging","score":0-10,"note":"max 12 words"},{"name":"Brand voice and visual direction","score":0-10,"note":"max 12 words"},{"name":"Platform strategy and path to action","score":0-10,"note":"max 12 words"}]}
Use exactly those six category names. Write plain declarative sentences. Never use em dashes.`;

const EVIDENCE_SYSTEM = `You are a senior social media strategist marking up a client content strategy. Every comment you make must point at the exact part of the document it refers to, the way a reviewer leaves margin notes.
Return ONLY valid JSON, no preamble, no markdown fences:
{"strengths":[{"where":"the section heading or line in the document, as written there, max 10 words","quote":"a verbatim snippet copied from the document, max 15 words","note":"why this part works, max 18 words"}],"gaps":[{"where":"the section where this should live, or the exact wording that is too vague, max 10 words","quote":"the verbatim snippet that falls short, or an empty string if the item is absent entirely","note":"what is missing and why it matters, max 18 words"}],"fixes":[{"priority":"High or Medium or Low","action":"the change to make and where in the document to make it, max 22 words"}]}
Give exactly 3 strengths, 3 gaps and 3 fixes.
The six areas that matter are client and offer, audience, goals and measurement, content pillars and messaging, brand voice and visual direction, and platform strategy and path to action. Never comment on posting frequency, cadence or volume.
Copy quotes word for word from the strategy. Never paraphrase inside a quote and never invent text that is not there. If something is missing from the whole document, set quote to an empty string and say so in where. Write plain declarative sentences. Never use em dashes.`;

const CAL_SYSTEM = `You are a social media content planner. You write client ready captions in the brand voice described in the strategy.
Return ONLY valid JSON, no preamble, no markdown fences: an array of objects, one per requested slot, in the same order as the slots given.
Each object: {"time":"HH:MM in 24 hour format","pillar":"one of the allowed pillars","type":"one of the allowed content types","caption":"the full caption, 40 to 90 words, ending with hashtags if the caption rules ask for them","asset":"a one line shot brief for the designer, max 14 words"}
Vary pillars and content types across the schedule. Match the platform for each slot. Follow the caption rules exactly.`;

const READ_SYSTEM = `You read Facebook and Instagram analytics screenshots and transcribe them precisely.
Look hardest for these four things: views or impressions, reach or accounts reached, top performing content, and followers.
Return ONLY valid JSON, no fences: {"platform":"Instagram or Facebook or Unclear","period":"the date range shown or Unclear","metrics":[{"label":"metric name as shown","value":"value as shown","change":"percent change if shown, else empty string"}],"topContent":[{"label":"what the post is, as shown or visible in the thumbnail, max 10 words","metric":"the number shown against it"}]}
Transcribe every number you can read, up to 10 metrics. List up to 4 top content items, or an empty array if the screenshot does not show any. Never invent a number that is not visible.`;

const DIAGNOSE_SYSTEM = `You are a senior social media manager reading a client's numbers. You quote the numbers back as proof for every claim, and you write for a client who does not know platform jargon.
Report on exactly four areas, in this order: Views, Reach, Top content, Followers.
For each area, say plainly what the numbers show, give the figures as proof, mark it Working or Needs work, and say what to do about it next month.
Return ONLY valid JSON, no fences:
{"headline":"the one thing the numbers say, max 14 words","summary":"3 sentences, max 65 words total, in plain language","areas":[{"area":"Views","verdict":"Working or Needs work","reading":"what the numbers show, max 20 words","evidence":"the exact figures, max 14 words","action":"what to do next month, max 18 words"},{"area":"Reach","verdict":"","reading":"","evidence":"","action":""},{"area":"Top content","verdict":"","reading":"","evidence":"","action":""},{"area":"Followers","verdict":"","reading":"","evidence":"","action":""}]}
Use exactly those four area names. Put a real number in every evidence field, copied from the data. For Top content, name the actual posts or formats that performed best and say what they had in common. If a number you need is not in the data, set evidence to the metric the VA should start capturing and mark the area Needs work. Never use em dashes.`;

const PLAN_SYSTEM = `You are a senior social media manager turning a performance read into next month's plan. Every recommendation is concrete enough that a VA could action it on Monday, and carries a number to hit. Keep the plan anchored to views, reach, top content and followers.
Return ONLY valid JSON, no fences:
{"recommendations":[{"priority":"High or Medium or Low","action":"what to do, max 20 words","why":"the number or pattern behind it, max 16 words","target":"a measurable target for next month, max 12 words"}],"doubleDown":"the single format or topic to make more of next month and why, max 28 words","watch":"the one metric to check weekly, max 10 words"}
Give exactly 4 recommendations, ordered High first. Base targets on the numbers given, as a realistic move from where the account already is. Write plain language. Never use em dashes.`;

/* ------------------------------------------------------------------ */
/* strategy intake, shared by the review and calendar screens           */
/* ------------------------------------------------------------------ */

function strategyBlocks(strategy, instruction, limit) {
  const content = [];
  const att = strategy.attachment;
  if (att && att.kind === "pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: att.data },
    });
  }
  if (att && att.kind === "image") {
    content.push({
      type: "image",
      source: { type: "base64", media_type: att.media, data: att.data },
    });
  }
  const text = (strategy.text || "").slice(0, limit);
  content.push({
    type: "text",
    text: `${instruction}\n\n${text ? `Strategy:\n${text}` : "The strategy is in the attached file."}`,
  });
  return content;
}

function StrategyIntake({ strategy, setStrategy, rows, onReviewed, clientName }) {
  const [text, setText] = useState(strategy.text || "");
  const [fileName, setFileName] = useState(strategy.fileName || "");
  const [attachment, setAttachment] = useState(strategy.attachment || null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const has = !!text.trim() || !!attachment;

  async function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError("");
    setSaved(false);
    if (f.type !== "application/pdf") {
      setError(
        "Strategies have to be uploaded as PDF. Open the file, save it as a PDF, then upload that. You can also paste the text below."
      );
      return;
    }
    setFileName(f.name);
    setAttachment(null);
    try {
      setAttachment({ kind: "pdf", data: await fileToBase64(f) });
      setText("");
    } catch (err) {
      setError(err.message);
    }
  }

  function persist(extra) {
    const next = {
      ...strategy,
      text: text.trim(),
      fileName,
      attachment,
      ...(extra || {}),
    };
    setStrategy(next);
    return next;
  }

  function saveOnly() {
    if (!has) {
      setError("Add a strategy first. Paste the text or upload the file.");
      return;
    }
    persist();
    setSaved(true);
    setError("");
  }

  async function runReview() {
    if (!has) {
      setError("Add a strategy first. Paste the text or upload the file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setStage("Scoring the strategy");
      const scored = parseJson(
        await askClaude(
          [
            {
              role: "user",
              content: strategyBlocks(
                { text, attachment },
                "Grade this content strategy.",
                12000
              ),
            },
          ],
          SCORE_SYSTEM
        )
      );
      setStage("Marking up the document");
      const marked = parseJson(
        await askClaude(
          [
            {
              role: "user",
              content: strategyBlocks(
                { text, attachment },
                `Mark up this content strategy. Point every comment at the exact part of the document. It scored ${scored.score} out of 100.`,
                12000
              ),
            },
          ],
          EVIDENCE_SYSTEM
        )
      );
      persist({
        review: { ...scored, ...marked },
        reviewedAt: new Date().toISOString(),
      });
      setSaved(true);
      if (onReviewed) onReviewed();
    } catch (err) {
      setError(err.message || "The review failed. Try again.");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <div>
      <div className="mb-4 p-3" style={{ border: `1px solid ${LINE}`, background: TINT }}>
        <Eyebrow>How to submit a strategy</Eyebrow>
        <ol className="text-sm space-y-1" style={{ fontFamily: BODY, color: BLACK }}>
          <li>1. Download the template and fill in all six sections.</li>
          <li>2. Save it as a PDF. In Word or Google Docs, use File then Save as PDF.</li>
          <li>3. Upload the PDF here. Uploads must be PDF. Pasting the text works too.</li>
        </ol>
        <div className="mt-3">
          <Button onClick={() => downloadTemplate(clientName)}>
            <Download size={14} /> Download the template
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Button onClick={() => fileRef.current && fileRef.current.click()}>
          <Upload size={14} /> Upload PDF
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onPick}
          className="hidden"
        />
        {fileName ? (
          <span className="flex items-center gap-1 text-xs" style={{ fontFamily: UTIL, color: NAVY }}>
            <FileText size={13} /> {fileName}
          </span>
        ) : (
          <span className="text-xs" style={{ fontFamily: UTIL, color: GREY }}>
            PDF only
          </span>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        rows={rows || 12}
        placeholder="Goals, target audience, content pillars, platforms, posting cadence, brand voice, calls to action, KPIs."
        className="w-full p-3 text-sm focus:outline-none"
        style={inputStyle}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button tone="primary" onClick={runReview} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
          {busy ? "Reviewing" : "Rate this strategy"}
        </Button>
        <Button onClick={saveOnly} disabled={busy}>
          <Save size={14} /> Save without rating
        </Button>
        {saved ? (
          <span className="flex items-center gap-1 text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            <Check size={13} /> Saved
          </span>
        ) : null}
        {stage ? (
          <span className="text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            {stage}
          </span>
        ) : null}
      </div>

      <Notice>{error}</Notice>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. strategy review                                                  */
/* ------------------------------------------------------------------ */

function ScoreStamp({ score, grade }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(score);
      return;
    }
    let n = 0;
    const step = Math.max(1, Math.round(score / 24));
    const t = setInterval(() => {
      n = Math.min(score, n + step);
      setShown(n);
      if (n >= score) clearInterval(t);
    }, 22);
    return () => clearInterval(t);
  }, [score]);

  return (
    <div className="relative inline-block">
      <div
        className="absolute inset-0"
        style={{ background: NAVY, transform: "rotate(-3deg)", border: `2px solid ${NAVY}` }}
      />
      <div className="relative px-6 py-4 text-center">
        <div
          className="leading-none"
          style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: "3.25rem", color: WHITE }}
        >
          {shown}
          <span className="text-xl align-top">/100</span>
        </div>
        <div
          className="mt-1 text-xs uppercase"
          style={{ fontFamily: UTIL, letterSpacing: "0.2em", color: WHITE }}
        >
          Grade {grade}
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ item }) {
  const pct = Math.max(0, Math.min(10, Number(item.score) || 0)) * 10;
  const fill = pct >= 70 ? NAVY : pct >= 45 ? GREY_MID : TINT_2;
  return (
    <div className="py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm" style={{ fontFamily: BODY, fontWeight: 600, color: BLACK }}>
          {item.name}
        </span>
        <span className="text-sm" style={{ fontFamily: UTIL, color: BLACK }}>
          {item.score}/10
        </span>
      </div>
      <div className="mt-1 h-2" style={{ background: TINT, border: `1px solid ${LINE}` }}>
        <div className="h-2" style={{ width: `${pct}%`, background: fill }} />
      </div>
      <div className="mt-1 text-xs" style={{ fontFamily: BODY, color: GREY }}>
        {item.note}
      </div>
    </div>
  );
}

function StrategyTab({ strategy, setStrategy, settings, clientName }) {
  const review = strategy.review;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <Eyebrow>Step 1 &middot; {clientName || "Submit for review"}</Eyebrow>
        <h2
          className="text-2xl mb-1"
          style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK, letterSpacing: "-0.01em" }}
        >
          Content strategy
        </h2>
        <p className="text-sm mb-4" style={{ fontFamily: BODY, color: GREY }}>
          Use the template below, save it as a PDF, then upload it. A senior strategist rates it out
          of 100 across the six areas a client strategy needs, and points at the exact parts that
          hold up or fall short.
        </p>
        <StrategyIntake
          strategy={strategy}
          setStrategy={setStrategy}
          rows={14}
          clientName={clientName}
        />
      </Panel>

      <div>
        {!review ? (
          <Empty
            icon={<ClipboardCheck size={28} />}
            title="No grade yet"
            body="Submit a strategy and the scorecard lands here."
          />
        ) : (
          <div className="space-y-4">
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <Eyebrow>Scorecard</Eyebrow>
                  <p
                    className="text-lg max-w-xs"
                    style={{ fontFamily: DISPLAY, fontWeight: 600, color: BLACK, lineHeight: 1.3 }}
                  >
                    {review.verdict}
                  </p>
                  <p className="mt-2 text-xs" style={{ fontFamily: UTIL, color: GREY }}>
                    Reviewed {new Date(strategy.reviewedAt).toLocaleString()}
                  </p>
                </div>
                <ScoreStamp score={Number(review.score) || 0} grade={review.grade || ""} />
              </div>
              <div className="mt-4">
                {(review.categories || []).map((c, i) => (
                  <ScoreBar key={i} item={c} />
                ))}
              </div>
            </Panel>

            <div className="grid gap-4 sm:grid-cols-2">
              <Panel>
                <Eyebrow>Holding up &middot; in the document</Eyebrow>
                <ul className="space-y-3">
                  {(review.strengths || []).map((s, i) => (
                    <MarginNote key={i} item={s} />
                  ))}
                </ul>
              </Panel>
              <Panel>
                <Eyebrow>Missing &middot; where it should be</Eyebrow>
                <ul className="space-y-3">
                  {(review.gaps || []).map((s, i) => (
                    <MarginNote key={i} item={s} dotted />
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel>
              <Eyebrow>Fix in this order</Eyebrow>
              {(review.fixes || []).map((f, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2"
                  style={{ borderBottom: `1px solid ${LINE}` }}
                >
                  <Chip solid={f.priority === "High"}>{f.priority}</Chip>
                  <span className="text-sm" style={{ fontFamily: BODY, color: BLACK }}>
                    {f.action}
                  </span>
                </div>
              ))}
              <p className="mt-3 text-xs" style={{ fontFamily: UTIL, color: GREY }}>
                Caption rules in force: {settings.captionRules}
              </p>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. content calendar                                                 */
/* ------------------------------------------------------------------ */

function buildSlots(startISO, endISO, days, platforms) {
  const start = isoToDate(startISO);
  const end = isoToDate(endISO);
  const out = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  const span = Math.round((end - start) / 86400000);
  for (let i = 0; i <= span; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    out.push({
      date: toISO(d),
      weekday: DAY_NAMES[d.getDay()],
      week: Math.floor(i / 7) + 1,
      platform: platforms[out.length % platforms.length],
    });
  }
  return out;
}

function CalendarTab({ strategy, setStrategy, calendar, setCalendar, settings, clientName }) {
  const [startDate, setStartDate] = useState(calendar.startDate || todayISO());
  const [endDate, setEndDate] = useState(
    calendar.endDate || addDaysISO(calendar.startDate || todayISO(), 27)
  );
  const [days, setDays] = useState(settings.postingDays);
  const [platforms, setPlatforms] = useState(settings.platforms);
  const [openIntake, setOpenIntake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [filter, setFilter] = useState("All");
  const csvRef = useRef(null);

  const rows = calendar.rows || [];
  const slots = useMemo(
    () => buildSlots(startDate, endDate, days, platforms),
    [startDate, endDate, days, platforms]
  );
  const visible = useMemo(
    () => (filter === "All" ? rows : rows.filter((r) => r.platform === filter)),
    [rows, filter]
  );
  const hasStrategy = !!(strategy.text || strategy.attachment);

  function setMonthFrom(iso) {
    setStartDate(iso);
    setEndDate(addDaysISO(iso, 27));
  }

  function toggleDay(n) {
    setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
  }

  function togglePlatform(p) {
    setPlatforms((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  async function generate() {
    if (!hasStrategy) {
      setError("Upload or paste the content strategy first. The calendar is built from it.");
      setOpenIntake(true);
      return;
    }
    if (!days.length || !platforms.length) {
      setError("Pick at least one posting day and one platform.");
      return;
    }
    if (!slots.length) {
      setError("That date range and those posting days produce no dates. Adjust the schedule.");
      return;
    }
    if (slots.length > 40) {
      setError("That range asks for more than 40 posts. Shorten it or drop a posting day.");
      return;
    }
    setBusy(true);
    setError("");
    const built = [];
    const batchSize = 4;
    const batches = Math.ceil(slots.length / batchSize);
    try {
      for (let b = 0; b < batches; b++) {
        const chunk = slots.slice(b * batchSize, b * batchSize + batchSize);
        setProgress(
          `Writing posts ${b * batchSize + 1} to ${b * batchSize + chunk.length} of ${slots.length}`
        );
        const instruction = `Plan these posts.
Allowed content pillars: ${settings.pillars.join(", ")}
Allowed content types: ${settings.contentTypes.join(", ")}
Caption rules: ${settings.captionRules}

These are posts ${b * batchSize + 1} to ${b * batchSize + chunk.length} of ${slots.length} for the period ${startDate} to ${endDate}, so keep variety against the whole schedule.
Slots:
${chunk.map((s, i) => `${i + 1}. ${s.weekday} ${s.date} on ${s.platform}`).join("\n")}

Return ${chunk.length} objects.`;
        const content = strategyBlocks(strategy, instruction, 3500);
        const arr = parseJson(await askClaude([{ role: "user", content }], CAL_SYSTEM));
        (Array.isArray(arr) ? arr : []).forEach((item, i) => {
          const slot = chunk[i];
          if (!slot) return;
          built.push({
            id: uid(),
            date: slot.date,
            time: item.time || "09:00",
            week: slot.week,
            platform: slot.platform,
            pillar: settings.pillars.includes(item.pillar) ? item.pillar : settings.pillars[0],
            type: settings.contentTypes.includes(item.type) ? item.type : settings.contentTypes[0],
            caption: item.caption || "",
            asset: item.asset || "",
            status: settings.statuses[0] || "Draft",
          });
        });
      }
      setCalendar({
        rows: built,
        generatedAt: new Date().toISOString(),
        startDate,
        endDate,
      });
    } catch (err) {
      setError(err.message || "Generation stopped early. Try again.");
      if (built.length) {
        setCalendar({
          rows: built,
          generatedAt: new Date().toISOString(),
          startDate,
          endDate,
        });
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function addRow() {
    const row = {
      id: uid(),
      date: startDate,
      time: "09:00",
      week: 1,
      platform: settings.platforms[0] || "",
      pillar: settings.pillars[0] || "",
      type: settings.contentTypes[0] || "",
      caption: "",
      asset: "",
      status: settings.statuses[0] || "Draft",
    };
    setCalendar({ ...calendar, rows: [...rows, row] });
    setEditing(row.id);
    setDraft(row);
  }

  function startEdit(row) {
    setEditing(row.id);
    setDraft({ ...row });
  }

  function saveEdit() {
    setCalendar({ ...calendar, rows: rows.map((r) => (r.id === draft.id ? draft : r)) });
    setEditing(null);
    setDraft(null);
  }

  function deleteRow(id) {
    setCalendar({ ...calendar, rows: rows.filter((r) => r.id !== id) });
    if (editing === id) {
      setEditing(null);
      setDraft(null);
    }
  }

  function setStatus(id, status) {
    setCalendar({ ...calendar, rows: rows.map((r) => (r.id === id ? { ...r, status } : r)) });
  }

  function exportCsv() {
    const head = [
      "Date & Time",
      "Platform",
      "Content Pillar",
      "Content Type",
      "Caption",
      "Visual Asset [Link]",
      "Status",
    ];
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const body = rows.map((r) =>
      [`${r.date} ${r.time}`, r.platform, r.pillar, r.type, r.caption, r.asset, r.status]
        .map(esc)
        .join(",")
    );
    downloadBlob(
      [head.map(esc).join(","), ...body].join("\n"),
      `${safeName(clientName)}-content-calendar.csv`,
      "text/csv;charset=utf-8"
    );
  }

  async function importCsv(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    e.target.value = "";
    try {
      const table = parseCsv(await fileToText(f));
      if (!table.length) {
        setError("That file has no rows in it.");
        return;
      }
      const first = String(table[0][0] || "").toLowerCase();
      const body = first.includes("date") ? table.slice(1) : table;
      const imported = body.map((r) => {
        const stamp = String(r[0] || "").trim().split(/\s+/);
        let date = stamp[0] || todayISO();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const d = new Date(stamp.join(" "));
          date = Number.isNaN(d.getTime()) ? todayISO() : toISO(d);
        }
        const pick = (value, list) => (list.includes(value) ? value : list[0] || "");
        return {
          id: uid(),
          date,
          time: /^\d{1,2}:\d{2}$/.test(stamp[1] || "") ? stamp[1] : "09:00",
          week: 1,
          platform: pick(String(r[1] || "").trim(), settings.platforms),
          pillar: pick(String(r[2] || "").trim(), settings.pillars),
          type: pick(String(r[3] || "").trim(), settings.contentTypes),
          caption: String(r[4] || "").trim(),
          asset: String(r[5] || "").trim(),
          status: pick(String(r[6] || "").trim(), settings.statuses),
        };
      });
      setCalendar({ ...calendar, rows: [...rows, ...imported] });
      setError("");
    } catch (err) {
      setError("That CSV could not be read. Export one from here first and match its columns.");
    }
  }

  const th = { fontFamily: UTIL, letterSpacing: "0.1em", color: WHITE, background: NAVY };

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Step 2 &middot; {clientName || "Build the month"}</Eyebrow>
            <h2
              className="text-2xl"
              style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK, letterSpacing: "-0.01em" }}
            >
              Content calendar
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={addRow}>
              <Plus size={14} /> Add row
            </Button>
            <Button onClick={exportCsv} disabled={!rows.length}>
              <Download size={14} /> Download CSV
            </Button>
            <Button onClick={() => csvRef.current && csvRef.current.click()}>
              <Upload size={14} /> Import CSV
            </Button>
            <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={importCsv} className="hidden" />
            <Button tone="primary" onClick={generate} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
              {busy ? "Building" : rows.length ? "Rebuild the month" : "Build the month"}
            </Button>
          </div>
        </div>

        {/* strategy source */}
        <div className="mt-5" style={{ border: `1px solid ${LINE}`, background: TINT }}>
          <button
            type="button"
            onClick={() => setOpenIntake((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span
                className="block text-xs uppercase"
                style={{ fontFamily: UTIL, letterSpacing: "0.14em", color: GREY }}
              >
                Strategy this calendar is built from
              </span>
              <span className="text-sm" style={{ fontFamily: BODY, fontWeight: 600, color: BLACK }}>
                {hasStrategy
                  ? `${strategy.fileName || "Pasted strategy"}${
                      strategy.review ? ` · graded ${strategy.review.score}/100` : " · not graded yet"
                    }`
                  : "Nothing on file yet"}
              </span>
            </span>
            <span
              className="flex items-center gap-1 text-xs uppercase shrink-0"
              style={{ fontFamily: UTIL, letterSpacing: "0.1em", color: BLACK }}
            >
              {openIntake ? "Close" : hasStrategy ? "Replace" : "Upload"}
              {openIntake ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {openIntake ? (
            <div className="px-4 pb-4 bg-white" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="pt-4">
                <StrategyIntake
                  strategy={strategy}
                  setStrategy={setStrategy}
                  rows={8}
                  onReviewed={() => setOpenIntake(false)}
                  clientName={clientName}
                />
              </div>
            </div>
          ) : null}
        </div>

        <Notice>{error}</Notice>

        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Start date">
            <TextInput
              type="date"
              value={startDate}
              onChange={(e) => setMonthFrom(e.target.value)}
            />
          </Field>
          <Field label="End date">
            <TextInput
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <div>
            <Eyebrow>Posting days</Eyebrow>
            <div className="flex gap-1">
              {DAY_NAMES.map((d, i) => (
                <Toggle key={d} active={days.includes(i)} onClick={() => toggleDay(i)} width="w-9">
                  {d[0]}
                </Toggle>
              ))}
            </div>
          </div>
          <div>
            <Eyebrow>Platforms in rotation</Eyebrow>
            <div className="flex flex-wrap gap-1">
              {settings.platforms.map((p) => (
                <Toggle key={p} active={platforms.includes(p)} onClick={() => togglePlatform(p)}>
                  {p}
                </Toggle>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <span className="text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            {slots.length} posting slots from {fmtDate(startDate)} to {fmtDate(endDate)}
          </span>
          <button
            type="button"
            onClick={() => setEndDate(addDaysISO(startDate, 27))}
            className="text-xs uppercase"
            style={{ fontFamily: UTIL, letterSpacing: "0.1em", color: BLACK, textDecoration: "underline" }}
          >
            Reset to four weeks
          </button>
        </div>

        {progress ? (
          <p className="mt-3 text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            {progress}
          </p>
        ) : null}
        {calendar.generatedAt ? (
          <p className="mt-2 text-xs" style={{ fontFamily: UTIL, color: GREY }}>
            {rows.length} posts on the board &middot; built {new Date(calendar.generatedAt).toLocaleString()}
          </p>
        ) : null}
      </Panel>

      {!rows.length ? (
        <Empty
          icon={<CalendarDays size={28} />}
          title="The month is empty"
          body="Upload the strategy above and build the month, or add rows one at a time."
        />
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className="text-xs uppercase"
              style={{ fontFamily: UTIL, color: GREY, letterSpacing: "0.14em" }}
            >
              Filter
            </span>
            {["All", ...settings.platforms].map((p) => (
              <Toggle key={p} active={filter === p} onClick={() => setFilter(p)}>
                {p}
              </Toggle>
            ))}
          </div>

          <div className="overflow-x-auto" style={{ border: `1px solid ${NAVY}`, ...HARD }}>
            <table className="w-full bg-white" style={{ minWidth: "1000px", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    "Date & Time",
                    "Platform",
                    "Content Pillar",
                    "Content Type",
                    "Caption",
                    "Visual Asset [Link]",
                    "Status",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs uppercase whitespace-nowrap"
                      style={th}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const isEdit = editing === r.id;
                  const st = statusStyle(r.status, settings.statuses);
                  if (isEdit && draft) {
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${LINE}`, background: TINT }}>
                        <td className="px-2 py-2 align-top">
                          <TextInput
                            type="date"
                            value={draft.date}
                            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                          />
                          <div className="h-1" />
                          <TextInput
                            type="time"
                            value={draft.time}
                            onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Select
                            value={draft.platform}
                            options={settings.platforms}
                            onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Select
                            value={draft.pillar}
                            options={settings.pillars}
                            onChange={(e) => setDraft({ ...draft, pillar: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Select
                            value={draft.type}
                            options={settings.contentTypes}
                            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <textarea
                            rows={6}
                            value={draft.caption}
                            onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                            className="w-full p-2 text-sm focus:outline-none"
                            style={{ ...inputStyle, minWidth: "260px" }}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <TextInput
                            value={draft.asset}
                            placeholder="Paste asset link"
                            onChange={(e) => setDraft({ ...draft, asset: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Select
                            value={draft.status}
                            options={settings.statuses}
                            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex flex-col gap-1">
                            <Button small tone="primary" onClick={saveEdit} title="Save row">
                              <Check size={12} /> Save
                            </Button>
                            <Button
                              small
                              onClick={() => {
                                setEditing(null);
                                setDraft(null);
                              }}
                              title="Cancel"
                            >
                              <X size={12} /> Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="px-3 py-3 align-top whitespace-nowrap">
                        <div className="text-sm" style={{ fontFamily: UTIL, color: BLACK }}>
                          {fmtDate(r.date)}
                        </div>
                        <div className="text-xs" style={{ fontFamily: UTIL, color: GREY }}>
                          {r.time} &middot; wk {r.week || 1}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-sm" style={{ fontFamily: BODY, color: BLACK }}>
                        {r.platform}
                      </td>
                      <td className="px-3 py-3 align-top text-sm" style={{ fontFamily: BODY, color: BLACK }}>
                        {r.pillar}
                      </td>
                      <td className="px-3 py-3 align-top text-sm" style={{ fontFamily: BODY, color: BLACK }}>
                        {r.type}
                      </td>
                      <td
                        className="px-3 py-3 align-top text-sm"
                        style={{ fontFamily: BODY, color: BLACK, minWidth: "300px", whiteSpace: "pre-wrap" }}
                      >
                        {r.caption}
                      </td>
                      <td
                        className="px-3 py-3 align-top text-xs"
                        style={{ fontFamily: UTIL, color: GREY, minWidth: "150px" }}
                      >
                        {/^https?:\/\//.test(r.asset) ? (
                          <a
                            href={r.asset}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: NAVY, textDecoration: "underline" }}
                          >
                            Open asset
                          </a>
                        ) : (
                          r.asset || "no link yet"
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <select
                          value={r.status}
                          onChange={(e) => setStatus(r.id, e.target.value)}
                          className="px-2 py-1 text-xs uppercase focus:outline-none"
                          style={{
                            fontFamily: UTIL,
                            letterSpacing: "0.08em",
                            background: st.bg,
                            color: st.fg,
                            border: `1px solid ${BLACK}`,
                          }}
                        >
                          {settings.statuses.map((s) => (
                            <option key={s} value={s} style={{ background: WHITE, color: BLACK }}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex gap-1">
                          <Button small onClick={() => startEdit(r)} title="Edit row">
                            <Pencil size={12} />
                          </Button>
                          <Button small onClick={() => deleteRow(r.id)} title="Delete row">
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. analytics                                                        */
/* ------------------------------------------------------------------ */

/* reports saved before the four area read still render */
const FOCUS_AREAS = ["Views", "Reach", "Top content", "Followers"];

function normalizeBody(body) {
  const b = body || {};
  const base = {
    recommendations: b.recommendations || (b.actions || []).map((a) => ({
      priority: a.owner || "Medium",
      action: a.action || "",
      why: "",
      target: "",
    })),
    doubleDown: b.doubleDown || "",
    watch: b.watch || b.focus || "",
  };
  if (Array.isArray(b.areas) && b.areas.length) {
    return { ...base, areas: b.areas };
  }
  const legacy = [
    ...(b.working || []).map((w) => ({
      area: w.what || "Working",
      verdict: "Working",
      reading: w.what || "",
      evidence: w.evidence || "",
      action: w.doubleDown || "",
    })),
    ...(b.needsWork || []).map((w) => ({
      area: w.what || "Needs work",
      verdict: "Needs work",
      reading: w.what || "",
      evidence: w.evidence || "",
      action: w.fix || "",
    })),
    ...(b.wins || []).map((w) => ({ area: "Working", verdict: "Working", reading: w, evidence: "", action: "" })),
    ...(b.concerns || []).map((w) => ({
      area: "Needs work",
      verdict: "Needs work",
      reading: w,
      evidence: "",
      action: "",
    })),
  ];
  return { ...base, areas: legacy };
}

function AreaCard({ item }) {
  const good = String(item.verdict || "").toLowerCase().startsWith("work");
  return (
    <div
      className="p-4"
      style={{
        border: `1px solid ${LINE}`,
        borderLeft: `5px ${good ? "solid" : "dotted"} ${good ? NAVY : GREY_MID}`,
        background: WHITE,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-sm uppercase"
          style={{ fontFamily: UTIL, fontWeight: 700, letterSpacing: "0.1em", color: BLACK }}
        >
          {item.area}
        </span>
        <Chip solid={good}>{item.verdict || (good ? "Working" : "Needs work")}</Chip>
      </div>
      <p className="mt-2 text-sm" style={{ fontFamily: BODY, color: BLACK, lineHeight: 1.5 }}>
        {item.reading}
      </p>
      {item.evidence ? (
        <div
          className="mt-2 inline-block px-2 py-1 text-xs"
          style={{ fontFamily: UTIL, fontWeight: 600, color: BLACK, background: TINT, border: `1px solid ${LINE}` }}
        >
          {item.evidence}
        </div>
      ) : null}
      {item.action ? (
        <div className="mt-3">
          <span
            className="text-xs uppercase"
            style={{ fontFamily: UTIL, fontWeight: 600, letterSpacing: "0.12em", color: NAVY }}
          >
            {good ? "Do more of this" : "Fix this"}
          </span>
          <div className="text-sm" style={{ fontFamily: BODY, color: BLACK }}>
            {item.action}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function reportDoc(rep, clientName) {
  const b = normalizeBody(rep.body);
  const section = (title, inner) =>
    `<h2 style="font-family:Arial,sans-serif;font-size:13pt;color:#0C4876;margin:20pt 0 6pt 0;">${title}</h2>${inner}`;
  const areas = b.areas
    .map(
      (a) => `<table style="width:100%;border-collapse:collapse;margin-bottom:8pt;"><tr>
        <td style="border:1px solid #000;padding:8pt;font-family:Arial,sans-serif;font-size:10pt;">
          <b>${a.area}</b> &nbsp; <span style="color:#0C4876;">${a.verdict || ""}</span><br/>
          ${a.reading || ""}<br/>
          <span style="color:#555;">${a.evidence || ""}</span><br/>
          <b>Next:</b> ${a.action || ""}
        </td></tr></table>`
    )
    .join("");
  const recs = b.recommendations
    .map(
      (r) => `<tr>
        <td style="border:1px solid #000;padding:6pt;font-family:Arial,sans-serif;font-size:10pt;width:14%;">${r.priority || ""}</td>
        <td style="border:1px solid #000;padding:6pt;font-family:Arial,sans-serif;font-size:10pt;">${r.action || ""}<br/><span style="color:#555;">${r.why || ""}</span></td>
        <td style="border:1px solid #000;padding:6pt;font-family:Arial,sans-serif;font-size:10pt;width:26%;">${r.target || ""}</td>
      </tr>`
    )
    .join("");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head><meta charset="utf-8"><title>Performance report</title></head>
  <body style="font-family:Arial,sans-serif;color:#000;">
    <p style="font-family:Arial,sans-serif;font-size:9pt;color:#555;margin:0;">${clientName || ""} &nbsp;|&nbsp; ${new Date(rep.createdAt).toLocaleDateString()}</p>
    <h1 style="font-family:Arial,sans-serif;font-size:20pt;margin:4pt 0 0 0;">${rep.body.headline || "Performance report"}</h1>
    <p style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;">${rep.body.summary || ""}</p>
    ${section("Views, reach, top content and followers", areas)}
    ${b.doubleDown ? section("Double down next month", `<p style="font-family:Arial,sans-serif;font-size:12pt;background:#0C4876;color:#fff;padding:10pt;">${b.doubleDown}</p>`) : ""}
    ${section("Recommendations", `<table style="width:100%;border-collapse:collapse;"><tr>
        <td style="border:1px solid #000;padding:6pt;background:#F4F4F4;font-family:Arial,sans-serif;font-size:9pt;"><b>Priority</b></td>
        <td style="border:1px solid #000;padding:6pt;background:#F4F4F4;font-family:Arial,sans-serif;font-size:9pt;"><b>Action</b></td>
        <td style="border:1px solid #000;padding:6pt;background:#F4F4F4;font-family:Arial,sans-serif;font-size:9pt;"><b>Target</b></td>
      </tr>${recs}</table>`)}
    ${b.watch ? `<p style="font-family:Arial,sans-serif;font-size:10pt;"><b>Check weekly:</b> ${b.watch}</p>` : ""}
    <p style="font-family:Arial,sans-serif;font-size:8pt;color:#555;margin-top:20pt;">Source screenshots: ${(rep.sources || []).join(", ")}</p>
  </body></html>`;
}

function AnalyticsTab({ reports, setReports, strategy, clientName }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const ref = useRef(null);

  async function onPick(e) {
    const picked = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return;
    setError("");
    try {
      const loaded = await Promise.all(
        picked.map(async (f) => ({ name: f.name, media: f.type, data: await fileToBase64(f) }))
      );
      setFiles((prev) => [...prev, ...loaded].slice(0, 6));
    } catch (err) {
      setError(err.message);
    }
  }

  async function build() {
    if (!files.length) {
      setError("Upload at least one analytics screenshot.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reads = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Reading screenshot ${i + 1} of ${files.length}`);
        const raw = await askClaude(
          [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: files[i].media, data: files[i].data },
                },
                { type: "text", text: "Transcribe the metrics in this analytics screenshot." },
              ],
            },
          ],
          READ_SYSTEM
        );
        reads.push(parseJson(raw));
      }
      setProgress("Reading the numbers");
      const facts = `Transcribed analytics:
${JSON.stringify(reads)}

Strategy context: ${(strategy.text || "No strategy text on file.").slice(0, 1200)}`;
      const diagnosis = parseJson(
        await askClaude(
          [{ role: "user", content: `${facts}\n\nRead this performance.` }],
          DIAGNOSE_SYSTEM
        )
      );
      setProgress("Building next month's plan");
      const plan = parseJson(
        await askClaude(
          [
            {
              role: "user",
              content: `${facts}

Your read of the performance:
${JSON.stringify(diagnosis)}

Write next month's plan.`,
            },
          ],
          PLAN_SYSTEM
        )
      );
      const report = {
        id: uid(),
        createdAt: new Date().toISOString(),
        sources: files.map((f) => f.name),
        reads,
        body: { ...diagnosis, ...plan },
      };
      setReports([report, ...reports]);
      setFiles([]);
    } catch (err) {
      setError(err.message || "The report failed. Try again.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Step 3 &middot; {clientName || "Report back"}</Eyebrow>
            <h2
              className="text-2xl"
              style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK, letterSpacing: "-0.01em" }}
            >
              Analytics report
            </h2>
            <p className="text-sm mt-1 max-w-lg" style={{ fontFamily: BODY, color: GREY }}>
              Drop in screenshots from Instagram Insights or Meta Business Suite. Include views,
              reach, top content and followers. The numbers are transcribed first, then read back to
              you with what to double down on.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => ref.current && ref.current.click()}>
              <Upload size={14} /> Add screenshots
            </Button>
            <input ref={ref} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
            <Button tone="primary" onClick={build} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              {busy ? "Working" : "Generate report"}
            </Button>
          </div>
        </div>

        <Notice>{error}</Notice>

        {files.length ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {files.map((f, i) => (
              <div key={i} className="relative" style={{ border: `1px solid ${NAVY}` }}>
                <img
                  src={`data:${f.media};base64,${f.data}`}
                  alt={f.name}
                  className="h-24 w-24 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute top-0 right-0 px-1"
                  style={{ background: NAVY, color: WHITE }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {progress ? (
          <p className="mt-3 text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            {progress}
          </p>
        ) : null}
      </Panel>

      {!reports.length ? (
        <Empty
          icon={<ImageIcon size={28} />}
          title="No reports yet"
          body="Upload your first set of screenshots to build one."
        />
      ) : (
        reports.map((rep) => (
          <Panel key={rep.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>{new Date(rep.createdAt).toLocaleDateString()} report</Eyebrow>
                <h3
                  className="text-xl max-w-xl"
                  style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK, lineHeight: 1.25 }}
                >
                  {rep.body.headline}
                </h3>
              </div>
              <div className="flex gap-2">
                <Button
                  small
                  onClick={() =>
                    downloadBlob(
                      reportDoc(rep, clientName),
                      `${safeName(clientName)}-report-${rep.createdAt.slice(0, 10)}.doc`,
                      "application/msword"
                    )
                  }
                  title="Download this report as a Word document"
                >
                  <Download size={12} /> Download
                </Button>
                <Button
                  small
                  onClick={() => setReports(reports.filter((r) => r.id !== rep.id))}
                  title="Delete report"
                >
                  <Trash2 size={12} /> Delete
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(rep.reads || []).flatMap((r, ri) =>
                (r.metrics || []).map((m, mi) => (
                  <div
                    key={`${ri}-${mi}`}
                    className="px-3 py-2"
                    style={{ border: `1px solid ${LINE}`, background: TINT, minWidth: "130px" }}
                  >
                    <div
                      className="text-xs uppercase"
                      style={{ fontFamily: UTIL, letterSpacing: "0.1em", color: GREY }}
                    >
                      {m.label}
                    </div>
                    <div className="text-xl" style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK }}>
                      {m.value}
                    </div>
                    {m.change ? (
                      <div className="text-xs" style={{ fontFamily: UTIL, color: GREY }}>
                        {m.change}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {(rep.reads || []).some((r) => (r.topContent || []).length) ? (
              <div className="mt-4">
                <Eyebrow>Top content in these screenshots</Eyebrow>
                <div style={{ border: `1px solid ${LINE}` }}>
                  {(rep.reads || []).flatMap((r, ri) =>
                    (r.topContent || []).map((t, ti) => (
                      <div
                        key={`${ri}-${ti}`}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                        style={{ borderTop: ri + ti ? `1px solid ${LINE}` : "none" }}
                      >
                        <span className="text-sm" style={{ fontFamily: BODY, color: BLACK }}>
                          {t.label}
                        </span>
                        <span
                          className="text-sm shrink-0"
                          style={{ fontFamily: UTIL, fontWeight: 700, color: NAVY }}
                        >
                          {t.metric}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <p className="mt-4 text-sm" style={{ fontFamily: BODY, color: BLACK, lineHeight: 1.6 }}>
              {rep.body.summary}
            </p>

            {(() => {
              const b = normalizeBody(rep.body);
              return (
                <div className="mt-5">
                  <Eyebrow>Views, reach, top content and followers</Eyebrow>
                  <div className="mt-1 grid gap-3 lg:grid-cols-2">
                    {b.areas.map((a, i) => (
                      <AreaCard key={i} item={a} />
                    ))}
                  </div>

                  {b.doubleDown ? (
                    <div className="mt-5 p-4" style={{ background: NAVY, color: WHITE }}>
                      <div
                        className="text-xs uppercase mb-1"
                        style={{ fontFamily: UTIL, letterSpacing: "0.16em", color: SIDE_BODY }}
                      >
                        Double down next month
                      </div>
                      <p
                        className="text-lg"
                        style={{ fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1.35 }}
                      >
                        {b.doubleDown}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <Eyebrow>Recommendations &middot; with a number to hit</Eyebrow>
                    <div style={{ border: `1px solid ${LINE}` }}>
                      {b.recommendations.map((a, i) => (
                        <div
                          key={i}
                          className="p-3"
                          style={{ borderTop: i ? `1px solid ${LINE}` : "none" }}
                        >
                          <div className="flex items-start gap-3">
                            <Chip solid={String(a.priority).toLowerCase() === "high"}>
                              {a.priority}
                            </Chip>
                            <div>
                              <div
                                className="text-sm"
                                style={{ fontFamily: BODY, fontWeight: 600, color: BLACK }}
                              >
                                {a.action}
                              </div>
                              {a.why ? (
                                <div
                                  className="mt-1 text-sm"
                                  style={{ fontFamily: BODY, color: GREY }}
                                >
                                  {a.why}
                                </div>
                              ) : null}
                              {a.target ? (
                                <div
                                  className="mt-2 inline-block px-2 py-1 text-xs"
                                  style={{
                                    fontFamily: UTIL,
                                    color: BLACK,
                                    background: TINT,
                                    border: `1px solid ${LINE}`,
                                  }}
                                >
                                  Target: {a.target}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {b.watch ? (
                    <div
                      className="mt-4 inline-flex items-center gap-2 px-3 py-2"
                      style={{ border: `1px solid ${NAVY}`, color: BLACK }}
                    >
                      <ArrowRight size={14} />
                      <span className="text-sm" style={{ fontFamily: BODY, fontWeight: 600 }}>
                        Check weekly: {b.watch}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            <p className="mt-4 text-xs" style={{ fontFamily: UTIL, color: GREY }}>
              Sources: {(rep.sources || []).join(", ")}
            </p>
          </Panel>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. admin settings                                                   */
/* ------------------------------------------------------------------ */

function ListEditor({ label, hint, items, onChange }) {
  const [value, setValue] = useState("");
  return (
    <Panel>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-xs mb-3" style={{ fontFamily: BODY, color: GREY }}>
        {hint}
      </p>
      <div className="space-y-2 mb-3">
        {items.map((it, i) => (
          <div key={`${it}-${i}`} className="flex items-center gap-2">
            <TextInput
              value={it}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button small onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove option">
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        {!items.length ? (
          <p className="text-xs" style={{ fontFamily: UTIL, color: BLACK }}>
            No options left. Add one so the dropdown works.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <TextInput
          value={value}
          placeholder="New option"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              onChange([...items, value.trim()]);
              setValue("");
            }
          }}
        />
        <Button
          small
          onClick={() => {
            if (value.trim()) {
              onChange([...items, value.trim()]);
              setValue("");
            }
          }}
        >
          <Plus size={12} /> Add
        </Button>
      </div>
    </Panel>
  );
}

function ClientsPanel({ data }) {
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  return (
    <Panel>
      <Eyebrow>Clients</Eyebrow>
      <p className="text-xs mb-3" style={{ fontFamily: BODY, color: GREY }}>
        Every client is a separate workspace. Switching clients in the sidebar swaps the strategy,
        the calendar, the reports and the dropdowns together.
      </p>

      <div style={{ border: `1px solid ${LINE}` }}>
        {data.clients.map((c, i) => (
          <div
            key={c.id}
            className="p-3"
            style={{ borderTop: i ? `1px solid ${LINE}` : "none", background: c.id === data.activeId ? TINT : WHITE }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <TextInput value={c.name} onChange={(e) => data.onRename(c.id, e.target.value)} />
              {c.id === data.activeId ? <Chip solid>Open</Chip> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {c.id === data.activeId ? null : (
                <Button small onClick={() => data.onSwitch(c.id)}>
                  Open
                </Button>
              )}
              <Button small onClick={() => data.onDuplicate(c.id)} title="Copy the dropdowns and caption rules into a new client">
                Duplicate setup
              </Button>
              {confirmId === c.id ? (
                <>
                  <Button
                    small
                    tone="primary"
                    onClick={() => {
                      data.onDelete(c.id);
                      setConfirmId(null);
                    }}
                  >
                    <Trash2 size={12} /> Delete for good
                  </Button>
                  <Button small onClick={() => setConfirmId(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button small onClick={() => setConfirmId(c.id)} title="Delete this client">
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
            {confirmId === c.id ? (
              <p className="mt-2 text-xs" style={{ fontFamily: BODY, color: BLACK }}>
                This removes the strategy, calendar and reports for {c.name}. Download a backup first
                if you might need it.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <TextInput
          value={name}
          placeholder="New client name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              data.onAdd(name.trim());
              setName("");
            }
          }}
        />
        <Button
          small
          onClick={() => {
            if (name.trim()) {
              data.onAdd(name.trim());
              setName("");
            }
          }}
        >
          <Plus size={12} /> Add
        </Button>
      </div>
    </Panel>
  );
}

function DataPanel({ data, clientName }) {
  const ref = useRef(null);

  async function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await fileToText(f);
    data.onImport(text);
    e.target.value = "";
  }

  return (
    <Panel>
      <Eyebrow>Save, download and restore</Eyebrow>
      <p className="text-xs mb-3" style={{ fontFamily: BODY, color: GREY }}>
        Work saves on its own as you go, for every client. Download a backup when you want a copy off
        this app, or to move your clients to another machine or another account.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={data.onExportAll}>
          <Download size={14} /> Download all clients
        </Button>
        <Button onClick={data.onExportClient}>
          <Download size={14} /> Download {clientName || "this client"}
        </Button>
        <Button onClick={() => ref.current && ref.current.click()}>
          <Upload size={14} /> Restore from backup
        </Button>
        <input ref={ref} type="file" accept=".json,application/json" onChange={onPick} className="hidden" />
      </div>
      <p className="mt-3 text-xs" style={{ fontFamily: BODY, color: GREY }}>
        Restoring adds the clients from the file next to the ones you already have. Nothing is
        overwritten. The strategy PDFs themselves are not inside a backup, but their grades and
        markups are.
      </p>
    </Panel>
  );
}

function SettingsTab({ settings, setSettings, onReset, data, clientName }) {
  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Admin</Eyebrow>
            <h2
              className="text-2xl"
              style={{ fontFamily: DISPLAY, fontWeight: 700, color: BLACK, letterSpacing: "-0.01em" }}
            >
              Dropdown options
            </h2>
            <p className="text-sm mt-1 max-w-lg" style={{ fontFamily: BODY, color: GREY }}>
              These dropdowns belong to {clientName || "this client"} alone. Set them before you build
              the month. Changes save as you type.
            </p>
          </div>
          <Button onClick={onReset}>
            <RotateCcw size={14} /> Restore defaults
          </Button>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <ClientsPanel data={data} />
        <DataPanel data={data} clientName={clientName} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ListEditor
          label="Platforms"
          hint="Rotated across the schedule when you build the month."
          items={settings.platforms}
          onChange={(platforms) => setSettings({ ...settings, platforms })}
        />
        <ListEditor
          label="Content pillars"
          hint="The planner only assigns pillars from this list."
          items={settings.pillars}
          onChange={(pillars) => setSettings({ ...settings, pillars })}
        />
        <ListEditor
          label="Content types"
          hint="Formats your team can actually produce."
          items={settings.contentTypes}
          onChange={(contentTypes) => setSettings({ ...settings, contentTypes })}
        />
        <ListEditor
          label="Statuses"
          hint="First status is applied to every new row. Order sets how dark the pill reads."
          items={settings.statuses}
          onChange={(statuses) => setSettings({ ...settings, statuses })}
        />
      </div>

      <Panel>
        <Eyebrow>Caption rules</Eyebrow>
        <p className="text-xs mb-3" style={{ fontFamily: BODY, color: GREY }}>
          Passed to the caption writer on every build. Use it to lock brand voice, hashtag count and
          formatting.
        </p>
        <textarea
          rows={4}
          value={settings.captionRules}
          onChange={(e) => setSettings({ ...settings, captionRules: e.target.value })}
          className="w-full p-3 text-sm focus:outline-none"
          style={inputStyle}
        />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shell                                                               */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: "strategy", label: "Strategy review", icon: ClipboardCheck },
  { id: "calendar", label: "Content calendar", icon: CalendarDays },
  { id: "analytics", label: "Analytics report", icon: BarChart3 },
  { id: "settings", label: "Admin settings", icon: Sliders },
];

export default function ContentOps() {
  const [tab, setTab] = useState("strategy");
  const [ready, setReady] = useState(false);
  const [clients, setClients] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [core, setCore] = useState(emptyCore());
  const [note, setNote] = useState("");
  const owner = useRef(null);

  const activeClient = clients.find((c) => c.id === activeId) || null;

  useEffect(() => {
    const id = "contentops-fonts";
    if (typeof document !== "undefined" && !document.getElementById(id)) {
      const l = document.createElement("link");
      l.id = id;
      l.rel = "stylesheet";
      l.href =
        "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap";
      document.head.appendChild(l);
    }
  }, []);

  async function openClient(id, list) {
    const roster = list || clients;
    const [c, f] = await Promise.all([loadKey(coreKey(id), null), loadKey(fileKey(id), null)]);
    const loaded = normalizeCore(c);
    if (f && f.attachment) loaded.strategy = { ...loaded.strategy, attachment: f.attachment };
    owner.current = id;
    setActiveId(id);
    setCore(loaded);
    setClients(roster);
  }

  /* first load: pull the client list, open the last one used */
  useEffect(() => {
    let live = true;
    (async () => {
      const index = await loadKey(K_INDEX, null);
      if (!live) return;
      let roster = (index && Array.isArray(index.clients) ? index.clients : []).filter((c) => c && c.id);
      if (!roster.length) {
        const seed = { id: uid(), name: "My first client" };
        roster = [seed];
        await saveKey(K_INDEX, { clients: roster, activeId: seed.id });
        await saveKey(coreKey(seed.id), emptyCore());
      }
      const wanted = roster.find((c) => c.id === (index && index.activeId)) || roster[0];
      await openClient(wanted.id, roster);
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  /* save the open client, splitting the uploaded PDF into its own record */
  useEffect(() => {
    if (!ready || !activeId || owner.current !== activeId) return;
    const { attachment, ...strategyRest } = core.strategy || {};
    saveSoon(coreKey(activeId), {
      ...core,
      strategy: { ...strategyRest, hadAttachment: !!attachment },
    });
    if (attachment) {
      const mb = (attachment.data || "").length / 1400000;
      if (mb < 3) {
        saveSoon(fileKey(activeId), { attachment });
      } else {
        setNote("That PDF is too large to keep after a refresh. The grade is saved, the file is not.");
      }
    }
  }, [core, ready, activeId]);

  useEffect(() => {
    if (ready && activeId) saveSoon(K_INDEX, { clients, activeId }, 300);
  }, [clients, activeId, ready]);

  const setSettings = (settings) =>
    setCore((c) => ({ ...c, settings: typeof settings === "function" ? settings(c.settings) : settings }));
  const setStrategy = (strategy) => setCore((c) => ({ ...c, strategy }));
  const setCalendar = (calendar) => setCore((c) => ({ ...c, calendar }));
  const setReports = (reports) => setCore((c) => ({ ...c, reports }));

  async function switchClient(id) {
    if (id === activeId) return;
    setReady(false);
    await openClient(id);
    setReady(true);
    setNote("");
  }

  async function addClient(name) {
    const client = { id: uid(), name: (name || "").trim() || "New client" };
    const roster = [...clients, client];
    await saveKey(coreKey(client.id), emptyCore());
    setReady(false);
    await openClient(client.id, roster);
    setReady(true);
    setTab("strategy");
  }

  function renameClient(id, name) {
    setClients(clients.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  async function duplicateClient(id) {
    const source = clients.find((c) => c.id === id);
    const loaded = normalizeCore(await loadKey(coreKey(id), null));
    const client = { id: uid(), name: `${source ? source.name : "Client"} copy` };
    /* the setup carries over, the client's own work does not */
    await saveKey(coreKey(client.id), { ...emptyCore(), settings: loaded.settings });
    const roster = [...clients, client];
    setReady(false);
    await openClient(client.id, roster);
    setReady(true);
  }

  async function deleteClient(id) {
    const roster = clients.filter((c) => c.id !== id);
    await deleteKey(coreKey(id));
    await deleteKey(fileKey(id));
    if (!roster.length) {
      const seed = { id: uid(), name: "My first client" };
      await saveKey(coreKey(seed.id), emptyCore());
      setReady(false);
      await openClient(seed.id, [seed]);
      setReady(true);
      return;
    }
    setClients(roster);
    if (id === activeId) {
      setReady(false);
      await openClient(roster[0].id, roster);
      setReady(true);
    }
  }

  /* download every client as one backup file */
  async function exportWorkspace() {
    const payload = { app: "ContentOps", version: 1, exportedAt: new Date().toISOString(), clients: [] };
    for (const c of clients) {
      const loaded = c.id === activeId ? core : normalizeCore(await loadKey(coreKey(c.id), null));
      const { attachment, ...strategyRest } = loaded.strategy || {};
      payload.clients.push({
        id: c.id,
        name: c.name,
        core: { ...loaded, strategy: strategyRest },
      });
    }
    downloadBlob(JSON.stringify(payload, null, 2), "contentops-backup.json", "application/json");
    setNote("Backup downloaded. Uploaded PDFs are not inside it, everything else is.");
  }

  function exportClient() {
    const { attachment, ...strategyRest } = core.strategy || {};
    const payload = {
      app: "ContentOps",
      version: 1,
      exportedAt: new Date().toISOString(),
      clients: [
        {
          id: activeId,
          name: activeClient ? activeClient.name : "Client",
          core: { ...core, strategy: strategyRest },
        },
      ],
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `contentops-${safeName(activeClient && activeClient.name)}.json`,
      "application/json"
    );
  }

  /* upload a backup and add its clients alongside the current ones */
  async function importWorkspace(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      setNote("That file is not a ContentOps backup. Upload the .json file you downloaded from here.");
      return;
    }
    const incoming = Array.isArray(data && data.clients) ? data.clients : [];
    if (!incoming.length) {
      setNote("That backup has no clients in it.");
      return;
    }
    const roster = [...clients];
    for (const entry of incoming) {
      const id = uid();
      const taken = roster.some((c) => c.name === entry.name);
      roster.push({ id, name: taken ? `${entry.name} (restored)` : entry.name || "Restored client" });
      await saveKey(coreKey(id), normalizeCore(entry.core));
    }
    setReady(false);
    await openClient(roster[roster.length - 1].id, roster);
    setReady(true);
    setNote(`Restored ${incoming.length} ${incoming.length === 1 ? "client" : "clients"}.`);
  }

  const { settings, strategy, calendar, reports } = core;
  const score = strategy.review ? Number(strategy.review.score) || 0 : null;
  const rowCount = (calendar.rows || []).length;
  const clientName = activeClient ? activeClient.name : "";

  const dataTools = {
    clients,
    activeId,
    onSwitch: switchClient,
    onAdd: addClient,
    onRename: renameClient,
    onDuplicate: duplicateClient,
    onDelete: deleteClient,
    onExportAll: exportWorkspace,
    onExportClient: exportClient,
    onImport: importWorkspace,
    loadCore: (id) => loadKey(coreKey(id), null),
  };

  return (
    <div className="min-h-screen w-full" style={{ background: WHITE, fontFamily: BODY }}>
      <div className="flex flex-col lg:flex-row">
        <aside className="lg:w-64 lg:min-h-screen shrink-0" style={{ background: BLACK, color: WHITE }}>
          <div className="p-5" style={{ borderBottom: `1px solid #2A2A2A` }}>
            <div
              className="text-xs uppercase mb-2"
              style={{ fontFamily: UTIL, letterSpacing: "0.2em", color: SIDE_DIM }}
            >
              VA workroom
            </div>
            <div
              className="text-2xl leading-none"
              style={{ fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.02em" }}
            >
              ContentOps
            </div>
            <p className="mt-2 text-xs" style={{ fontFamily: BODY, color: SIDE_BODY }}>
              Grade the strategy. Build the month. Report the numbers.
            </p>
          </div>

          <div className="p-5" style={{ borderBottom: `1px solid #2A2A2A` }}>
            <div
              className="text-xs uppercase mb-2"
              style={{ fontFamily: UTIL, letterSpacing: "0.16em", color: SIDE_DIM }}
            >
              Client
            </div>
            <select
              value={activeId || ""}
              onChange={(e) => switchClient(e.target.value)}
              className="w-full px-2 py-2 text-sm focus:outline-none"
              style={{ fontFamily: BODY, background: WHITE, color: BLACK, border: `1px solid ${WHITE}` }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => addClient("New client")}
              className="mt-2 w-full flex items-center justify-center gap-2 px-2 py-2 text-xs uppercase"
              style={{
                fontFamily: UTIL,
                letterSpacing: "0.1em",
                background: NAVY,
                color: WHITE,
                border: `1px solid ${NAVY}`,
              }}
            >
              <Plus size={13} /> Add client
            </button>
            <p className="mt-2 text-xs" style={{ fontFamily: BODY, color: SIDE_DIM }}>
              Each client keeps its own strategy, calendar, reports and dropdowns.
            </p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="flex items-center gap-2 px-3 py-3 text-left text-xs uppercase whitespace-nowrap"
                  style={{
                    fontFamily: UTIL,
                    letterSpacing: "0.1em",
                    background: active ? NAVY : "transparent",
                    color: active ? WHITE : SIDE_BODY,
                    borderLeft: active ? `4px solid ${WHITE}` : "4px solid transparent",
                  }}
                >
                  <Icon size={15} />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="p-5 hidden lg:block" style={{ borderTop: `1px solid #2A2A2A` }}>
            <div
              className="text-xs uppercase mb-3"
              style={{ fontFamily: UTIL, letterSpacing: "0.16em", color: SIDE_DIM }}
            >
              {clientName || "Job status"}
            </div>
            <dl className="space-y-2 text-xs" style={{ fontFamily: UTIL }}>
              <div className="flex justify-between">
                <dt style={{ color: SIDE_DIM }}>Strategy</dt>
                <dd style={{ color: score === null ? SIDE_DIM : WHITE }}>
                  {score === null ? "ungraded" : `${score}/100`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt style={{ color: SIDE_DIM }}>Posts planned</dt>
                <dd style={{ color: rowCount ? WHITE : SIDE_DIM }}>{rowCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt style={{ color: SIDE_DIM }}>Reports</dt>
                <dd style={{ color: reports.length ? WHITE : SIDE_DIM }}>{reports.length}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs" style={{ fontFamily: BODY, color: SIDE_DIM }}>
              Work saves by itself and is here when you come back.
            </p>
          </div>
        </aside>

        <main className="flex-1 p-5 lg:p-8">
          {note ? (
            <div
              className="flex items-start justify-between gap-3 p-3 mb-5 text-sm"
              style={{ border: `1px solid ${BLACK}`, background: TINT, color: BLACK, fontFamily: BODY }}
            >
              <span>{note}</span>
              <button type="button" onClick={() => setNote("")} title="Dismiss">
                <X size={14} />
              </button>
            </div>
          ) : null}

          {!ready ? (
            <div className="flex items-center gap-2 text-sm" style={{ fontFamily: UTIL, color: GREY }}>
              <Loader2 size={14} className="animate-spin" /> Opening the workroom
            </div>
          ) : tab === "strategy" ? (
            <StrategyTab
              key={activeId}
              strategy={strategy}
              setStrategy={setStrategy}
              settings={settings}
              clientName={clientName}
            />
          ) : tab === "calendar" ? (
            <CalendarTab
              key={activeId}
              strategy={strategy}
              setStrategy={setStrategy}
              calendar={calendar}
              setCalendar={setCalendar}
              settings={settings}
              clientName={clientName}
            />
          ) : tab === "analytics" ? (
            <AnalyticsTab
              key={activeId}
              reports={reports}
              setReports={setReports}
              strategy={strategy}
              clientName={clientName}
            />
          ) : (
            <SettingsTab
              key={activeId}
              settings={settings}
              setSettings={setSettings}
              onReset={() => setSettings(DEFAULT_SETTINGS)}
              data={dataTools}
              clientName={clientName}
            />
          )}
        </main>
      </div>
    </div>
  );
}
