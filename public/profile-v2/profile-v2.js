/* Profile V2 visual phase 1: no Firestore writes or fake post publishing */
(()=>{const host=document.getElementById('profile');if(!host)return;
function refresh(){const top=host.querySelector('.you-top');if(!top)return;
// Admin detection uses the existing visible role badge, never applies artwork to other accounts.
const isAdmin=!!top.querySelector('[title="Admin"], [aria-label="Admin"], .wd-role-admin') || /\bAdmin\b/.test(top.querySelector('h2')?.textContent||'');
top.classList.toggle('wpv2-admin',isAdmin);
let extra=host.querySelector('.wpv2-extras');if(extra)return;
extra=document.createElement('section');extra.className='wpv2-extras';
const followers=(top.textContent.match(/([\d,.]+)\s*followers/i)||[])[1]||'0';
extra.innerHTML=`<div class="wpv2-stats"><div><strong>—</strong><small>Posts</small></div><div><strong>${followers}</strong><small>Followers</small></div><div><strong>—</strong><small>Following</small></div></div><div class="wpv2-tabs"><button class="active" data-wpv="posts">▦ Posts</button><button data-wpv="status">▷ Status</button><button data-wpv="about">ⓘ About</button></div><div class="wpv2-panel">Post publishing will be added in the next phase.</div>`;
top.insertAdjacentElement('afterend',extra);
extra.addEventListener('click',e=>{const b=e.target.closest('[data-wpv]');if(!b)return;extra.querySelectorAll('[data-wpv]').forEach(x=>x.classList.toggle('active',x===b));extra.querySelector('.wpv2-panel').textContent=b.dataset.wpv==='posts'?'Post publishing will be added in the next phase.':b.dataset.wpv==='status'?'Your existing Status feature is available in the Status tab.':'Edit profile, privacy, badges and account settings remain below.';});}
new MutationObserver(()=>{if(!host.querySelector('.wpv2-extras'))refresh();}).observe(host,{childList:true});refresh();
})();