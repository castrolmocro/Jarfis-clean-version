#!/usr/bin/env node
"use strict";
/**
 * GitHub API Push Script
 * يرفع جميع ملفات المشروع إلى GitHub باستخدام REST API
 */

const https  = require("https");
const fs     = require("fs");
const path   = require("path");

const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const OWNER = "castrolmocro";
const REPO  = "Jarfis-clean-version";
const BASE  = path.join(__dirname, "..");

const IGNORE = new Set([
  ".git", "node_modules", ".local", "data", ".env",
  "account.txt", "appstate.json", "data/bot.db",
  "src/dashboard/public/uploads",
]);

function shouldIgnore(relPath) {
  const parts = relPath.split(path.sep);
  for (const part of parts) {
    if (IGNORE.has(part)) return true;
  }
  return false;
}

function getAllFiles(dir, base = dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    if (shouldIgnore(rel)) continue;
    if (entry.isDirectory()) {
      results.push(...getAllFiles(abs, base));
    } else {
      results.push({ abs, rel: rel.replace(/\\/g, "/") });
    }
  }
  return results;
}

function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.github.com",
      path:     `/repos/${OWNER}/${REPO}${endpoint}`,
      method,
      headers: {
        "Authorization": `token ${TOKEN}`,
        "User-Agent":    "jarfis-push-script",
        "Content-Type":  "application/json",
        "Accept":        "application/vnd.github.v3+json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createBlob(content) {
  const isBinary = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|db)$/i.test("");
  const res = await apiRequest("POST", "/git/blobs", {
    content:  Buffer.from(content).toString("base64"),
    encoding: "base64",
  });
  return res.body.sha;
}

async function main() {
  if (!TOKEN) { console.error("❌ GITHUB_PERSONAL_ACCESS_TOKEN غير موجود"); process.exit(1); }

  console.log(`🚀 جاري الرفع إلى ${OWNER}/${REPO} ...`);

  const branchRes = await apiRequest("GET", "/git/refs/heads/main");
  let latestSha, treeSha;

  if (branchRes.status === 200) {
    latestSha = branchRes.body.object.sha;
    const commitRes = await apiRequest("GET", `/git/commits/${latestSha}`);
    treeSha = commitRes.body.tree.sha;
    console.log(`✔ الفرع الحالي: main — ${latestSha.slice(0,7)}`);
  } else {
    const masterRes = await apiRequest("GET", "/git/refs/heads/master");
    if (masterRes.status === 200) {
      latestSha = masterRes.body.object.sha;
      const commitRes = await apiRequest("GET", `/git/commits/${latestSha}`);
      treeSha = commitRes.body.tree.sha;
    } else {
      console.error("❌ لم يُعثر على فرع main أو master"); process.exit(1);
    }
  }

  const files = getAllFiles(BASE);
  console.log(`📁 عدد الملفات: ${files.length}`);

  const treeItems = [];
  let done = 0;
  for (const { abs, rel } of files) {
    const content = fs.readFileSync(abs);
    const sha = await createBlob(content);
    treeItems.push({ path: rel, mode: "100644", type: "blob", sha });
    done++;
    if (done % 10 === 0) console.log(`  ↳ ${done}/${files.length} ملف...`);
  }

  const newTreeRes = await apiRequest("POST", "/git/trees", {
    base_tree: treeSha,
    tree:      treeItems,
  });
  const newTreeSha = newTreeRes.body.sha;

  const now = new Date().toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" });
  const commitRes = await apiRequest("POST", "/git/commits", {
    message: `🤖 jarfis v3.1 — تحديث تلقائي ${now}`,
    tree:    newTreeSha,
    parents: [latestSha],
  });
  const newCommitSha = commitRes.body.sha;

  const branch = branchRes.status === 200 ? "main" : "master";
  await apiRequest("PATCH", `/git/refs/heads/${branch}`, {
    sha:   newCommitSha,
    force: false,
  });

  console.log(`\n✅ تم الرفع بنجاح!`);
  console.log(`🔗 https://github.com/${OWNER}/${REPO}`);
  console.log(`📝 Commit: ${newCommitSha.slice(0,7)}`);
}

main().catch(err => { console.error("❌ خطأ:", err.message); process.exit(1); });
