# 百万背单词 · 视觉与功能检查

final result: passed

## v0.6.0 百万背单词与猫头像（2026-10-17）

- 用户暂缓大陆部署迁移，将应用更名为“百万背单词”，并指定 /Users/bkg/Downloads/49008.jpg 的金渐层猫作为正脸卡通图标参考。
- 使用内置 image_gen 生成，第二轮将毛发简化为卡通形状。主图保存在 qa/baiwan-cat-master.png，实际应用素材为 public/assets/app/baiwan-cat-{180,192,512}-v1.png。三种尺寸均为不透明正方形，系统负责裁切圆角；保留旧根路径 PNG 的兼容副本。
- 更新网页标题、Apple 安装名称、manifest name/short_name、首页、提示文案、备份下载名称与离线单文件名称。manifest id/start_url、存储键、Cookie 前缀与账号数据不变。个人页和安装说明展示同一头像。
- 375×668 首页标题无截断，393×852 安装说明正确显示图标和名称；桌面设备预览保留。正式站升级后仍保留 25 个访客词条、1 条学习记录及 1 个收藏。证据 qa/baiwan-install-v060.png。
- 32 项现有测试、TypeScript、生产构建、29 个运行时文件校验通过。自包含离线 HTML 无外部脚本、样式和图标引用。部署 dpl_DoxtMFe2MKAsZGcGsyTPmt9HNE46，版本 0.6.0，构建 65665dd79ef09e28；正式版本、manifest、更新入口和 180px 图标均 HTTP 200，线上图标 SHA-256 与本地一致。
- iPhone 实体主屏幕尚未实测；旧安装图标可能保留旧名称/图案。界面提示先同步或导出记录，再重新添加/移除旧入口，不能要求清除网站数据。

<details>
<summary>最终图标生成提示词（内置 image_gen；两张输入分别为第一轮头像与原始猫照片）</summary>

```text
Use case: style-transfer.
Create the FINAL square iPhone app icon for 百万背单词.
Image 1 is the generated front-facing cat composition to simplify. Image 2 is the actual pet identity reference. Keep the perfectly front-facing upright head, round cheeks, small ears, golden shaded coloring, cream muzzle and ruff, big olive-green eyes with dark rims, and small pink-brown nose.
Change the illustration style decisively to a charming clean 2D CARTOON mascot: broad rounded solid color shapes, smooth confident warm-brown contours, simplified soft cel shading, a few large fur tufts only. Remove all individual hair strands, photographic texture and realistic fur rendering. It must look like a carefully designed cartoon app icon, not an airbrushed pet portrait. Keep the expression gently curious, friendly and calm, without exaggerated eyebrows or accessories.
Head and tiny cream chest only, centered with both ears fully inside the image, safe breathing room for the iOS corner mask. Large readable features at 60px. Pale mint full-bleed opaque background, no scene.
A single 1024x1024 square artwork. No text, letters, border, sticker outline, tile frame, pre-rounded outer corners, phone mockup, book or props. Keep the cat recognizable from the user's golden fluffy pet photo.
```

</details>


## v0.5.2 未登录更新检查（2026-10-17）

- 用户在手机确认 0.5.1 后，反馈原链接未登录检查仍显示“暂时无法获取版本信息”。服务器版本接口当时返回有效 JSON，尚未确认该手机请求失败的确切原因，没有将桌面成功当作真机问题已解决。
- 浏览器请求保留原生全局接收者；公开检查使用同源连接 Cookie，但不调用认证接口、不要求登录。版本 JSON 请求失败后，从已有 /api/update 新文档读取并严格校验版本与构建标识；两条路径共享 8 秒截止时间，支持取消，并显示实际错误信息。
- 32 项自动测试通过；本地以未登录状态将 /version.json 故意替换为错误 HTML，界面仍通过备用入口完成检查并显示最新 0.5.2。证据 qa/update-fallback-v052.png。测试后已关闭故障开关，恢复正常本地预览。
- 29 个保护文件校验、TypeScript、本地与 Vercel 构建通过。正式部署 dpl_GHP4MmXmNwP3o27W8zLAQtBweSf8，仍使用 https://vocab-practice-dun.vercel.app/ 。版本 JSON 与更新 HTML 均返回 HTTP 200、no-store、0.5.2 / ced5a079ef092787；公共健康检查返回服务与数据库正常。
- 正式站浏览器直接打开原链接，在“本地模式”点击检查更新，完成后显示“当前已是最新版本 0.5.2”，按钮恢复可用，原访客学习记录保留。证据 qa/update-check-v052.png。用户 iPhone 上的本次结果尚待确认；云同步故障也需用户登录后复核。

## v0.5.1 更新卡住与连接诊断（2026-10-17）

