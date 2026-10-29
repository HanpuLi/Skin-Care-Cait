// ══ 产品 ══════════════════════════════════════════════════════════════════════════════
// P1 只放骨架:标题 +「P2 待做」。P2 在这个文件和 css/screens/products.css 里写界面。
// 这一屏要做的事:货架(一行一件)、快用完了 / 用完了 / 买回来了(走 ai/apply.js 的 local* 入口)、要不要买新的(顾问版优先,离线兜底)、空瓶记录。
// 约定:render(app) 返回 HTML 字符串;mount(root, app) 挂事件(不用 onclick="全局函数",模块里没有全局)。
// 数据一律从 app.world() 拿(每次一份新的只读快照),写入走 model/* 或 ai/apply.js 的本机操作入口,不直接碰 localStorage。
import { esc } from './sheets.js';

export const id = 'products';
export const title = '产品';
export function render(app) {
    return `<h1 class="page-title" id="products-h">${esc(title)}</h1><p class="note p2-todo">P2 待做</p>`;
}
export function mount(root, app) { }
