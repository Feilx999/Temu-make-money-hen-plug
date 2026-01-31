// 弹窗拦截器 - 自动拦截TEMU页面的弹窗
// 
// 注意：由于页面CSP限制，拦截器代码已移至 background.js
// 使用 chrome.scripting.executeScript 动态注入到页面主世界
// 
// 目标域名：agentseller.temu.com, seller.kuajingmaihuo.com
// 允许的弹窗编号：5-120-1, 5-118-0
// 
// 此文件保留作为参考，实际代码在 background.js 的 popupInterceptorCode 函数中