- 用户报告已登录时检查更新长时间等待、手机网络正常但云端连接失败；在手机 Chrome 打开公共 API 却进入旧单词页。服务器匿名接口与模拟移动导航请求均返回 JSON 200，未在排查时发现近一小时 5xx 日志，旧缓存/路由是重要线索；没有把这些结果当成实体手机已经恢复的证明。
- 移除手动检查对 ServiceWorkerRegistration.update() 的无期限等待，以及初始化对 serviceWorker.ready 的无期限等待。版本检查读取 no-store 的 version.json，独立于账号和同步，8 秒截止、可取消；通过 buildId 识别同版本重新构建。
- 统一请求截止时间覆盖响应体读取，即使传输忽略 abort 也能释放界面。区别超时、非 JSON 响应、未登录、服务器/数据库故障。新增只读 /api/health 和可取消的连接诊断。
- /api/update 直接返回当前应用文档，响应 no-store；载入后只修改地址栏回到主路径。更新前持久化当前账号/访客缓存及待同步数据，不清除 localStorage、Cookie 或学习记录。
- 导航采用有时限的 NetworkFirst，失败后回退缓存/预缓存；API 不进入页面回退。浏览器直接打开 /api/library 已验证显示 JSON 而非应用界面。静态新资源按需缓存，保留完整预缓存。
- 30 项自动测试通过，涵盖永不返回的请求、卡住的 JSON 读取、取消后迟到结果、旧 HTML 伪装版本信息、账号缓存和未上传笔记在重载前的持久化。
- 临时账号登录本地新版本后，检查正常完成；停止本地服务器后检查显示失败且按钮恢复可用，仍可背词并离线重载。恢复服务器后，在待同步状态执行更新，登录与学习记录保留并最终补传成功。
- 正式站使用旧版已登录会话进入更新入口后，仍保持登录，显示 0.5.1、检查完成、连接诊断正常，并读回离线学习事件。正式版本/健康/更新文档接口均 HTTP 200，缓存响应头正确。
- 运行时 29 文件检查、TypeScript、生产构建与真实 API 回归通过。最终部署 dpl_5NPCEWBctsWVLNM8XVdVTGLLG8sF，原链接保持不变。用户已确认手机成功加载 0.5.1；实体手机上的云端连接诊断结果尚待确认。

## v0.5.0 左滑删除（2026-10-17）

- 单词、短语统一使用既有 Carousel 横向手势。左滑露出 80px 红色删除按钮，拖动后没有误开详情；点击已展开的词条可收起操作。
- 本地界面实测单词与短语删除、计数减少、8 秒内撤销、撤销后复习状态恢复。正式站确认左滑显示红底白色垃圾桶与“删除”文字，截图 qa/swipe-delete-v050.png。
- 删除只作用于当前用户/访客的词库：公共库不受影响，自建词条及其活动复习安排、收藏、笔记被移除，历史事件/时长保留。
- 可选删除标记兼容旧备份；跨端冲突和旧备份导入不会复活已删除词条。服务端保留旧客户端省略的删除元数据，显式 false 才撤销删除。
- 17 项自动测试、TypeScript、本地与 Vercel 生产构建通过，29 个受保护运行时文件未修改。
- 真实数据库与正式 API 通过临时账号测试：自建/公共词条删除、另一会话读回、旧客户端防复活、撤销同步、账号隔离。测试账号已清理；实际用户词库只读查询，没有用于删除测试。
- 最终部署：dpl_BL9B4T7AidizR4jBD8ATNyvHypgt，地址仍为 https://vocab-practice-dun.vercel.app/ 。

## v0.4.0 首页与手机输入修复（2026-10-17）

- 默认启动改为主页；普通后台恢复不强制跳页，避免打断正在输入的表单。
- Native Runtime 同时跟踪 visualViewport 高度、宽度及顶部/左侧偏移；设备模式在一次挂载期间固定，避免键盘 resize 导致组件重新挂载。
- 原生根容器改为 overflow:clip，表单单独滚动。键盘可见时弹层使用可视区域高度，聚焦字段只滚动弹层内容，不调用会带动整个页面的 scrollIntoView。
- 输入框焦点交接后再判断是否收起键盘。登录/注册窗口增加明确关闭按钮，关闭前不会因背景点击或下拉手势丢弃输入。
- 浏览器将原生预览从 393×852 缩到 393×480、393×390；昵称、邮箱持续保留，密码输入框保持在弹层可视区域内。证据：qa/auth-keyboard-v040.png。
- 正式站邮箱与密码各输入一半，再缩小可视区域、继续输入剩余部分，随后成功登录并同步。证据：qa/auth-login-success-v040.png。此检查模拟键盘可视高度，不冒充实体 iPhone 键盘实测。
- 桌面 iPhone 与 Pixel 10 的设备选择器、状态栏、模拟键盘、字段切换和关闭表单回归通过。经浏览器验证后仅刷新四个授权修改的运行时文件哈希，29 文件完整性校验通过。
- 14 项单元测试、TypeScript、生产构建和正式 HTTPS 数据库测试通过；原有 25 个本地词条、学习记录与收藏在升级后保留。
- 用户撤回邮件功能与域名购买；未创建邮件服务或修改邮箱验证要求。新增本地管理员密码重置命令，真实临时账号测试验证旧密码/旧会话失效、学习记录与其他账号不受影响。CLI 另验证了隐藏输入、重复确认及不存在账号时不修改数据。
- 发布：dpl_EQzo71dmvnWJbHcKqGXiUeK7Ra5N，仍为 https://vocab-practice-dun.vercel.app/ 。

## v0.3.0 线上数据库验证（2026-10-17）

