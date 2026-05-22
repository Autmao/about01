# about编辑部 Open Call 阿里云迁移手册

目标架构：

- 应用部署：阿里云 SAE，使用容器镜像部署 Node.js Express 应用
- 数据库：阿里云 Supabase / AnalyticDB PostgreSQL，使用 `DATABASE_URL`
- 文件存储：阿里云 OSS，使用 `STORAGE_PROVIDER=oss`

## 1. 准备数据库

1. 在阿里云 Supabase / AnalyticDB PostgreSQL 创建项目或实例。
2. 获取 PostgreSQL 连接串，填入 SAE 环境变量：
   - `DATABASE_URL=postgresql://user:password@host:port/dbname?sslmode=require`
3. 确认数据库网络允许 SAE 访问。
4. 应用首次启动时会自动执行建表逻辑，表结构在 `db.js` 中维护。

## 2. 准备 OSS

1. 创建 OSS Bucket，建议与 SAE 在同一地域。
2. 如果简历和作品集需要后台直接打开，Bucket 需要可公开读取，或绑定一个公开 CDN/自定义域名。
3. 创建 RAM 用户，授予该 Bucket 的上传权限。
4. 在 SAE 环境变量中设置：

```bash
STORAGE_PROVIDER=oss
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=your-oss-bucket
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_UPLOAD_PREFIX=about-open-call
```

Bucket 可以保持私有。应用会在后台投递列表中生成临时下载链接，工作人员打开简历/作品集时再由后端签发 OSS 临时 URL。

## 3. 准备 SAE 镜像部署

项目已经提供 `Dockerfile`，本地可先验证：

```bash
npm ci
npm start
```

健康检查地址：

```bash
curl http://localhost:3000/health
```

SAE 中建议配置：

- 运行端口：`3000`
- 健康检查路径：`/health`
- 启动命令：镜像内默认 `npm start`

## 4. SAE 环境变量清单

必填：

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=your_admin_password
JWT_SECRET=replace_with_a_long_random_secret
FILE_ACCESS_SECRET=replace_with_another_long_random_secret
STORAGE_PROVIDER=oss
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=your-oss-bucket
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
```

建议填写：

```bash
PUBLIC_BASE_URL=https://你的正式域名
ADMIN_EMAIL=your-admin-email@example.com
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
RESEND_FROM=about编辑部 <noreply@yourdomain.com>
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

## 5. 迁移现有数据

如果当前线上已经有真实投递数据：

1. 从旧 PostgreSQL 导出数据。
2. 导入到阿里云 PostgreSQL。
3. 已上传到 Vercel Blob 的旧文件不会自动搬到 OSS；需要单独迁移文件，并批量替换 `applications.resume_url` 和 `applications.portfolio_files` 中的 URL。

如果当前没有需要保留的真实数据，可以直接让新库空库启动，应用会自动建表。

## 6. 上线校验

上线后依次检查：

1. `https://你的域名/health` 返回 `ok: true`
2. 首页能看到岗位
3. 创作伙伴邮箱验证码能发送
4. 投递表单能提交
5. 上传简历或作品集后，返回 URL 指向 OSS
6. 后台可以登录、查看投递、查看咨询记录

## 7. 回滚方案

本次代码保留 Vercel Blob 兼容。如果需要临时回滚文件上传，只需移除 SAE 环境变量中的 `STORAGE_PROVIDER=oss` 和 OSS 相关配置，并配置 Vercel Blob 对应环境即可。
