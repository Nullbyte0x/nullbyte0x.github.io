const fs = require("fs");
const path = require("path");

const postsRoot = path.join(__dirname, "posts");
const outputPath = path.join(postsRoot, "index.json");
const routeSegmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return "";
  }
  const normalized = value.trim();
  return Number.isNaN(Date.parse(normalized + "T00:00:00Z")) ? "" : normalized;
}

function normalizeTags(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map(function (entry) {
      return entry.trim();
    })
    .filter(Boolean);
}

function parseFrontMatter(markdownText) {
  const normalized = String(markdownText || "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }
  const raw = normalized.slice(4, closingIndex);
  const attributes = {};
  raw.split("\n").forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      return;
    }
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    attributes[key] = trimmed.slice(separator + 1).trim();
  });
  return attributes;
}

function collectMarkdownFiles() {
  if (!fs.existsSync(postsRoot)) {
    return [];
  }
  const entries = [];
  fs.readdirSync(postsRoot, { withFileTypes: true }).forEach(function (category) {
    if (!category.isDirectory() || !routeSegmentPattern.test(category.name)) {
      return;
    }
    const categoryPath = path.join(postsRoot, category.name);
    fs.readdirSync(categoryPath, { withFileTypes: true }).forEach(function (file) {
      if (!file.isFile() || !file.name.toLowerCase().endsWith(".md")) {
        return;
      }
      const slug = file.name.slice(0, -3);
      if (!routeSegmentPattern.test(slug)) {
        return;
      }
      entries.push({
        category: category.name,
        slug: slug,
        absolutePath: path.join(categoryPath, file.name),
        path: "posts/" + category.name + "/" + file.name
      });
    });
  });
  return entries;
}

function buildPosts() {
  const posts = [];
  const skipped = [];
  collectMarkdownFiles().forEach(function (entry) {
    const attributes = parseFrontMatter(fs.readFileSync(entry.absolutePath, "utf8"));
    const title = attributes ? normalizeText(attributes.title) : "";
    const date = attributes ? normalizeDate(attributes.date) : "";
    if (!title || !date) {
      skipped.push(entry.path);
      return;
    }
    posts.push({
      title: title,
      date: date,
      category: entry.category,
      slug: entry.slug,
      description: normalizeText(attributes.description),
      tags: normalizeTags(attributes.tags),
      path: entry.path
    });
  });
  posts.sort(function (left, right) {
    return Date.parse(right.date + "T00:00:00Z") - Date.parse(left.date + "T00:00:00Z");
  });
  return { posts: posts, skipped: skipped };
}

const result = buildPosts();
const manifest = {
  generated: new Date().toISOString(),
  count: result.posts.length,
  posts: result.posts
};
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("Wrote " + result.posts.length + " post(s) to posts/index.json");
result.skipped.forEach(function (skippedPath) {
  console.warn("Skipped (missing title/date): " + skippedPath);
});