- 用户确认 Neon 条款后，创建免费版新加坡 PostgreSQL 资源 shici-db。数据库已保存 24 条公共单词/短语。Vercel Functions 与数据库同区域，浏览器仅访问同源 API。
- 采用 Better Auth 1.7.10 邮箱密码登录；HttpOnly/Secure 会话，数据库中的密码为散列。前端构建扫描未发现数据库连接串或认证密钥。
- 独立账号缓存、旧本地数据选择性合并、离线继续学习、版本冲突合并与幂等补传已实现。14 项自动测试通过；原有 29 个运行时文件锁校验、TypeScript 与生产构建通过。
- 真实数据库及正式 HTTPS API 均验证：注册、正确/错误密码登录、两会话读写同一账号、不同账号隔离、客户端伪造 userId 无效、401 未登录、403 跨站写入、400 无效数据、409 旧版本冲突、重复提交不增加版本、退出后会话失效。测试只创建随机临时账号并清理。
- WebKit 手机预览发现原生 fetch 的接收者绑定问题，修复为无绑定包装，并添加回归测试。393×852 实际登录、自建短语、收藏和笔记保存已通过。
- 停止本地 4180 服务后重新打开缓存页面，完成一次背词；恢复服务后界面显示已同步，数据库查询确认收到这条离线学习事件。
- 正式站使用另一份浏览器存储登录同一测试账号，成功取回自建 keep a steady pace、收藏、中文笔记和学习进度。证据：qa/cloud-sync-local.png、qa/cloud-cross-device-v030.png。
- 旧 0.2.0 页面收到更新提示，点击后进入 0.3.0；原本地 25 词条、1 学习记录和 1 收藏保留。
- 正式部署：dpl_FhiREdifiUnG8C4KYXsomQvWGXEu；地址保持 https://vocab-practice-dun.vercel.app/ 。
- 限制：尚未配置邮件验证与邮件找回；账号页面已明确提示。iPhone 实体设备上的本次账号同步仍由用户验证，浏览器尺寸验证不等同于真机测试。

## 对照依据与尺度

- 背诵页：/Users/bkg/Downloads/49125.jpg。
- 释义页：/Users/bkg/Downloads/49124.jpg。
- 两张来源原图均为 1280 × 2781，归一化副本为 qa/reference-recall.png、qa/reference-detail.png（393 × 852，约 0.3% 比例调整）。
- 浏览器视口：1400 × 1200；实际 device-screen 经 DOM 测量为 393 × 852 CSS px，设备缩放 1，截图 393 × 852。
- 实现截图：qa/recall.png、qa/detail.png、qa/phrase.png、qa/home.png。
- 背诵与释义两种状态均将来源图和实现截图放在同一个比较输入中检查。393px 原宽图中词头、音标、段落、图标、底部按钮均可直接读清，因此无须额外放大裁剪；分别检查了这些区域。
- 模板拥有的设备边框、状态栏、动态时钟和底部指示条按模板保留，与来源设备不同，未作为视觉差异扣分。

## 比较与修复记录

1. 首轮背诵页（qa/recall-before-polish.png）：词头、音标与统计字号偏大，词头和简单标记偏低；背景右上过黄。判定 P2。将词头调整为32px、统计19px、词头容器顶距200px；重新生成并检查了薄荷青绿背景。
2. 释义页首轮：正文过大，分段间距累积偏高。判定 P2。英文正文15px、中文翻译13px，收紧词典标签与释义间距。复拍 qa/detail.png，层级与左右对齐通过；语境例句为自写内容，长度差异属于内容替换。
3. 页面切换时浏览器焦点曾使设备外层滚动327.5px，导致设备标识和内容偏移。判定 P1。应用在 screen portal 上防止外层自动滚动，保持滚动仅发生在 MobileScroll；保护的模板文件未修改。最终切换至释义后外层 scrollTop=0，完整标题、例句和按钮均可见。
4. 手写 Service Worker 离线启动失败。判定 P0。替换为 Workbox generateSW，预缓存21项本地资源。停止本机4174服务后，在 Chrome 和应用内浏览器均完成重新打开，并实际切换到短语页。之后恢复预览服务。

## 五项视觉检查

- 字体：系统中文字体、无衬线英文词头、本地 Barlow Condensed 数字；层级、换行、字重已检查。
- 间距：保留顶部工具栏、三列统计、居中词头、大面积留白与底部双按钮；释义页单列左对齐，底部预留空间。
- 色彩：本地生成背景、薄荷绿功能色、橙色不认识与详情词头。来源色值并非官方token；胶囊主按钮使用单色，为已接受的轻微差异。
- 图像：本地背景已检查；图标使用Phosphor，未手绘品牌资产。无运行时外部图片或字体。
- 内容：额外提供单词/短语切换；示例词库12个单词、12个短语。实际统计显示真实学习记录，不伪造来源截图中的60个待复习词。未使用柯林斯或真题标签冒充内容来源。

## 功能验证

- 认识→释义→下一词；不认识与提示→短间隔复习。
- 单词/短语切换，短语中文释义、双语例句、语境内容。
- 收藏、保存笔记、搜索、自建短语。
- 刷新后记录恢复；实际导出备份，核对含自建词条、笔记、收藏、两条事件与对应dueAt。
- 单元测试6项通过：逐级间隔、遗忘/提示重置、到期优先队列、跨类型每日上限、备份验证、设备日期边界。
- npm run build通过；npm run check:runtime通过，28个受保护文件未修改。
- 控制台检查无应用错误；离线测试中的网络不可用为有意制造的验证条件。
- 生成单文件“拾词-离线版.html”，静态检查无外部脚本、CSS、图片、字体依赖。浏览器工具禁止file:导航，因此未把直接双击该文件作为已实测结果；同一构建的HTTP版本主流程与离线缓存已实测。

## 剩余限制

- 朗读需要系统已有离线英语语音；没有本机语音时显示明确提示，不调用联网TTS。
- 已增加真机布局，并通过393×852和375×568尺寸检查；尚未在实体iPhone上验证Safari安装、键盘和手势。桌面仍保留设备预览。
- 无账号和云同步；数据保存在当前浏览器，提供备份导出/恢复。
- 低对比辅助文字沿用来源视觉方向，后续可增加大字与高对比模式。当前不宣称完成WCAG认证。

