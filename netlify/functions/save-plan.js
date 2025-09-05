// netlify/functions/save-plan.js
// Saves planner JSON to GitHub as plans/plan-YYYY-MM-DD.json on GH_BRANCH.

const GH_API = "https://api.github.com";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors() };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const token = process.env.GH_TOKEN;
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  const branch = process.env.GH_BRANCH || "main";
  const prefix = (process.env.GH_PATH_PREFIX || "plans").replace(/^\/+|\/+$/g, "");

  if (!token || !owner || !repo) {
    return { statusCode: 500, headers: cors(), body: "Server not configured" };
  }
  if (!event.body) {
    return { statusCode: 400, headers: cors(), body: "Empty body" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: cors(), body: "Invalid JSON" };
  }

  // Minimal validation
  if (!data.week_start || !Array.isArray(data.workouts)) {
    return { statusCode: 400, headers: cors(), body: "Missing week_start/workouts" };
  }
  const week = String(data.week_start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return { statusCode: 400, headers: cors(), body: "week_start must be YYYY-MM-DD" };
  }

  // Destination path in repo
  const dir = prefix ? `${prefix}` : "";
  const filename = `plan-${week}.json`;
  const path = dir ? `${dir}/${filename}` : filename;

  // Prepare content
  const content = Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64");
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "netlify-function-planner",
  };

  // If file exists, we need its sha to update
  let sha;
  const getUrl = `${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const getRes = await fetch(getUrl, { headers });
  if (getRes.status === 200) {
    const info = await getRes.json();
    sha = info.sha;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    return { statusCode: 502, headers: cors(), body: `GitHub GET failed (${getRes.status}): ${text}` };
  }

  // Create/Update file
  const putUrl = `${GH_API}/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message: `feat(planner): save ${filename} from Netlify`,
    content,
    branch,
    sha, // undefined for create, set for update
    committer: { name: "planner-bot", email: "planner@users.noreply.github.com" },
    author: { name: "planner-bot", email: "planner@users.noreply.github.com" },
  };

  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const putText = await putRes.text();
  if (!putRes.ok) {
    return { statusCode: 502, headers: cors(), body: `GitHub PUT failed (${putRes.status}): ${putText}` };
  }

  const out = JSON.parse(putText);
  return {
    statusCode: 200,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, path, commit_url: out.commit && out.commit.html_url }),
  };
};

