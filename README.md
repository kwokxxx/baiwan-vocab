# 百万背单词 · Baiwan Vocab

一款优先支持离线使用的单词与短语学习应用，提供每日任务、间隔复习、例句朗读，以及可选的账号同步和云端备份。

[在线使用](https://vocab-practice-dun.vercel.app/) · [GitHub 仓库](https://github.com/kwokxxx/baiwan-vocab)

## 项目功能

- **单词与短语学习**：内置 121 条短语及原创双语例句，可自行添加单词和短语，管理收藏、笔记与个人词库。
- **每日任务**：默认每天学习 15 条新内容、复习 45 条，两个数量可独立调整；支持混合学习或按单词、短语分别练习。
- **分组与间隔复习**：每组最多 7 条，根据“我认识 / 不认识”和提示使用情况安排复习；未掌握内容在后续组中重练，同日重复不额外推进复习阶段。默认复习间隔为 1、2、4、7、15、30、60、90、180 天，是产品设定，并非通用记忆曲线公式。
- **例句与朗读**：展示英文例句和中文翻译，突出目标短语；支持自动朗读、手动重播、语音选择和试听。可用声音及离线朗读能力取决于设备与浏览器。
- **进度与日历**：保存学习记录、用时和未完成的小组，并根据实际学习事件显示日历。
- **离线与安装**：生产构建使用 Workbox 缓存应用资源，可添加到手机主屏幕；另生成单文件 HTML 离线版。
- **备份与同步**：支持本地备份导出、恢复，账号间隔离的云端同步，以及通过恢复码访问的匿名云端备份。离线修改会保留，联网后再同步。
- **手机适配**：触屏设备使用真实视口、系统键盘和安全区域；桌面保留 iPhone / Pixel 10 设备预览。

## 技术组成

| 部分         | 技术                                      |
| ------------ | ----------------------------------------- |
| 前端         | React 19、TypeScript、Vite 8              |
| 界面与交互   | Radix UI、Motion、自定义移动端运行时      |
| 离线缓存     | Workbox、Web App Manifest                 |
| 本地学习数据 | localStorage，访客与账号缓存隔离          |
| 账号与服务端 | Better Auth 邮箱密码登录、同源 Vercel API |
| 数据库       | PostgreSQL，当前线上使用 Neon             |
| 测试         | Node.js Test Runner、Playwright           |

## 本地运行

建议使用 **Node.js 24.x** 和 npm；当前项目已在 Node.js 24.14.0 环境运行。数据库脚本使用 Node.js 的 `--env-file` 与 TypeScript 类型剥离功能。

```bash
git clone https://github.com/kwokxxx/baiwan-vocab.git
cd baiwan-vocab
npm ci
```

### 仅运行前端

```bash
npm run dev
```

默认访问 [http://localhost:5173](http://localhost:5173)，实际端口以终端输出为准。此模式适合开发界面和体验访客本地学习，不提供账号、云端同步和匿名云端备份 API。开发模式不注册生产离线缓存。

查看生产构建和离线缓存行为：

```bash
npm run build
npm run preview
```

访问 [http://127.0.0.1:4174](http://127.0.0.1:4174)。`preview` 仅提供静态页面，也不运行服务端 API。先在线加载并等待离线资源就绪，再测试断网使用。

在页面地址后添加 `?mode=phone` 可强制使用真实设备布局，添加 `?mode=preview` 可强制显示桌面设备外框。

### 运行完整应用（含账号与云端功能）

准备一个 PostgreSQL 数据库，在项目根目录创建 `.env.local`：

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=verify-full"
BETTER_AUTH_SECRET="REPLACE_WITH_A_RANDOM_SECRET"
BETTER_AUTH_URL="http://localhost:4180"
```

以上均为占位值。数据库连接会强制校验证书，应使用提供有效 TLS 证书的 PostgreSQL 服务（例如 Neon）。可通过以下命令生成随机认证密钥，再将结果填入 `BETTER_AUTH_SECRET`：

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

`.env.local` 已被 Git 忽略；密钥仅供服务端读取，不应添加 `VITE_` 前缀或提交到仓库。

首次使用**空数据库**时，执行：

```bash
npm run db:migrate
npm run build
npm run dev:cloud
```

访问 [http://localhost:4180](http://localhost:4180)。此服务同时提供构建后的前端和同源 API，没有前端热更新；修改代码后需重新构建，服务端修改后需重启。可通过 `PORT` 环境变量更改端口，脚本会自动将认证来源设为 `http://localhost:<端口>`。

`localhost` 与 `127.0.0.1` 属于不同来源；完整模式请使用上述 `localhost` 地址，以符合认证及写请求的来源校验。

### 数据库更新的区别

| 命令                                    | 用途与影响                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate`                    | 建表并初始化当前内置词库；也会归档和迁移旧版本账号状态、移除不属于当前目录的共享词条。适合首次初始化，已有数据库执行前应审阅迁移逻辑。 |
| `npm run db:migrate -- --schema-only`   | 仅更新认证表和业务表结构，不修改词库或学习状态。                                                                                       |
| `npm run db:migrate -- --examples-only` | 在已初始化且短语 ID 匹配的数据库中补充例句及已批准的词条修正，先归档旧共享词条，不读写账号学习状态。                                   |

完整迁移对目录版本不同的旧账号会清空旧自建词条、筛选相关进度并重置学习组，同时保留历史活动。请先备份已有数据库，并查看 [scripts/migrate.ts](scripts/migrate.ts) 和 [src/catalog.ts](src/catalog.ts)。迁移不会随 `npm run build` 自动运行。

## 部署到 Vercel

仓库已有 [vercel.json](vercel.json)，包含构建、静态输出、API 路由和缓存规则。完整应用需要同时部署前端与 `api/index.ts`，单独上传 `dist/client` 只能提供静态功能。

### 配置项目

维护当前线上应用时，在 Vercel 的现有 **`vocab-practice`** 项目中连接此 GitHub 仓库，保留现有域名、数据库和认证密钥。部署独立副本时，在自己的 Vercel 账号导入仓库并使用独立数据库。

核对以下配置：

| 设置              | 值                              |
| ----------------- | ------------------------------- |
| Root Directory    | 仓库根目录                      |
| Node.js Version   | `24.x`                          |
| Install Command   | `npm ci`                        |
| Build Command     | `npm run build`                 |
| Output Directory  | `dist/client`                   |
| Production Branch | `main`                          |
| Functions Region  | `sin1`，已在 `vercel.json` 配置 |

Vercel 的 Node.js 版本设置见[官方文档](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。

### 配置数据库与环境变量

在 Vercel 项目的 Production 环境中设置：

| 变量                 | 内容                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | 线上 PostgreSQL 连接字符串                                                                  |
| `BETTER_AUTH_SECRET` | 随机认证密钥；已有项目沿用原值                                                              |
| `BETTER_AUTH_URL`    | 完整的正式 HTTPS 来源，例如 `https://vocab-practice-dun.vercel.app`；独立部署改成自己的域名 |

新数据库先按上文初始化；已有数据库根据变更选择迁移方式。Preview 环境若需测试云端功能，应配置独立测试数据库及与访问地址一致的 `BETTER_AUTH_URL`，不能直接沿用正式站点来源。

保存环境变量后部署；环境变量修改需要重新部署才会生效。参见 [Vercel 环境变量文档](https://vercel.com/docs/environment-variables)。

### 发布与验证

连接 GitHub 后，向生产分支推送提交可触发部署，详见 [Vercel Git 部署文档](https://vercel.com/docs/git)。也可使用 CLI 手动发布：

```bash
npx vercel login
npx vercel link
npx vercel --prod
```

`vercel link` 时选择正确的团队及项目；维护当前站点应选择现有 `vocab-practice`。`.vercel/` 只保存本机项目关联，未提交到仓库；已有正确关联的工作目录无需重复 link。

部署完成后检查：

1. 首页和学习流程可用，`/version.json` 返回版本与构建标识。
2. `/api/health` 返回 `{"server":"ok","database":"ok"}`，确认 API 与数据库连接正常。
3. 注册、登录和同步可用，API 请求没有被重写成 HTML 页面。
4. 在线加载并完成资源缓存后，断网仍可打开页面并继续本地学习。

PWA 安装与离线缓存需要 HTTPS（本机 localhost 开发环境除外）。在 iPhone 上通过 Safari 打开正式站点，再从分享菜单添加到主屏幕。部署新版本不需要清空网站数据；本地缓存和待同步记录应保留。

## 单文件离线版

`npm run build` 会在项目根目录生成 **`百万背单词-离线版.html`**，可用浏览器直接打开。文件内嵌应用资源，适合不接入服务器的本地学习；通过 `file://` 打开时不启用账号同步。

单文件版与线上站点的本地存储不共享，浏览器对本地文件存储的支持也可能不同，迁移学习记录请使用应用内的备份导出和恢复。生成文件和 `dist/` 均不纳入 Git。

## 检查与测试

```bash
# 移动端运行时完整性校验
npm run check:runtime

# 学习调度、会话、备份、同步、网络与更新逻辑测试
npm test

# 类型检查和完整生产构建
npm run build

# 首次执行浏览器测试时安装 Chromium
npx playwright install chromium
npm run test:runtime

# 模板静态 Worker 测试
npm run test:sites
```

配置独立测试数据库、`.env.local` 并完成初始化后，可运行 `npm run test:cloud`。该测试默认直接调用服务端处理器，创建随机临时账号与备份，结束时清理本次测试数据；它会实际连接数据库。设置 `CLOUD_TEST_URL` 可改为通过 HTTP 测试目标服务，此时目标服务与本地测试脚本必须使用同一测试数据库和匹配的来源配置。

## 目录结构

```text
src/Prototype.tsx       应用界面与交互
src/prototype.css       应用样式
src/study.ts            数据模型与间隔复习
src/session.ts          每日任务和分组会话
src/entries.ts          内置短语与双语例句
src/cloud.ts            本地状态与云端同步协调
src/mobile/             移动设备预览、键盘和滚动运行时
server/                 认证、数据库、备份与 API 业务逻辑
api/index.ts            Vercel API 入口
scripts/                构建、数据库迁移和本地维护脚本
tests/                  逻辑测试与浏览器测试
public/                 图标、图片和安装清单
```

修改移动端界面前请阅读 [AGENTS.md](AGENTS.md) 与 [组件说明](src/mobile/COMPONENTS.md)。受保护的移动运行时文件由 `mobile-runtime.lock.json` 校验，不应为通过检查而直接刷新锁文件。

## 数据与账号说明

共享词库与私人数据分开保存；个人删除词条不会删除所有用户的共享词库。访客本地数据、账号缓存和匿名云端备份各自独立，登录后的访客数据合并需要明确选择。匿名备份恢复码是访问凭据，应自行妥善保存。

目前支持邮箱密码注册、登录和修改密码，尚未配置邮件验证及邮件找回。管理员可在本地交互终端运行 `npm run account:reset -- 账号邮箱`，确认邮箱并隐藏输入新密码；该操作会撤销旧会话，保留学习记录。密码以单向哈希保存，无法读取原密码。