## iPhone 真机准备（2026-10-17）

- 用户明确要求在 iPhone 上试用并添加主屏幕，已新增 RuntimeMode：触摸设备自动使用真实视口，移除模拟设备外框、状态栏和键盘；桌面预览保留。
- 已验证 393×852 与 375×568 的短语回忆、释义、笔记输入/保存、答题进度；截图 qa/iphone-native.png、qa/iphone-small.png。两种尺寸均无横向溢出或主按钮遮挡。
- 使用 visualViewport 跟随真实键盘可见高度，原生模式使用浏览器滚动与安全区。原生模式 DOM 中模拟键盘与外框数量均为0；桌面回归检查二者均为1，屏幕393×852。
- 浏览器验证后刷新运行时锁，共29个保护文件，check:runtime通过；新增原生运行时模块也纳入锁。
- 增加180/192/512像素PNG图标、Apple主屏幕元数据、manifest标识及应用内安装步骤。
- HTTP局域网模式禁用离线缓存注册，并明确提示HTTPS要求；新增ID生成兼容路径，解决不安全上下文无randomUUID时无法保存的问题。7项学习逻辑测试与4项部署构建测试通过。
- 局域网静态服务 http://192.168.1.200:4175/ 返回HTTP200，浏览器工具连接该局域网IP超时；没有声称已从实体iPhone连接成功。
- 用户指定参考Carbon_cycle后，已沿用其Vercel发布方式，正式HTTPS发布完成。

## Vercel 正式发布验证（2026-10-17）

- 正式地址：https://vocab-practice-dun.vercel.app/ 。
- 独立项目 vocab-practice，部署ID dpl_2DQd5Jjydr6GXotRuhxuGdRNMdyR，Vercel状态READY。
- 云端运行时完整性检查、TypeScript和生产构建通过；公开访问首页、sw.js、manifest及180/192/512图标均HTTP200，类型正确。
- 在正式HTTPS地址以393×852真机布局验证短语切换、认识→释义→下一词、计数与复习时间，控制台无应用错误。
- 我的页面显示“已准备好离线使用”，截图qa/deployed-iphone.png。手机实际Safari添加主屏幕仍由用户操作。
- 当前仍为离线数据版本：应用和示例词库已托管，学习数据保存在设备浏览器，未接入云数据库。

## v0.2.0 feedback fixes (2026-10-17)

- Source: qa/reference-iphone-feedback.png (1320 x 2868). The white strip occupies the OS status-bar region.
- Removed the legacy default status-bar meta override; theme-color, manifest and native html/body/root now use #bbf6ea, sampled from the background top. Viewport-fit and safe areas remain. Basis: https://www2.webkit.org/show_bug.cgi?id=317153#c2 .
- Added 180-280ms press/release and content transitions, disabled for reduced-motion preference. All 29 protected runtime files remain intact.
- Hint background computed as rgba(0,0,0,0), appearance:none. Blank area, helper and meaning toggle the disclosure; aria-expanded is synchronized. Hiding a used hint still produces assisted-recall scheduling.
- Checked 393 x 852 and 375 x 568 layouts: no meaning/button overlap. Evidence: qa/hint-expanded-v020.png, qa/hint-small-v020.png, qa/online-hint-v020.png. Reviewed typography, spacing, colours, image sharpness and labels. Existing artwork retained.
- Upgrade check: saved take a step back and a favourite on the old production version, then reloaded into 0.2.0. All 25 entries, 1 study record and 1 favourite remained. First reopen served the old cache; second reopen after worker activation loaded the new version without clearing data.
- Added foreground/online worker checks, a manual update button, version label and an update notice. Reload persists existing data first. Update notice is suppressed while studying or editing.
- Seven study tests, TypeScript, local build and Vercel build passed. Production update check reports 0.2.0; console has no application errors.
- Production deployment: dpl_3BXXZffY4DskuzJJA5Soi2ojvRu7. Same URL: https://vocab-practice-dun.vercel.app/ .
- Limitation: browser viewport QA does not reproduce the native iOS status bar. The final OS tint still needs confirmation on the user's iPhone; no physical-device screenshot verification is claimed.

final result: passed

## v0.7.0 每日短语任务、免登录备份与猫猫鼓励（2026-10-19）

