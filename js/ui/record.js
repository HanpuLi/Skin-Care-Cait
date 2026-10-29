// ══ 记录 ══════════════════════════════════════════════════════════════════════════════
// P1 只放骨架:标题 +「P2 待做」。P2 在这个文件和 css/screens/record.css 里写界面。
// 这一屏要做的事:顶部随时记一笔(一句话或一张照片;拍照全套分析走 capture),下面回看:14 天、脸部地图热度、走势、HRT(只本人开了才有)、每天的记录。
// 约定:render(app) 返回 HTML 字符串;mount(root, app) 挂事件(不用 onclick="全局函数",模块里没有全局)。
// 数据一律从 app.world() 拿(每次一份新的只读快照),写入走 model/* 或 ai/apply.js 的本机操作入口,不直接碰 localStorage。
import { esc } from './sheets.js';

export const id = 'record';
export const title = '记录';
export function render(app) {
    return `<h1 class="page-title" id="record-h">${esc(title)}</h1><p class="note p2-todo">P2 待做</p>`;
}
export function mount(root, app) { }
