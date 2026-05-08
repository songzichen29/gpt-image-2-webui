# GPT Image Playground 架构总入口

> 状态：骨架（待填充）
> 创建日期：2026-05-08

## 1. 项目简介

基于 Next.js 的 GPT Image 生成与编辑工作台，支持生成、编辑、历史查看、本地缓存、服务端文件存储与 OpenAI 兼容接口接入。

## 2. 核心概念 / 术语表

- 图片生成
- 图片编辑
- 历史记录
- 本地缓存（localStorage / IndexedDB）
- 服务端图片存储（generated-images）
- OpenAI 兼容接口
- sub2api SSO（可选）
- Image2 Session（gpt-image 自签 HttpOnly 会话 Cookie）

## 3. 子系统 / 模块索引

- `src/app/`：页面与 API Route
- `src/components/`：界面组件
- `src/lib/`：状态、i18n、存储、成本与尺寸工具
- `src/lib/server/`：服务端认证与图片文件路径工具
- `scripts/`：运维脚本

## 4. 关键架构决定

- 前端使用 Next.js App Router
- 历史元数据保存在浏览器 localStorage
- 图片二进制优先缓存到 IndexedDB
- 服务端可选使用文件系统保存生成图片
- 配置 `SUB2API_BASE_URL` 后，sub2api 成为 image2 的认证权威；gpt-image 通过 sub2api `/api/v1/auth/me` 校验传入 token，并用 Image2 Session Cookie 保护自身页面和 API。
- SSO 模式下，history localStorage、IndexedDB 图片缓存、`generated-images` 文件路径都按 sub2api `user.id` 分区。

## 5. 已知约束 / 硬边界

- Base URL 由服务端环境变量配置
- API Key 可由前端本地输入或服务端环境变量提供
- 前端视觉改动不应改变现有功能行为
- SSO 模式不把 sub2api JWT 长期写入 gpt-image localStorage；URL token 只用于一次性交换 Image2 Session。
- 不同二级域名 iframe 部署时，需要配置 `IMAGE2_COOKIE_SAMESITE=none` 与 `IMAGE2_COOKIE_SECURE=true`，否则浏览器可能阻止 iframe 内 Cookie。