- 当前设计结果：final result: passed。参考为 /Users/bkg/Downloads/截屏 2026-10-19 20.57.54.png 与 /Users/bkg/Downloads/截屏 2026-10-19 21.07.22.png。两张均为 1320×2868，归一化到 393×852；设备预览经 DOM 测量为 393×852 CSS px，截图也是 393×852。系统时间、设备外观及状态栏按受保护运行时保留。
- 成对比较证据：qa/compare-summary-v070.png、qa/compare-tasks-v070.png；实现为 qa/summary-preview-v070.png、qa/tasks-preview-v070.png。来源词条替换为用户提供的 121 条真实短语；原图商业词书封面替换为本项目既有猫头像及真实词库信息。任务页增加独立新词/复习选择器，这是用户功能要求导致的有意扩展。
- 首轮 P2：小结行高过大，第七条释义需额外滚动才可见，证据 qa/summary-v070.png。将行内音频按钮视觉高度降至 24px，收紧行间距和标题，校正固定按钮位置。复拍后七条短语及释义均可见；长短语仍允许换行与滚动，底部按钮固定在内容外。
- 字体：小结英文 16.5px、中文 12.5px、标题 16px；数字沿用 Barlow Condensed。间距：小结虚线分隔、白色任务卡、选中预设行与底部圆角按钮均已对照。颜色：沿用薄荷背景与绿色操作色；不认识/提示过的词条为橙色。图像：既有图标与透明猫插画无缺图、变形或白边。文案：真实导入条数与预计日期，无冒充雅思词库、编造音标或例句。
- 残留 P3：主按钮沿用已接受的纯色绿色，未复刻来源的渐变；独立任务选择器增加了页面内容高度，辅助说明可滚动查看。
- 本地浏览器实测：新词 7、复习 3；首条不认识、其余六条认识，小结首条橙色；点击下一组立即重背首条，认识后结束循环。同日巩固不重复消耗复习名额。刷新后仍从首页开始，继续学习恢复到未掌握条目；完成后只能手动加练。
- 免登录云备份浏览器实测：上传完整 121 条词库、7 条进度、任务量与未完成分组；完成巩固后读取并预览旧备份，确认恢复后回到未掌握短语，任务量仍为 7/3。恢复前快照自动保留；备份码在 UI 中遮挡，不放入 URL/日志。证据 qa/guest-backup-v070.png。
- 朗读界面自动选择本机 Samantha 女声，自动朗读默认开启，开始/切换词条在用户动作中调用；有试听和声音选择。未声称已在用户实体 iPhone 上听验，实际语音取决于系统安装情况。
- 猫猫完成页：qa/completion-v070.png。真实 DOM 375×568 小屏检查：qa/completion-small-v070.png，图文与完成按钮均可见。日历以真实学习事件记录日期，月份切换已操作，证据 qa/calendar-small-v070.png。浏览器控制台无应用错误。
- 43 项自动测试、TypeScript 与 29 文件运行时锁检查通过；离线 HTML 无外部脚本/样式引用，并包含猫猫插画。真实 PostgreSQL 临时账号测试通过账户隔离、幂等同步、备份恢复码隔离、备份修订冲突、非法数据拒绝、旧词库迁移快照。自动化创建的账号和备份只按本次随机标识清理。
- 最终正式部署 dpl_12zWEEbpdnB9Hkak98mQKwYmdPNf，版本 0.7.0、构建 a00ee217decc8b93。正式 version/library/health/sw 接口均 200；实际 PostgreSQL 活动词库确认为 121 条短语且顺序逐项匹配源文件，24 条旧公共词条已存档，现有账号均已完成词库迁移。
- 最终 HTTPS API 回归全部通过，包含正常新版写入与旧协议写入 426 拒绝；即使旧页面读到了新词库，也不能用旧的分钟调度覆盖新计划。三份并发匿名备份测试通过，未发生连接池等待死锁；测试备份清理。
- 断开本地服务后实际刷新启动，DOM 构建标识仍为 a00ee217decc8b93，121 条词库、14 条学习记录和当前分组都保留。导航 HTML 缓存按构建指纹隔离，只清理旧页面缓存，不触及学习存储或 Cookie。
- 正式浏览器已实测“不认识→小结→下一组立即重现→认识→小结→猫猫鼓励→完成”，证据 qa/completion-online-v070.png。正式站控制台无应用错误。
- 大陆直连问题沿用用户决定暂缓迁移，本次不宣称解决托管网络可达性。实体 iPhone 上的语音与新功能仍需用户实际体验，浏览器视口检查不冒充真机检查。

<details><summary>猫猫鼓励插画生成记录</summary>

使用内置 image_gen，透明背景；参考 qa/baiwan-cat-master.png 与 /Users/bkg/Downloads/49008.jpg。原图 qa/baiwan-celebration-master.png；应用素材 public/assets/app/baiwan-celebration-v1.png（512×512，保留真实 alpha）。

```text
Use case: identity-preserve.
Asset type: transparent PNG illustration for the daily learning completion screen of a mobile vocabulary app.
Primary request: create one friendly, happy front-facing upper-body portrait of the same golden shaded fluffy cat, raising one natural cat forepaw in a congratulatory wave / high-five, as if warmly praising the learner.
Input images: Image 1 is the existing app mascot, the primary character-design and refined 2D cartoon style reference. Image 2 is the user's real pet, a supporting identity reference.
Preserve the mascot's recognizable round cheeks, golden shaded fur, cream muzzle and fluffy cream chest ruff, large emerald-green eyes with soft highlights, small warm brown-pink nose, furry upright ears, and gentle proportions. Add a subtle warm closed-mouth smile and welcoming expression. Keep the eyes open.
Style: polished clean 2D cartoon illustration with softly shaded fur shapes, like the existing app avatar; pleasant and calm rather than exaggerated or photorealistic.
Composition: centered square canvas; upper body fully contained, with the raised paw clearly visible beside the face. Natural cat paw anatomy with softly visible paw pads, not a human hand. Keep generous transparent margins around all ears, whiskers, body, and paw; artwork should fill around 80% of the square and remain legible at 140px.
Background: genuine transparent alpha, no colored panel and no backdrop.
Constraints: only one cat, no text, no letters, no logos, no props, no clothing, no badge, no confetti, no frame, no shadow on a background, no checkerboard drawn into the image. Preserve a clean transparent silhouette.
```
</details>

## v0.7.1 单词功能修复与 15/45 默认任务量（2026-10-19）

