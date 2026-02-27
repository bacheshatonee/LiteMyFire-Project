import fs from "node:fs";
import path from "node:path";
import core from "@actions/core";
import { Octokit } from "@octokit/rest";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function normalizeLabelName(s) {
  return String(s || "").trim();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ensureLabels(octokit, { owner, repo, labels }) {
  const existing = await octokit.paginate(octokit.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100
  });

  const existingByName = new Map(existing.map(l => [normalizeLabelName(l.name), l]));

  for (const label of labels) {
    const name = normalizeLabelName(label.name);
    if (!name) continue;

    const found = existingByName.get(name);
    if (!found) {
      await octokit.issues.createLabel({
        owner,
        repo,
        name,
        color: label.color || "ededed",
        description: label.description || ""
      });
      continue;
    }

    const desiredColor = (label.color || "").toLowerCase();
    const desiredDesc = label.description || "";
    const needsUpdate =
      (desiredColor && (found.color || "").toLowerCase() !== desiredColor) ||
      (found.description || "") !== desiredDesc;

    if (needsUpdate) {
      await octokit.issues.updateLabel({
        owner,
        repo,
        name,
        color: desiredColor || found.color,
        description: desiredDesc
      });
    }
  }
}

async function ensureMilestone(octokit, { owner, repo, title, description, dueOn }) {
  const milestones = await octokit.paginate(octokit.issues.listMilestones, {
    owner,
    repo,
    state: "all",
    per_page: 100
  });

  const found = milestones.find(m => m.title === title);
  if (!found) {
    const created = await octokit.issues.createMilestone({
      owner,
      repo,
      title,
      description: description || "",
      due_on: dueOn || undefined
    });
    return created.data;
  }

  const needsUpdate =
    (found.description || "") !== (description || "") ||
    ((found.due_on || null) !== (dueOn || null));

  if (needsUpdate) {
    const updated = await octokit.issues.updateMilestone({
      owner,
      repo,
      milestone_number: found.number,
      title,
      description: description || "",
      due_on: dueOn || undefined,
      state: found.state
    });
    return updated.data;
  }

  return found;
}

async function findIssueByTitle(octokit, { owner, repo, title }) {
  // GitHub search is best-effort; this looks for open+closed issues by exact title match
  const q = `repo:${owner}/${repo} is:issue "${title.replaceAll('"', '\\"')}" in:title`;
  const res = await octokit.search.issuesAndPullRequests({ q, per_page: 10 });
  const items = res.data.items || [];
  const exact = items.find(i => (i.title || "").trim() === title.trim());
  return exact || null;
}

async function upsertIssue(octokit, { owner, repo, issue, milestoneNumber }) {
  const title = issue.title.trim();
  const body = issue.body || "";
  const labels = (issue.labels || []).map(normalizeLabelName).filter(Boolean);

  const existing = await findIssueByTitle(octokit, { owner, repo, title });

  if (!existing) {
    const created = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
      milestone: milestoneNumber
    });
    return { action: "created", number: created.data.number, url: created.data.html_url };
  }

  const existingLabels = new Set((existing.labels || []).map(l => normalizeLabelName(l.name)));
  const labelsChanged =
    labels.length !== existingLabels.size ||
    labels.some(l => !existingLabels.has(l));

  const needsUpdate =
    (existing.body || "") !== body ||
    labelsChanged ||
    ((existing.milestone?.number || null) !== (milestoneNumber || null));

  if (!needsUpdate) {
    return { action: "noop", number: existing.number, url: existing.html_url };
  }

  const updated = await octokit.issues.update({
    owner,
    repo,
    issue_number: existing.number,
    title,
    body,
    labels,
    milestone: milestoneNumber || undefined
  });

  return { action: "updated", number: updated.data.number, url: updated.data.html_url };
}

async function main() {
  const owner = requireEnv("ROADMAP_OWNER");
  const roadmapPath = requireEnv("ROADMAP_PATH");
  const token = requireEnv("GITHUB_TOKEN");

  const octokit = new Octokit({ auth: token });

  const abs = path.isAbsolute(roadmapPath) ? roadmapPath : path.join(process.cwd(), roadmapPath);
  const roadmap = readJson(abs);

  const repos = roadmap.repos || {};
  const labels = roadmap.labels || [];
  const milestones = roadmap.milestones || [];

  // Determine which repos are referenced by milestones
  const reposUsed = new Set(milestones.map(m => m.repoKey).filter(Boolean));

  // Ensure labels exist in each repo we will touch
  for (const repoKey of reposUsed) {
    const repo = repos[repoKey];
    if (!repo) throw new Error(`roadmap.json: repos["${repoKey}"] missing`);
    core.info(`Ensuring labels in ${owner}/${repo}...`);
    await ensureLabels(octokit, { owner, repo, labels });
  }

  // Milestones + issues
  for (const m of milestones) {
    const repo = repos[m.repoKey];
    if (!repo) throw new Error(`roadmap.json: repos["${m.repoKey}"] missing`);
    core.info(`Ensuring milestone '${m.title}' in ${owner}/${repo}...`);

    const ms = await ensureMilestone(octokit, {
      owner,
      repo,
      title: m.title,
      description: m.description || "",
      dueOn: m.dueOn || null
    });

    const msNumber = ms.number;
    const issues = m.issues || [];

    core.info(`Syncing ${issues.length} issues into ${owner}/${repo} milestone #${msNumber}...`);

    const results = [];
    for (const issue of issues) {
      const r = await upsertIssue(octokit, { owner, repo, issue, milestoneNumber: msNumber });
      results.push(r);
      core.info(`${r.action.toUpperCase()}: #${r.number} ${r.url}`);
    }

    // Output summary
    const created = results.filter(r => r.action === "created").length;
    const updated = results.filter(r => r.action === "updated").length;
    const noop = results.filter(r => r.action === "noop").length;

    core.notice(`Milestone '${m.title}' in ${owner}/${repo}: created=${created}, updated=${updated}, noop=${noop}`);
  }
}

main().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
