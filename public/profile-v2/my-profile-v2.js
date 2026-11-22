(()=>{
const $=s=>document.querySelector(s);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=document.createElement('section');page.id='wordiiMyProfileV2';page.className='hidden';
page.innerHTML='<header class="wmp-head"><button id="wmpBack" type="button" aria-label="Back">←</button><b>Wordii <em>Chat</em></b><button id="wmpSettings" type="button" aria-label="Settings">⚙</button></header><main id="wmpContent"></main>';
document.body.appendChild(page);
const adminAsset='profile-v2/admin-avatar.jpg';
function show(){
 const d=window.wordiiProfileV2Data?.();if(!d){alert('Open You / Settings first');return;}
 const banner=d.admin
  ? "background-image:url('profile-v2/admin-banner.jpg')"
  : (d.banner ? "background:"+d.banner : "");
 const avatar=d.admin?`<img src="${adminAsset}" alt="Admin profile picture">`:d.avatar&&/^(data:image\/|https:\/\/)/.test(d.avatar)?`<img src="${escapeHTML(d.avatar)}" alt="Profile picture">`:`<span>${escapeHTML((d.name||'?').slice(0,1).toUpperCase())}</span>`;
 $('#wmpContent').innerHTML=`<div class="wmp-cover" style="${banner}"></div><div class="wmp-avatar">${avatar}</div><div class="wmp-inner"><h1>${escapeHTML(d.name)}</h1><div class="wmp-badges">${d.admin?'<span>♛ Admin</span>':''}<span class="wmp-level-seat">${d.admin?'<img class="wmp-level-character" src="profile-v2/admin-level-character.png" alt="Xwordii character">':''}★ Lv. ${Number(d.level)||1}</span></div><div class="wmp-handle">${escapeHTML(d.username)}</div><div class="wmp-presence">${d.online?'● Online':''}</div><div class="wmp-stats"><div><b>—</b><small>Posts</small></div><div><b>${Number(d.followers)||0}</b><small>Followers</small></div><div><b>${Number(d.following)||0}</b><small>Following</small></div></div><div class="wmp-actions"><button data-wmp-go="edit">✎ Edit Profile</button><button data-wmp-go="invite">♧ Share Profile</button></div><p class="wmp-bio">${escapeHTML(d.bio||'Add a bio')}</p><div class="wmp-quick"><button data-wmp-go="subs"><i>♛</i>Badges</button><button data-wmp-go="points"><i>⬡</i>Level</button><button data-wmp-go="points"><i>✪</i>Points</button><button data-wmp-go="subs"><i>◆</i>Collection</button><button data-wmp-go="couple"><i>♡♡</i>Couple</button></div>${d.coupleCode?`<div class="wmp-couple"><span class="wmp-heart">♡</span> Couple · ${escapeHTML(d.coupleCode)}</div>`:''}<div class="wmp-tabs"><button class="active" data-wmp-tab="posts">▦ Posts</button><button data-wmp-tab="status">▷ Status</button><button data-wmp-tab="about">ⓘ About</button></div><div id="wmpPanel" class="wmp-panel">Loading posts…</div></div>`;
 window.wordiiLevelCharacterForCurrent?.().then(png=>{
   if(!png||page.classList.contains('hidden'))return;
   const badge=page.querySelector('.wmp-level-seat');if(!badge)return;
   badge.querySelector('.wmp-level-character')?.remove();
   const image=document.createElement('img');image.className='wmp-level-character';image.src=png;image.alt='Level character';badge.prepend(image);
 });
 page.classList.remove('hidden');
 window.WordiiPosts?.render();
}
function hide(){page.classList.add('hidden')}
$('#wmpBack').onclick=hide;$('#wmpSettings').onclick=hide;
document.addEventListener('click',e=>{
 if(e.target.closest('#wordiiMyProfileOpen, [data-wd-settings="myprofile"]')){e.preventDefault();e.stopPropagation();show();return}
 const tab=e.target.closest('[data-wmp-tab]');if(tab){tab.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===tab));if(tab.dataset.wmpTab==='posts'){window.WordiiPosts?.render();}else{$('#wmpPanel').textContent=tab.dataset.wmpTab==='status'?'Your statuses are available in the Status section.':'Your profile settings remain in You / Settings.';}return}
 const go=e.target.closest('[data-wmp-go]');if(go){hide();document.querySelector('#profile [data-go="'+go.dataset.wmpGo+'"]')?.click();}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!page.classList.contains('hidden'))hide();if((e.key==='Enter'||e.key===' ')&&document.activeElement?.id==='wordiiMyProfileOpen'){e.preventDefault();show()}});
})();