- 用户确认保留当前 121 条短语，之后自行新增单词；本次没有恢复旧词库，没有改变 catalog revision，也没有执行词库迁移。
- 根因：主页入口和新增表单类型都按现有内容过滤，导致零单词时不能添加首个单词；续学无条件复用当前分组，忽略所选类型；混合任务按整库顺序取前 N 项，使追加单词排在大量短语之后。
- 修复：主页始终显示单词/短语入口，空分类打开对应新增表单；新增类型始终可选。每日任务交替安排两类内容，并保留每类原顺序；专练严格按类型，暂停的其他类型分组保存在 sessionSlots。完成一种专练后，若日任务还有剩余，显示“继续每日任务”。小结标题随学习范围变化。
- 默认新词 15、复习 45，二者都是单词与短语共享的额度。旧默认 20/60 且没有手动设置标记时升级为 15/45，明确手动设置的值保留。迁移默认值不丢弃待确认的同步 mutation，已测试丢失确认后不重复累计时长。
- 393×852 手机布局实测：零单词时打开新增表单，单词/短语两个选项都在；新增 discover 后进入单词分类；混合任务首个为 discover，随后为 I hear you。切到单词专练重练 discover，再回混合任务接续未学短语；短语专练完成一项后返回混合任务不重复已完成项。测试词仅位于本机 QA 访客环境，已移除；最后一个单词移除后入口仍在。
- 证据：qa/word-phrase-home-v071.png、qa/word-phrase-controls-v071.png。新访客环境显示 15/45。既有薄荷背景、图标与设备运行时保留，没有新增视觉素材；两个入口和任务量文字无截断。
- 50 项自动测试通过；新增混合队列、类型切换与暂停恢复、添加首词、补入当前任务、备份类型校验、默认值与同步确认保护用例。TypeScript、生产构建、29 个保护文件校验通过。
- 真实 PostgreSQL 临时账号测试通过新增单词、跨会话读回、sessionSlots 保存、旧客户端省略该字段时保留、匿名完整备份、账号隔离。临时账号与自动化备份仅按本次随机标识清理。
- 正式部署 dpl_BKzToWcKnDgSV1yBjyBZg1vj6MCS，版本 0.7.1、构建 6bed941cb6e68c7e，原链接不变。正式 version/library 均 200，词库仍为 121 条。HTTPS 临时账号回归通过单词写入、分类型分组保存、旧客户端字段保留与云备份读回；测试账号已清理。正式页面在零单词状态下仍能打开新增单词表单，单词/短语两个选择均可见；控制台无应用错误。原有手动 1/0 的 QA 配置保持不变，新访客环境已实测默认 15/45。

final result: passed

## v0.7.2 背诵按钮与掌握程度操作（2026-10-19）

- 视觉来源：/Users/bkg/Downloads/49892.jpg，1279×2781；归一化为 393×852。范围只包括用户指定的按钮大小、文案与操作区位置，原有词库内容和页面结构沿用。参考展示 upset；实现使用当前真实短语 don't kid yourself，不编造音标、例句和词典内容。
- 实现证据：qa/recall-preview-v072.png、qa/detail-preview-v072.png；浏览器 1400×1200 中设备屏幕实测为 393×852 CSS px，截图 393×852。完整对照 qa/compare-detail-v072.png，重点区域对照 qa/compare-controls-focus-v072.png；原生手机布局另测 393×852、375×568。设备状态栏与外框保留现有运行时，不仿造来源中的系统时间。
- 字体与图标：背诵选择文字从 16px 增大到 22px；释义操作文字从旧纠正按钮的 10px 增大到 15px，使用既有 Phosphor 回转箭头和垃圾桶图标，20px。文字均完整显示。颜色沿用橙色/绿色判断语义，释义操作采用灰绿，标记不认识后呈橙色。
- 间距与交互：主按钮宽高从 90×89 放大到 144×142.4，均为 1.6 倍；小屏从 88×74 放大到 140.8×118.4。“不认识 / 太简单”在释义标题下右对齐，同一行、44px 点击高度、细分隔线；标记前后位置不跳动。来源的操作区视觉高度更低；按用户“字体大一点”的要求有意增大。无新增位图素材，已有背景与图标清晰无缺失。
- 首次规范化全屏与局部对照未发现 P0/P1/P2 视觉问题。小屏短语、最长词条和展开提示证据：qa/recall-small-v072.png、qa/recall-long-small-v072.png，文本不遮挡判断按钮。释义页文案移除“其实没记住”，统一为“不认识”，两操作始终共同出现。
- 浏览器实测：“我认识 → 释义页不认识 → 下一个 → 小结 → 下一组”立即重现 don't kid yourself；“提示 → 我认识 → 太简单”进入下一词，词库仍保留 you're up early 并显示“已标记太简单”，本组不再要求重背它。修正了曾用提示后标记太简单仍可能被列入巩固的问题；新增跨分组恢复回归测试。
- 51 项测试、TypeScript、生产构建与 29 个保护运行时文件校验通过；浏览器控制台无应用错误。未执行真实账号数据更改或词库迁移；实体 iPhone 触感仍由用户体验确认。
- 正式部署 dpl_HVyCzdoJ3vVU8N6EA631X3WMkTfc 已 READY，稳定链接仍为 https://vocab-practice-dun.vercel.app/ 。公开版本接口确认 0.7.2 / 6bbd951352fa5eb0；正式浏览器实测主按钮 144×142.4、文字 22px，释义页显示两个新操作且无旧文案，控制台无错误。线上截图 qa/detail-online-v072.png。

