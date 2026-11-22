import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// 必须先于任何 Excalidraw 模块加载，将其字体与本地化资源指向本地同源路径，严禁访问外网 CDN
window.EXCALIDRAW_ASSET_PATH = new URL('/excalidraw-assets/', window.location.href).href;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
