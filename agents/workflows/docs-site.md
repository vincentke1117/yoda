# 文档站（yoda.lovstudio.ai）

三个容易混淆的 "docs"：

- `docs/`（本仓库）= 官网落地页（Vite 静态站），**不是文档内容**
- `/Users/mark/lovstudio/coding/yoda-docs`（仓库外的独立目录）= 真正的文档站（Next.js + Fumadocs）
- `agents/`（本仓库）= 给 AI 和开发者看的内部文档，不对外发布

线上架构：域名挂在落地页的 Vercel 项目上，`docs/vercel.json` 把 `/docs/*` 转发到 yoda-docs 项目。

## 改文档内容

1. 改 `yoda-docs/content/docs/*.mdx`
2. `env -u NODE_ENV pnpm build`（shell 里有 NODE_ENV=development 会构建崩溃）
3. `vercel --prod`

注意：`yoda-docs/content/docs/reference/learn-agent-design/` 是脚本同步生成的，**不要手改**，去改源仓库 `lovstudio/learn-agent-design`。

## 改落地页

1. 改本仓库 `docs/`
2. 在 `docs/` 里本地 `npm run build`（云端构建会失败，必须本地预构建）
3. 从 `docs/dist/` 部署