final result: passed

## v0.7.3 认识状态的词条颜色与操作显示（2026-10-19）

- 按用户最新反馈，详情标题不再固定珊瑚红。显式选择“我认识”使用 ink 黑色 #292e2c；“不认识”使用原红色 #f17f53，同时移除整个“不认识 / 太简单”操作组。单词与短语使用同一个状态条件；浏览词库时标题为黑色，不继承上一次选择。提示使用记录及小结橙色历史继续独立保存。
- 393×852 原生布局实测：我认识→黑色且两个操作可见；直接不认识→红色且操作数量为零；释义页改标不认识→即时红色且操作组消失；先看提示再点我认识→黑色且两个操作仍可见。截图 qa/known-v073.png、qa/forgot-v073.png，局部并排证据 qa/recognition-states-v073.png。
- 构建、TypeScript 和 29 个运行时保护文件校验通过；浏览器控制台无错误。没有增加镜像实现的测试，没有变更学习调度或数据库。
- 已发布到原链接；部署 dpl_2hUEZwZVirCZMb2zH45vaG7d6dyD 为 READY，公开版本接口确认 0.7.3 / f30ea3802274cb87，与本地验证构建一致。

final result: passed

## v0.7.4 短语例句、翻译与自动朗读（2026-10-19）

- 参考 /Users/bkg/Downloads/49936.jpg 的释义下方例句区域，沿用现有 [例句]、绿色短语高亮、下方中文翻译、右侧喇叭布局，不添加白色例句卡片。121 个原词条全部补充原创生活场景例句与中文翻译，不声称是统计高频语料或摘自词典。
- 用户批准将 go down to business 更正为 get down to business，保留 phrase-ab4ca431e046dc49 编号；依据 https://dictionary.cambridge.org/dictionary/english/get-down-to-business 。其余词条与原编号、顺序保持不变。lay low 的例句采用 lie 的过去式 lay，避免用它冒充标准现在时表达。
- 旧缓存与恢复词库按稳定编号补空白例句；保留已有个人例句、翻译、部分填写内容及改名词条。没有修改 catalog revision，没有触发全词库替换或学习数据迁移。完整备份包含补齐后的内容。
- 自动朗读在“我认识 / 不认识”原始点击事件中触发一次，复用现有声音和语速；下一词或离开学习会取消上一段。关闭自动朗读时不播放，手动喇叭仍可重听。朗读状态由真实语音 start/end 事件驱动，并防止旧音频回调覆盖新的状态。
- 浏览器实测两种选择进入详情均出现“正在朗读例句，点击重听”，完成后恢复“朗读例句”；关闭自动朗读后无自动播放，点击喇叭仍开始播放；测试结束恢复自动朗读。当前测试机自动选择 Samantha，未声称已在用户实体 iPhone 上听验。黑色认识 / 红色不认识和不认识时隐藏操作组均保留。
- 393×852 展示证据 qa/examples-known-v074.png；375×568 小屏证据 qa/examples-forgot-small-v074.png。例句与译文清晰、短语高亮正确，笔记和底部操作没有遮挡；既有字体、薄荷背景和图标保留。控制台无应用错误。
- 55 项自动测试、TypeScript、生产构建和 29 个运行时文件校验通过。新增覆盖全部例句完整性、纠错编号、旧缓存幂等补全、个人文本保护、完整备份保留学习状态，以及自动朗读/静音/缺少例句的分支。
- 使用 --examples-only 模式事务更新 121 个共享词条，更新前存档为 phrases-49855-v1:before-examples-v1；该路径不访问账号学习表、不删除词条。第一次连接在执行 SQL 前中断，重试成功。
- 正式部署 dpl_7TcwCYmT5CDBNjH9mG3reAczkSy3 为 READY，原链接版本 0.7.4 / e395953a36d80326。公开词库逐项匹配全部 121 条例句、翻译、词条编号和顺序，catalog version 保持 phrases-49855-v1。正式页面实际出现“正在朗读例句，点击重听”，截图 qa/examples-online-v074.png；控制台无错误。
- 正式 HTTPS 临时账号回归通过：新内容的公开读取、登录、跨设备读回、幂等写入、账号隔离、旧客户端兼容、删除/撤销、完整匿名备份和修订冲突；测试账号与测试备份已清理，未触及真实账号的学习数据。

final result: passed

## v0.8.0 51133 短语追加导入（2026-10-22）

