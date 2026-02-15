# InkTrace Viewer

InkTrace Viewer 是一個基於 Electron + React + Vite 的 SVG 檢視工具，適合用來瀏覽字形或筆跡類 SVG 資產，並支援從 Git 倉庫同步資料後快速掃描檔案。

## 功能特色

- 掃描指定資料夾下所有 `.svg`（含遞迴子資料夾）
- 依檔名規則解析字元與變體（variant）
- 顯示單一字元的多個 SVG 版本
- 內建搜尋與詳細檢視模式
- 支援選擇本機資料夾、Git Clone / Pull 同步

## 技術棧

- Electron
- React
- Vite
- simple-git

## 環境需求

- Node.js 20+
- npm 9+

## 安裝

```bash
npm install
```

## 開發與執行

### 1) 一般啟動（Electron）

```bash
npm run start
```

### 2) 開發模式（Vite + Electron）

```bash
npm run dev
```

> 開發模式會同時啟動 Vite 與 Electron，適合調整 UI 與互動邏輯。

## 打包前端資源

```bash
npm run build
```

會輸出到 `dist/`。

## 使用流程

1. 開啟設定面板（Settings）。
2. 輸入 Git Repository URL（可選）。
3. 選擇或輸入 Local Folder Path。
4. 點擊：
   - `Clone / Update`：同步遠端 Git 倉庫到本機資料夾。
   - `Scan Folder`：掃描資料夾內 SVG 檔案。
5. 在主畫面使用搜尋與卡片檢視字元與變體。

## 專案結構

```text
.
├─ main.js           # Electron main process（視窗、IPC、Git/掃描）
├─ preload.js        # 安全橋接 API（contextBridge）
├─ src/
│  ├─ App.jsx        # 主要 UI 與互動邏輯
│  ├─ SvgAutoCrop.jsx
│  └─ LazyCharCard.jsx
├─ index.html
├─ vite.config.mjs
└─ package.json
```

## 注意事項

- 專案會遞迴掃描指定路徑，資料量大時可能需要較長時間。
- SVG 裁切範圍採近似計算策略，特殊 path 指令組合可能有誤差。
- 若遇到啟動失敗，先確認目前沒有殘留的 Electron 程序，再重新執行。

## License

MIT