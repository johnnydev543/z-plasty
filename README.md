# Z-plasty Lab

以繁體中文呈現的 Z-plasty 互動教學網站，包含 2D 幾何與 3D 實心柱體皮瓣轉位示意。

## 功能

- 切口角度、長度、方向與鏡像調整；切口按 mm 比例縮放。
- 3D 皮瓣抬升、轉位、落回，以及可調強度的柱體形變。
- 平面／柱狀表面、獨立柱徑、視角與畫質選擇。
- 軸向延長、橫向縮短、柱體長度、橫截面直徑與周長。
- 轉位時間軸、前後比較、深淺主題及 PNG／SVG 匯出。
- 按需渲染；閒置時停止重繪。

## 本機執行

這是無需建置的靜態網站，不需要 npm 安裝。

```sh
git clone https://github.com/johnnydev543/z-plasty.git
cd z-plasty
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

在瀏覽器開啟 <http://127.0.0.1:4173>。請透過 HTTP 伺服器執行，以便載入 JavaScript 模組。

## 原始碼

- `dist/index.html`：頁面結構。
- `dist/style.css`：響應式版面與主題。
- `dist/app.js`：介面、2D 幾何、時間軸與匯出。
- `dist/scene3d.js`：3D 曲面、皮瓣、柱體形變與尺寸資料。
- `dist/vendor/`：Three.js 0.180.0 與其 MIT 授權文件。
- `.openai/hosting.json`：既有 Sites 網站的部署設定。

## 模型範圍

理論延長比例為 `sqrt(5 - 4*cos(theta))`。橫向寬度在展開平面中計算；柱體形變採用可調強度、維持容積的簡化視覺規則。抬升高度、組織厚度與轉位路徑均為教學示意，並非經驗證的組織力學模型或個別手術規劃工具。

Three.js 的授權保留於 `dist/vendor/THREE-LICENSE.txt`。