- 用户明确授权分组并行编写例句、修正可确认的提取错误，并保留原文件。源文件实际含 1,994 条编号记录，开头 1,650 为旧计数。归一化大小写、标点、空格与明确缩写变体，并在纠错后再次去重：新增 1,940 条、排除 54 条重复；原 121 条内容、编号和顺序完整不变，总计 2,061 条。
- 三组共完成 1,954 对候选例句，二次去重后使用 1,940 对；每条为原创常用场景英文和完整中文翻译，不宣称语料统计频率。主线程复核覆盖、重复例句、短语变体和修正建议，改写两处跨组重复例句。纠错及排除编号详见 qa/51133-import-report.json（包含原文、应用后的字段、依据与源文件哈希）。原文件哈希复核相同。
- 新增内容通过稳定 phrase-51133-* 编号追加；CATALOG_VERSION 未变。旧缓存、恢复备份与账号完整备份自动补入新增条目，已有个人同名条目优先。进度、笔记、收藏、删除标记、每日限额、当前分组和未确认同步 mutation 不被内容更新改写。
- 词库按 120 条分批渲染，搜索始终覆盖全库。真实手机布局 393×852 中验证初始 120 行、加载后 240 行；无需加载所有行即可搜索到源文件最后一条 a touch of。进入其学习页后实际出现“正在朗读例句，点击重听”，双语内容和绿色高亮正确，原有认识/不认识交互保持。浏览器控制台无应用错误。
- 证据 qa/import-home-v080.png 显示总数 2,061 和保留的 15/45 设置；qa/import-detail-v080.png 显示新增末条的英文例句、翻译与朗读入口。既有 10 月 19 日学习记录和待复习数据继续显示；测试未登录，仅使用本机 QA 访客记录。
- 64 项自动测试、TypeScript、完整构建及 29 个保护运行时文件校验通过。完整默认备份 750,001 字节，低于 3MB 限制；主脚本约 1.02MB，低于 Workbox 5MB 单文件缓存上限，28 项离线资源成功生成。当前内置浏览器未报告 service worker 就绪，因此本轮没有声称完成断网重启或实体 iPhone 离线验证；没有清除任何网站数据。
- --append-51133 事务已成功插入 1,940 条，旧 121 条存档于 phrases-49855-v1:before-51133-v1；此路径只插入新共享行，不删除/覆盖旧行，也不访问账号学习状态表。
- 正式部署 dpl_G4qyH4fTgdnF4pr6qH31kUrMaU6U 为 READY，原链接公开版本 0.8.0 / 649dd39690d1aade。正式浏览器显示 2,061 条，搜索 you lost me 后可进入学习，实际出现“正在朗读例句，点击重听”；证据 qa/import-online-v080.png、qa/import-card-v080.png。控制台无应用错误。
- 线上回归直接读取共享数据库逐项对照全部 2,061 条，并确认 before-51133 存档逐项等于原 121 条，避免 API 回退掩盖未入库问题。登录、跨设备同步、重复写入、冲突、账号隔离、删除/撤销、全量匿名备份及旧客户端保护均通过；临时测试账号与备份已清理。真实账号学习记录未被导入过程改写。

final result: passed

## v0.9.0 自然男女声与离线音频（2026-10-23）

- 用户要求替换手机合成声音，随机使用男女声；试听后保留 Heart 女声、拒绝 Fenrir，并明确选择男声 A / Michael。采用 Kokoro-82M 的 af_heart / am_michael，在本机生成自然 AI 配音，语速 0.95；不描述为真人录音。模型和生成环境仅在 qa/，不部署到服务器。
- 2,061 个内置词条和例句对应 4,122 段文本，两套共 8,244 个 MP3，96.7 MB。全部文件通过清单覆盖、音色元数据、文件数量/大小与完整解码检查；生成过程校验时长、有限数值和非静音。缩写 sb./sth. 在朗读输入中展开，词库文本、编号、例句和学习数据不修改。
- 用完整音频替换设备 speechSynthesis。每段开始随机选一种声音，或固定 Heart / Michael；从原始点击手势启动播放。自动读词、认识/不认识后读例句、手动重听、关闭自动播放、切换/退出取消上一段均验证。过期回调、播放被阻止、加载超时、缓存 HTML 误响应、下载暂停和恢复都有保护。
- 正文与例句使用按需缓存；用户可保存当天或全部语音。缓存完整 200 响应，Workbox RangeRequestsPlugin 为媒体请求提供 206 响应。安装预缓存仍为 28 项 / 4,659,667 字节，不自动下载整套音频。独立离线 HTML 包含全部音频，约 128 MiB。自建文本没有匹配音频时明确提示，不默默回退到被用户拒绝的系统音色。
- IAB 的 393×852 原生布局中，确认男女声试听实际触发 playing、两种回答都自动朗读例句、关闭自动朗读后手动重听仍可用；下载当天 60 段成功，全量下载可暂停后恢复。证据 qa/natural-voice-settings-v090.png。
- Chrome 独立测试端口 4175 显示“已准备好离线使用”，先保存当天 60 段，在还未播放它们时关闭该端口服务器（确认无监听进程），重新加载仍进入首页并自动播放词条和例句。随后分别固定男声和女声试听，均触发实际 playing。证据 qa/natural-audio-offline-v090.png。测试后恢复服务器和随机/自动朗读默认选项；未修改用户网络设置或清除网站数据。
- 71 项自动测试、TypeScript、生产构建和 29 个受保护运行时文件校验通过。主脚本约 1.31 MB，构建保留既有大 chunk 提示，低于 Workbox 单文件上限；没有更改受保护运行时或数据库。
- 首次归档发布发现打包范围异常增大，已停止。使用明确文件白名单建立独立发布目录，压缩包约 97.2 MB，重新通过运行时和音频检查后部署。修正项目 .vercelignore 的目录规则，使目录本身被忽略；直接调用已安装 Vercel CLI 的文件扫描器确认 qa、模型、依赖、dist、环境变量和工具私有目录都不在上传范围，结果 qa/audio-upload-scope.json。
- 正式部署 dpl_7znaA5iXcXzJ4SDu2bN5y6sGZ5Pd 为 READY，原地址 https://vocab-practice-dun.vercel.app/ 公开版本为 0.9.0 / 648caa7e4669bf50。8 个首尾及中间男女声样本逐字节匹配本地；全部 8 个 Range 请求返回正确 206 和 128 字节内容。正式网页试听出现“正在播放…”，默认随机模式、既有自定义任务量与历史记录保留。线上验证结果 qa/audio-release-result.json。

final result: passed
