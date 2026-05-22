# Git 标签自动发布 npm（一步一步）

发布包：`@lixue2018/monitorx-core`、`@lixue2018/monitorx-vue`  
触发方式：向 GitHub 推送标签 `v1.0.3` → GitHub Actions 自动 build + publish。

---

## 第一步：创建 npm Granular Token（只做一次）

1. 打开 https://www.npmjs.com/settings/~tokens  
2. **Generate New Token** → 选 **Granular Access Token**  
3. 配置：
   - **Packages and scopes** → Read and write  
   - 作用域选 `@lixue2018`（或 All packages）  
   - 勾选 **Bypass 2FA for automation**（必须，否则 CI 也会 403）  
4. 生成后**复制 Token**（只显示一次），保存到密码管理器  

> 不要把 Token 提交到 git，不要发到聊天里。

---

## 第二步：把代码推到 GitHub（只做一次）

### 2.1 在 GitHub 新建仓库

1. 打开 https://github.com/new  
2. 仓库名：`monitor-sdk`（与 package.json 里一致即可）  
3. 选 **Private** 或 Public  
4. **不要**勾选 “Add README”（本地已有代码）  
5. 创建仓库  

### 2.2 本地初始化并推送

在终端执行（路径按你的实际目录）：

```bash
cd D:/fe-monitor/monitor-sdk

git init
git add .
git commit -m "chore: init monitor-sdk with npm publish workflow"

git branch -M main
git remote add origin https://github.com/lixue2018/monitor-sdk.git

git push -u origin main
```

若 `monitor-sdk` 已在 `fe-monitor` 大仓库里，可以只把 `monitor-sdk` 子目录单独建仓，或把整个 `fe-monitor` 推到 GitHub，但 **workflow 路径要在仓库根目录的 `.github/workflows/`**，且 `npm ci` 要在含 `package.json` 的 monitor-sdk 根目录执行。

**若仓库根是 `fe-monitor`**，把 workflow 放到 `fe-monitor/.github/workflows/publish-npm.yml`，并把 workflow 里的 `working-directory` 设为 `monitor-sdk`（见下方说明）。

---

## 第三步：配置 GitHub Secret（只做一次）

1. 打开 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**  
2. **New repository secret**  
3. Name：`NPM_TOKEN`  
4. Value：粘贴第一步的 Granular Token  
5. Save  

---

## 第四步：确认 workflow 文件已存在

仓库中应有：

```
.github/workflows/publish-npm.yml
packages/core/package.json   （含 publishConfig）
packages/vue/package.json    （含 publishConfig）
```

提交并推到 GitHub：

```bash
git add .github/workflows/publish-npm.yml docs/PUBLISH.md .gitignore
git commit -m "ci: add npm publish on git tag"
git push
```

---

## 第五步：日常发布（每次发新版都做）

### 5.1 改版本号（两个包建议一致）

编辑：

- `packages/core/package.json` → `"version": "1.0.3"`  
- `packages/vue/package.json` → `"version": "1.0.3"`  

并确认 vue 里 peer 版本合理，例如：

```json
"@lixue2018/monitorx-core": "^1.0.3"
```

### 5.2 提交代码

```bash
cd D:/fe-monitor/monitor-sdk

git add packages/core/package.json packages/vue/package.json
git commit -m "chore: release v1.0.3"
git push
```

### 5.3 打标签并推送（触发自动发布）

```bash
git tag v1.0.3
git push origin v1.0.3
```

标签格式必须是 **`v` + 版本号**，例如：`v1.0.3`。

### 5.4 在 GitHub 看进度

1. 仓库 → **Actions**  
2. 点开 **Publish to npm**  
3. 绿色 ✓ 表示发布成功  

### 5.5 验证 npm 上已有新版本

```bash
npm view @lixue2018/monitorx-core version
npm view @lixue2018/monitorx-vue version
```

应显示 `1.0.3`。

---

## 第六步：业务项目安装新版本

```bash
cd D:/objectmain/csl-new-front
npm install @lixue2018/monitorx-core@1.0.3 @lixue2018/monitorx-vue@1.0.3
```

---

## 常见问题

### 1. Actions 里 403 Forbidden

- `NPM_TOKEN` 必须是 **Granular Token**  
- 必须勾选 **Bypass 2FA for automation**  
- Token 对 `@lixue2018` 有 write 权限  

### 2. 版本已存在

```
You cannot publish over the previously published versions
```

把 `package.json` 版本号再加大，例如 `1.0.4`，重新 commit、打新标签 `v1.0.4`。

### 3. 标签 pushed 但没触发

- 标签必须是 `v1.0.3` 这种格式  
- 用 `git push origin v1.0.3`，不是只 push branch  

### 4. 仓库在 fe-monitor 根目录

在 workflow 里给每一步加：

```yaml
defaults:
  run:
    working-directory: monitor-sdk
```

或把 `monitor-sdk` 单独作为 GitHub 仓库（推荐，最简单）。

---

## 流程图

```
改 version → git commit → git push
                ↓
         git tag v1.0.3
                ↓
      git push origin v1.0.3
                ↓
     GitHub Actions 自动运行
                ↓
   npm publish core → npm publish vue
```
