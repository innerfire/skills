import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULTS,
  buildCleanSkillZip,
  cmsFetch,
  executeCommand,
  loadRuntimeConfig,
  markdownToLexical,
  mergeVersionHistory,
  normalizeAsciiFilename,
  predictFeedImpact,
} from "./ifas-cms.mjs";

async function withTempSession(fn, { role = "operator", enabled = true, expired = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ifas-cms-skill-test-"));
  const projectDir = join(dir, "projects", "ifas-cms");
  await mkdir(projectDir, { recursive: true });
  const expiresAt = expired ? Math.floor(Date.now() / 1000) - 10 : Math.floor(Date.now() / 1000) + 3600;
  await writeFile(
    join(projectDir, "session.json"),
    JSON.stringify({
      cookieName: "payload-token",
      token: "secret-jwt-token-do-not-leak",
      expiresAt,
      userEmail: "ops@innerfireai.com",
    }),
    { mode: 0o600 },
  );
  const env = { INNERFIRE_AUTH_CONFIG_DIR: dir };
  try {
    await fn({ dir, env, role, enabled });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("ifas-cms CLI runtime & security boundaries", () => {
  it("defaults to production https://ifasccms.innerfireai.com and isolates local override projectKey", () => {
    const prod = loadRuntimeConfig({});
    assert.equal(prod.cmsOrigin, "https://ifasccms.innerfireai.com");
    assert.equal(prod.projectKey, "ifas-cms");
    assert.equal(prod.isDefaultProd, true);
    assert.equal(DEFAULTS.maxUploadBytes, 100 * 1024 * 1024);

    const local = loadRuntimeConfig({ IFAS_CMS_ORIGIN: "http://127.0.0.1:3001/" });
    assert.equal(local.cmsOrigin, "http://127.0.0.1:3001");
    assert.equal(local.projectKey, "ifas-cms-local");
    assert.equal(local.isDefaultProd, false);
  });

  it("blocks physical delete verbs, HTTP DELETE, and admin-users mutations", async () => {
    await withTempSession(async ({ env }) => {
      await assert.rejects(
        () => executeCommand(["agents", "delete", "--id", "123"], { env }),
        (err) => err.code === "forbidden_operation",
      );
      await assert.rejects(
        () => executeCommand(["admin-users", "list"], { env }),
        (err) => err.code === "out_of_scope",
      );

      const cfg = loadRuntimeConfig(env);
      await assert.rejects(
        () =>
          cmsFetch(cfg, { cookieName: "payload-token", token: "tok" }, { method: "DELETE", path: "/api/agents/1" }),
        (err) => err.code === "forbidden_operation",
      );
    });
  });

  it("verifies staff session via /api/admin-users/me without exposing token", async () => {
    await withTempSession(async ({ env }) => {
      const mockFetch = async (url, init) => {
        assert.equal(url, "https://ifasccms.innerfireai.com/api/admin-users/me");
        assert.match(init.headers.Cookie, /payload-token=secret-jwt-token-do-not-leak/);
        return new Response(
          JSON.stringify({
            user: {
              id: "u-1",
              email: "ops@innerfireai.com",
              displayName: "运营专员",
              role: "operator",
              enabled: true,
            },
          }),
          { status: 200 },
        );
      };

      const res = await executeCommand(["whoami", "--json"], { env, fetchImpl: mockFetch });
      assert.equal(res.ok, true);
      assert.equal(res.user.role, "operator");
      assert.equal(JSON.stringify(res).includes("secret-jwt-token-do-not-leak"), false);
    });
  });
});

describe("Markdown to Lexical, Skill ZIP builder, and ASCII filename normalization", () => {
  it("converts Markdown headings, lists, quotes, inline code/bold, and fenced code into Lexical AST", () => {
    const ast = markdownToLexical(
      "# 标题一\n\n支持 **加粗** 与 `CLI` 调用。\n\n- 特性 A\n- 特性 B\n\n> 引用说明\n\n```bash\nnpx skills add innerfire/skills\n```",
    );
    assert.equal(ast.root.type, "root");
    const types = ast.root.children.map((n) => n.type);
    assert.deepEqual(types, ["heading", "paragraph", "list", "quote", "paragraph"]);
    assert.equal(ast.root.children[0].tag, "h1");
    assert.equal(ast.root.children[2].listType, "bullet");
    assert.equal(ast.root.children[4].children[0].format, 16);
  });

  it("normalizes non-ASCII filenames safely while preserving clean ASCII names", () => {
    assert.equal(normalizeAsciiFilename("agent-icon_v1.png", "abcdef1234567890"), "agent-icon_v1.png");
    assert.equal(normalizeAsciiFilename("教案助手截图 1.png", "abcdef1234567890"), "1-abcdef123456.png");
    assert.equal(normalizeAsciiFilename("纯中文图片.webp", "9876543210fedcba"), "asset-9876543210fe.webp");
  });

  it("packs clean deterministic Skill ZIP excluding .git, node_modules, .env, results.tsv, test-prompts.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-pack-test-"));
    const skillDir = join(root, "if-demo-skill");
    await mkdir(join(skillDir, ".git"), { recursive: true });
    await mkdir(join(skillDir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(skillDir, "scripts"), { recursive: true });

    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: if-demo-skill\ndescription: 自动提取学术文献摘要并校验格式。\n---\n\n# 学术文献摘要器\n\n正文说明。\n\n\`\`\`bash\nnode scripts/run.mjs --json\n\`\`\`\n`,
    );
    await writeFile(join(skillDir, "scripts", "run.mjs"), "console.log('ok')\n");
    await writeFile(join(skillDir, ".env"), "SECRET=1\n");
    await writeFile(join(skillDir, "results.tsv"), "ts\tscore\n");
    await writeFile(join(skillDir, "test-prompts.json"), "[]\n");
    await writeFile(join(skillDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(skillDir, "node_modules", "pkg", "index.js"), "module.exports={}\n");

    try {
      const b1 = await buildCleanSkillZip(skillDir);
      const b2 = await buildCleanSkillZip(skillDir);
      assert.equal(b1.sha256, b2.sha256, "deterministic zip sha256");
      assert.equal(b1.fileCount, 2, "only SKILL.md and scripts/run.mjs packed");
      assert.equal(b1.extracted.titleCandidate, "学术文献摘要器");
      assert.equal(b1.extracted.summaryCandidate, "自动提取学术文献摘要并校验格式。");
      assert.equal(b1.extracted.usageExamples.length, 1);
      assert.ok(b1.excluded.includes(".git"));
      assert.ok(b1.excluded.includes("node_modules"));
      assert.ok(b1.excluded.includes(".env"));
      assert.ok(b1.excluded.includes("results.tsv"));
      assert.ok(b1.excluded.includes("test-prompts.json"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Catalog dry-run preview, 2-screenshot publish guardrail, versionHistory[0], and feed prediction", () => {
  it("prepends new version to versionHistory[0] and marks older versions non-current", () => {
    const merged = mergeVersionHistory(
      [{ version: "v1.0.0", isCurrent: true, changelog: "初版" }],
      { version: "v1.1.0", changelog: "新增批量导出", packageFileId: "media-zip-2", kind: "skills" },
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].version, "v1.1.0");
    assert.equal(merged[0].isCurrent, true);
    assert.equal(merged[0].packageFile, "media-zip-2");
    assert.equal(merged[1].version, "v1.0.0");
    assert.equal(merged[1].isCurrent, false);

    const impact = predictFeedImpact(
      "skills",
      { _status: "published", firstPublishedAt: "2026-10-01T00:00:00Z", versionHistory: [{ version: "v1.0.0" }] },
      { _status: "published", versionHistory: merged },
    );
    assert.equal(impact.willCreateFeed, true);
    assert.equal(impact.eventType, "release");
  });

  it("blocks publishing an agent without 2 screenshots, allows draft preview without mutating CMS, and commits with --yes", async () => {
    await withTempSession(async ({ env }) => {
      let postCalled = false;
      const mockFetch = async (url, init = {}) => {
        const u = new URL(url);
        if (u.pathname === "/api/admin-users/me") {
          return new Response(
            JSON.stringify({
              user: { id: "u1", email: "ops@innerfireai.com", role: "admin", enabled: true },
            }),
            { status: 200 },
          );
        }
        if (u.pathname === "/api/tags") {
          const group = u.searchParams.get("where[group][equals]");
          const docs =
            group === "type"
              ? [{ id: "tag-type-1", name: "智能写作", group: "type", enabled: true }]
              : [{ id: "tag-cat-1", name: "论文", group: "category", enabled: true }];
          return new Response(JSON.stringify({ docs, totalDocs: docs.length }), { status: 200 });
        }
        if (u.pathname.startsWith("/api/media/")) {
          const id = u.pathname.split("/").pop();
          return new Response(JSON.stringify({ id, mimeType: "image/png", filename: `${id}.png` }), {
            status: 200,
          });
        }
        if (u.pathname === "/api/agents" && init.method === "POST") {
          postCalled = true;
          const body = JSON.parse(init.body);
          return new Response(
            JSON.stringify({ doc: { id: "019f0000-0000-7000-8000-000000000099", ...body } }),
            { status: 201 },
          );
        }
        throw new Error(`Unexpected request: ${init.method || "GET"} ${url}`);
      };

      // 1. Publishing with 0 screenshots -> blocked immediately!
      await assert.rejects(
        () =>
          executeCommand(
            [
              "agents",
              "create",
              "--name",
              "论文润色助手",
              "--summary",
              "中英文学术论文润色",
              "--status",
              "published",
            ],
            { env, fetchImpl: mockFetch },
          ),
        (err) => err.code === "missing_screenshots",
      );
      assert.equal(postCalled, false);

      // 2. Dry-run draft create without --yes -> preview=true, POST not sent!
      const previewRes = await executeCommand(
        [
          "agents",
          "create",
          "--name",
          "论文润色助手",
          "--summary",
          "中英文学术论文润色",
          "--type-tag",
          "智能写作",
          "--category-tags",
          "论文",
          "--version",
          "v1.0.0",
        ],
        { env, fetchImpl: mockFetch },
      );
      assert.equal(previewRes.preview, true);
      assert.equal(previewRes.data._status, "draft");
      assert.equal(previewRes.data.typeTag, "tag-type-1");
      assert.deepEqual(previewRes.data.categoryTags, ["tag-cat-1"]);
      assert.equal(previewRes.feedImpact.willCreateFeed, false);
      assert.equal(postCalled, false);

      // 3. Publish with 2 screenshot UUIDs + --yes -> commits POST!
      const s1 = "019f0000-0000-7000-8000-000000000011";
      const s2 = "019f0000-0000-7000-8000-000000000012";
      const commitRes = await executeCommand(
        [
          "agents",
          "create",
          "--name",
          "论文润色助手",
          "--summary",
          "中英文学术论文润色",
          "--type-tag",
          "智能写作",
          "--category-tags",
          "论文",
          "--screenshots",
          `${s1},${s2}`,
          "--status",
          "published",
          "--version",
          "v1.0.0",
          "--yes",
        ],
        { env, fetchImpl: mockFetch },
      );
      assert.equal(commitRes.preview, false);
      assert.equal(commitRes._status, "published");
      assert.equal(commitRes.feedImpact.eventType, "publish");
      assert.equal(postCalled, true);
    });
  });
});
