/* Wordii music two-step editor, additive patch. */
(()=>{
 const $=id=>document.getElementById(id);
 const panel=$('stMusicPanel'), editor=$('storyEdit'), libraryDone=$('wordiiMusicDone');
 const selected=$('wordiiMusicSelected'), start=$('wordiiMusicStart'), duration=$('wordiiMusicDuration');
 if(!panel||!editor||!libraryDone||!selected||!start||!duration)return;
 const css=document.createElement('style');
 css.textContent=`#wdMusicTrimV4{position:fixed;inset:0;z-index:2147483645;background:#08080c;color:white;display:flex;flex-direction:column;padding:18px 16px;gap:18px;overflow:auto}#wdMusicTrimV4[hidden],#wdMusicDurationPopup[hidden]{display:none!important}#wdMusicTrimV4 .wdWave{display:flex;align-items:center;gap:3px;height:96px;overflow:hidden;background:#15141b;border-radius:14px;padding:10px}#wdMusicTrimV4 .wdWave i{display:block;flex:1;min-width:2px;background:#777480;border-radius:3px}#wdMusicTrimV4 input[type=range]{width:100%;accent-color:#f72b5e}#wdMusicTrimV4 button{border:1px solid #55535b;background:#26242e;color:#fff;border-radius:18px;padding:12px 16px}#wdMusicTrimV4 .wdPrimary{background:#f51e54;border:0;font-weight:700}#wdMusicDurationPopup{background:#24212b;padding:15px;border-radius:16px}#wdMusicTrimV4 .wdRow{display:flex;gap:10px;align-items:center;justify-content:space-between}#wdMusicTrimV4 .wdRow button{flex:1}#wdMusicTrimV4 h2{font-size:19px;margin:0}`;
 document.head.append(css);
 const wrap=document.createElement('div');wrap.id='wdMusicTrimV4';wrap.hidden=true;
 wrap.innerHTML=`<div class="wdRow"><button type="button" id="wdTrimBack">← Library</button><h2>Trim Music</h2><span style="width:80px"></span></div><p id="wdTrimTitle"></p><div class="wdWave" id="wdTrimWave" aria-hidden="true"></div><label for="wdTrimPosition">Choose song part</label><input id="wdTrimPosition" type="range" min="0" max="180" step="0.5" value="0"><div class="wdRow"><output id="wdTrimTime">0:00 – 0:15</output><button type="button" id="wdTrimDurationBtn">15s ▾</button></div><div id="wdMusicDurationPopup" hidden><label for="wdTrimDurationSlider">Duration: <output id="wdDurationValue">15s</output></label><input id="wdTrimDurationSlider" type="range" min="10" max="30" step="5" value="15"><div class="wdRow"><button type="button" id="wdDurationApply">Apply duration</button></div></div><div class="wdRow"><button type="button" id="wdTrimPreview">▶ Preview</button><button type="button" id="wdTrimDone" class="wdPrimary">Done ✓</button></div>`;
 document.body.append(wrap);
 const pos=$('wdTrimPosition'), dSlider=$('wdTrimDurationSlider'), popup=$('wdMusicDurationPopup');
 const fmt=x=>{x=Math.floor(Math.max(0,+x||0));return Math.floor(x/60)+':'+String(x%60).padStart(2,'0')};
 for(let i=0;i<60;i++){const bar=document.createElement('i');bar.style.height=(16+Math.round(55*Math.abs(Math.sin(i*1.73)*Math.cos(i*.41))))+'px';$('wdTrimWave').append(bar)}
 function sync(){const dur=+duration.value||15;const max=Math.max(0,180-dur);pos.max=String(max);pos.value=String(Math.min(max,Math.max(0,+start.value||0)));$('wdTrimTime').textContent=`${fmt(pos.value)} – ${fmt(+pos.value+dur)}`;$('wdTrimDurationBtn').textContent=dur+'s ▾';dSlider.value=String(dur);$('wdDurationValue').textContent=dur+'s';const bars=[...$('wdTrimWave').children];const from=Math.floor((+pos.value/180)*bars.length);const to=Math.min(bars.length,from+Math.max(3,Math.round(dur/180*bars.length)));bars.forEach((b,i)=>b.style.background=i>=from&&i<to?'#f51e54':'#777480')}
 function openTrim(){if(!selected.textContent.includes('Selected:'))return;wrap.hidden=false;$('wdTrimTitle').textContent=selected.textContent;popup.hidden=true;sync()}
 // Capture before existing app handler: library Done opens editor trimmer instead.
 libraryDone.addEventListener('click',e=>{if(editor.classList.contains('hidden'))return;if(!selected.textContent.includes('Selected:'))return;e.preventDefault();e.stopImmediatePropagation();panel.classList.add('hidden');panel.style.display='';openTrim()},true);
 pos.addEventListener('input',()=>{start.value=pos.value;sync()});
 $('wdTrimDurationBtn').onclick=()=>{popup.hidden=!popup.hidden};
 dSlider.addEventListener('input',()=>{$('wdDurationValue').textContent=dSlider.value+'s'});
 $('wdDurationApply').onclick=()=>{duration.value=dSlider.value;duration.dispatchEvent(new Event('change',{bubbles:true}));popup.hidden=true;sync()};
 $('wdTrimPreview').onclick=()=>{const preview=$('wordiiMusicPreviewClip');if(preview)preview.click()};
 $('wdTrimBack').onclick=()=>{wrap.hidden=true;panel.classList.remove('hidden');panel.style.display='';};
 $('wdTrimDone').onclick=()=>{start.value=pos.value;wrap.hidden=true;panel.classList.add('hidden');panel.style.display='';const old=$('wordiiTrimInfo');if(old)old.textContent=`${fmt(pos.value)} – ${fmt(+pos.value+(+duration.value||15))}`;};
})();
