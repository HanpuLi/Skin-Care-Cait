// ══ 设置(头部右上角印章打开)—— P1 最简可用版:账号与同步、恢复副本 ═════════════════════════════
// 冲突「稍后再选」之后要能回来选,恢复副本要能换回:这两件在 P1 就得能用。其余设置项(使用方式、肤质、区域、洗澡习惯、外观…)P2 做。
import { openSheet, esc } from './sheets.js';

export function openSettings(app) {
    const s = app.sync;
    const u = s.state.user;
    const html = `<div class="sheet-sec"><div class="sec-t">账号与同步</div>
        <div id="auth-btn">${u
            ? `<div class="row"><span class="row-main"><span class="lede">${esc(u.displayName ? String(u.displayName).split(' ')[0] : '已登录')}</span>${u.email ? `<span class="meta">${esc(u.email)}</span>` : ''}</span><button type="button" class="btn-link quiet" data-act="signout">退出登录</button></div>`
            : `<button type="button" class="btn btn-primary btn-block" data-act="signin">用 Google 登录（换手机数据还在）</button>`}</div>
        <p class="note" id="sync-line">${esc(s.syncLineText())}</p>
        <button type="button" class="btn btn-primary" id="sync-choose" data-act="choose"${s.state.conflict ? '' : ' hidden'}>选一份记录</button></div>
        <div class="sheet-sec"><div class="sec-t">数据</div><div class="btn-row"><button type="button" class="btn" data-act="recovery">恢复副本</button></div></div>
        <div class="sheet-sec"><p class="note">其余设置：P2 待做</p></div>`;
    openSheet({ id: 'settings-sheet', title: '设置', html, onMount: ov => {
        ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
            const a = b.dataset.act;
            if (a === 'signin') app.signIn();
            else if (a === 'signout') app.signOut();
            else if (a === 'choose') s.showSyncConflict();
            else if (a === 'recovery') s.showSyncRecovery();
        }));
    } });
}
