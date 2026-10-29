// ══ 今晚 ══════════════════════════════════════════════════════════════════════════════
// P1 只放骨架:标题 +「P2 待做」。P2 在这个文件和 css/screens/tonight.css 里写界面。
// 这一屏要做的事:今晚做什么、做完没。四层:① 标题 + 一句为什么 ② 今晚的情况(洗澡吗 / 刮胡吗)③ 最多一张提醒卡(就医 > 注意 > 方案变了)④ 步骤 → 完成今晚 / 记一下皮肤(进记录流程)。顾问写的今晚优先(ai/apply.js tonightPlan),不可用时离线(engine/schedule.js)。就医红线卡任何模式都显示。
// 约定:render(app) 返回 HTML 字符串;mount(root, app) 挂事件(不用 onclick="全局函数",模块里没有全局)。
// 数据一律从 app.world() 拿(每次一份新的只读快照),写入走 model/* 或 ai/apply.js 的本机操作入口,不直接碰 localStorage。
import { esc } from './sheets.js';

export const id = 'tonight';
export const title = '今晚';
export function render(app) {
    return `<h1 class="page-title" id="tonight-h">${esc(title)}</h1><p class="note p2-todo">P2 待做</p>`;
}
export function mount(root, app) { }
