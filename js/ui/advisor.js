// ══ 顾问 ══════════════════════════════════════════════════════════════════════════════
// P1 只放骨架:标题 +「P2 待做」。P2 在这个文件和 css/screens/advisor.css 里写界面。
// 这一屏要做的事:现在的方案(为什么这么排、刷酸节奏、未来 7 晚排洗澡 / 刮胡、版本与撤销)+ 问顾问(对话 SSE,改动直接生效 + 撤销)+ 每周复盘 + 常识(写死,离线可看)。
// 约定:render(app) 返回 HTML 字符串;mount(root, app) 挂事件(不用 onclick="全局函数",模块里没有全局)。
// 数据一律从 app.world() 拿(每次一份新的只读快照),写入走 model/* 或 ai/apply.js 的本机操作入口,不直接碰 localStorage。
import { esc } from './sheets.js';

export const id = 'advisor';
export const title = '顾问';
export function render(app) {
    return `<h1 class="page-title" id="advisor-h">${esc(title)}</h1><p class="note p2-todo">P2 待做</p>`;
}
export function mount(root, app) { }
