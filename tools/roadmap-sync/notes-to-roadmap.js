import fs from "node:fs";
import path from "node:path";

function fail(msg) {
  throw new Error(msg);
}

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

function writeFile(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}

function extractBlock(md) {
  const begin = "<!-- ROADMAP_UPDATE:BEGIN -->";
  const end = "<!-- ROADMAP_UPDATE:END -->";
  const i = md.indexOf(begin);
  const j = md.indexOf(end);
  if (i === -1 || j === -1 || j <= i) fail("Could not find ROADMAP_UPDATE block markers.");
  return md.slice(i + begin.length, j).trim();
}

function splitLines(s) {
  return s.replace(/\r\n/g, "\n").split("\n");
}

function countIndent(line) {
  const m = line.match(/^(\s*)/);
  return (m?.[1] ?? "").replace(/\t/g, "  ").length;
}

function trimCommenty(line) {
  return line.replace(/\s+#.*$/, "");
}

function parseScalar(v) {
  const t = String(v).trim();
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  // strip surrounding quotes if present
  const q = t.match(/^"(.*)"$/) || t.match(/^'(.*)'$/);
  if (q) return q[1];
  return t;
}

/**
 * Minimal YAML-like parser for the specific format we define in docs/roadmap-notes.md
 * Supports:
 * - key: value
 * - key:
 *     nested:
 * - lists:
 *   - item
 *   - key: value
 * - multiline: |
 *     lines...
 */
function parseMiniYaml(block) {
  const lines = splitLines(block)
    .map(trimCommenty)
    .filter(l => l.trim().length > 0);

  let idx = 0;

  function peek() {
    return lines[idx] ?? null;
  }

  function next() {
    return lines[idx++] ?? null;
  }

  function parseValueLine(line) {
    const m = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
    if (!m) return null;
    return { key: m[1].trim(), rest: m[2] ?? "" };
  }

  function parseInlineArray(rest) {
    const r = rest.trim();
    if (!r.startsWith("[") || !r.endsWith("]")) return null;
    const inner = r.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map(x => parseScalar(x.trim()));
  }

  function parseBlock(currentIndent) {
    const obj = {};
    while (true) {
      const line = peek();
      if (!line) break;

      const indent = countIndent(line);
      if (indent < currentIndent) break;
      if (indent > currentIndent) fail(`Unexpected indent at line: ${line}`);

      // list item?
      if (line.trim().startsWith("- ")) {
        // caller should handle lists
        break;
      }

      const kv = parseValueLine(line);
      if (!kv) fail(`Invalid line: ${line}`);

      next();

      const { key, rest } = kv;

      if (rest.trim() === "|") {
        // multiline string
        const out = [];
        while (true) {
          const l2 = peek();
          if (!l2) break;
          const i2 = countIndent(l2);
          if (i2 <= currentIndent) break;
          // remove one indentation level beyond currentIndent
          out.push(l2.slice(currentIndent + 2));
          next();
        }
        obj[key] = out.join("\n").replace(/\s+$/g, "");
        continue;
      }

      const arr = parseInlineArray(rest);
      if (arr) {
        obj[key] = arr;
        continue;
      }

      if (rest.trim() !== "") {
        obj[key] = parseScalar(rest);
        continue;
      }

      // rest empty -> nested structure (object or list)
      const l2 = peek();
      if (!l2) {
        obj[key] = {};
        continue;
      }

      const i2 = countIndent(l2);
      if (i2 <= currentIndent) {
        obj[key] = {};
        continue;
      }

      if (l2.trim().startsWith("- ")) {
        obj[key] = parseList(i2);
      } else {
        obj[key] = parseBlock(i2);
      }
    }
    return obj;
  }

  function parseList(listIndent) {
    const arr = [];
    while (true) {
      const line = peek();
      if (!line) break;
      const indent = countIndent(line);
      if (indent < listIndent) break;
      if (indent > listIndent) fail(`Unexpected indent in list at line: ${line}`);

      if (!line.trim().startsWith("- ")) break;

      const content = line.trim().slice(2);
      next();

      // simple scalar list item
      if (!content.includes(":")) {
        arr.push(parseScalar(content));
        continue;
      }

      // object list item, first kv inline then maybe nested follows
      const kv = parseValueLine(content);
      if (!kv) fail(`Invalid list object item: ${line}`);
      const item = {};

      // handle inline value or nesting
      if (kv.rest.trim() === "|") {
        // multiline under list item: consume lines with greater indent than listIndent
        const out = [];
        while (true) {
          const l2 = peek();
          if (!l2) break;
          const i2 = countIndent(l2);
          if (i2 <= listIndent) break;
          out.push(l2.slice(listIndent + 2));
          next();
        }
        item[kv.key] = out.join("\n").replace(/\s+$/g, "");
      } else if (kv.rest.trim() !== "") {
        const arrInline = parseInlineArray(kv.rest);
        item[kv.key] = arrInline ? arrInline : parseScalar(kv.rest);
      } else {
        // nested structure
        const l2 = peek();
        if (!l2) item[kv.key] = {};
        else {
          const i2 = countIndent(l2);
          if (i2 <= listIndent) item[kv.key] = {};
          else if (l2.trim().startsWith("- ")) item[kv.key] = parseList(i2);
          else item[kv.key] = parseBlock(i2);
        }
      }

      // Merge any subsequent nested key-values at deeper indent into the same object item
      while (true) {
        const l2 = peek();
        if (!l2) break;
        const i2 = countIndent(l2);
        if (i2 <= listIndent) break;
        if (l2.trim().startsWith("- ")) break;

        const kv2 = parseValueLine(l2);
        if (!kv2) fail(`Invalid nested kv in list object: ${l2}`);
        next();

        if (kv2.rest.trim() === "|") {
          const out = [];
          while (true) {
            const l3 = peek();
            if (!l3) break;
            const i3 = countIndent(l3);
            if (i3 <= i2) break;
            out.push(l3.slice(i2 + 2));
            next();
          }
          item[kv2.key] = out.join("\n").replace(/\s+$/g, "");
        } else if (kv2.rest.trim() !== "") {
          const a2 = parseInlineArray(kv2.rest);
          item[kv2.key] = a2 ? a2 : parseScalar(kv2.rest);
        } else {
          const l3 = peek();
          if (!l3) item[kv2.key] = {};
          else {
            const i3 = countIndent(l3);
            if (i3 <= i2) item[kv2.key] = {};
            else if (l3.trim().startsWith("- ")) item[kv2.key] = parseList(i3);
            else item[kv2.key] = parseBlock(i3);
          }
        }
      }

      arr.push(item);
    }
    return arr;
  }

  const root = parseBlock(0);
  return root;
}

function normalizeToRoadmapJson(parsed) {
  const owner = parsed.OWNER;
  const repos = parsed.REPOS;
  const labels = parsed.LABELS || [];
  const milestones = parsed.MILESTONES || [];

  if (!owner || typeof owner !== "string") fail("OWNER must be set in ROADMAP_UPDATE block.");
  if (!repos || typeof repos !== "object") fail("REPOS must be set in ROADMAP_UPDATE block.");

  // Validate milestone schema
  for (const m of milestones) {
    if (!m.repoKey) fail("Each milestone must include repoKey");
    if (!m.title) fail("Each milestone must include title");
    if (!Array.isArray(m.issues)) m.issues = [];
    for (const iss of m.issues) {
      if (!iss.title) fail(`Issue missing title in milestone ${m.title}`);
      if (!iss.body) iss.body = "";
      if (!Array.isArray(iss.labels)) iss.labels = [];
    }
  }

  return {
    version: "1.0",
    defaultOwner: owner,
    repos,
    labels,
    milestones
  };
}

function main() {
  const notesPath = process.env.NOTES_PATH || "docs/roadmap-notes.md";
  const outPath = process.env.OUT_PATH || "roadmap.json";

  const md = readFile(notesPath);
  const block = extractBlock(md);
  const parsed = parseMiniYaml(block);
  const roadmap = normalizeToRoadmapJson(parsed);

  writeFile(outPath, JSON.stringify(roadmap, null, 2) + "\n");
  console.log(`Wrote ${outPath} from ${notesPath}`);
}

main();
