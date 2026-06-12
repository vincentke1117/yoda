# releases.lovstudio.ai 更新源跳转

老版本 Yoda（stable ≤v0.3.3）和 canary 构建内嵌的更新 feed 指向
`https://releases.lovstudio.ai/yoda/...`。这个域名从未真正部署过（R2 没配），
导致这批用户永久无法自动更新。

这里是一个纯跳转的 Vercel 项目（`lovstudio-releases`）：
`/yoda/<file>` → 302 → `https://github.com/lovstudio/yoda/releases/latest/download/<file>`

channel yml 里的文件 URL 由 `scripts/release/pin-feed-urls.ts` 固定为带版本号的
GitHub 绝对地址，所以跳转只需覆盖 yml 本身。electron-updater 会跟随 302。

改动后部署：在本目录 `vercel deploy --prod`。
DNS：Cloudflare 上 `releases` 为 DNS-only CNAME → `cname.vercel-dns.com`。
