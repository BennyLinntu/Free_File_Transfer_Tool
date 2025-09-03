# 文件转换器（PDF / DOCX / TXT）

一个精简好看的全栈网页应用：上传 PDF / DOCX / TXT，转换为 TXT 或 DOCX，并提供下载链接。

## 功能

- 源格式：PDF、DOCX、TXT
- 目标格式：TXT、DOCX
- PDF→TXT、PDF→DOCX、DOCX→TXT、TXT→DOCX、DOCX→DOCX（重排为纯文本）
- 单文件最大 25MB，转换后自动清理临时文件

## 运行步骤（Windows / PowerShell）

1. 安装 Node.js LTS（如果未安装）

- 前往 <https://nodejs.org/> 下载并安装 LTS 版本（包含 npm）
- 安装后重新打开 PowerShell

2. 安装依赖并启动

```powershell
cd "c:\Users\Benny\System File\Desktop\WEB"
npm install
npm start
```

3. 打开浏览器访问

- <http://localhost:3000>

## 目录结构

- `server.js` 后端 API（Express）与静态资源托管
- `public/` 前端页面与样式、脚本
- `uploads/` 上传的临时文件（运行时自动创建）
- `converted/` 转换好的文件（下载后自动删除）

## 常见问题

- 扫描版 PDF（仅包含图片）无法直接提取文字，需要 OCR 才能识别。
  - 可考虑后续接入 Tesseract OCR 或在线 OCR 服务。
- 如果 3000 端口被占用，可设置环境变量 `PORT=xxxx` 再启动。

## 安全与限制

- 仅做文本抽取与生成，不执行宏/脚本
- 上传与导出均会在下载后清理临时文件

## 许可证

MIT
