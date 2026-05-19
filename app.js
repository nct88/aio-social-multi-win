// AIO Social Pro — app.js (extracted + new features)
let currentPlat = 'messenger', currentProfileId = null, profiles = {}, URLS = {}, webviewMap = {};
const PLAT_NAMES = { metabiz:'Meta Business', messenger:'Messenger', zalo:'Zalo', telegram:'Telegram', whatsapp:'WhatsApp', discord:'Discord', x:'X', instagram:'Instagram', tiktok:'TikTok', threads:'Threads', wechat:'WeChat', lotus:'Lotus' };
const ICONS = {};

// === Utilities ===
function escapeHtml(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2500);}
function showLoading(msg){var el=document.getElementById('loading-overlay');el.querySelector('.loading-text').textContent=msg||'Đang tải...';el.classList.remove('hidden');}
function hideLoading(){document.getElementById('loading-overlay').classList.add('hidden');}

// === Platform Nav Scroll ===
var navOffset=0;
function scrollPlatNav(dir){var nav=document.getElementById('platform-nav'),inner=document.getElementById('platform-nav-inner'),max=Math.max(0,inner.scrollHeight-nav.clientHeight);navOffset=Math.max(0,Math.min(navOffset+dir*180,max));inner.style.transform='translateY(-'+navOffset+'px)';document.getElementById('nav-up').classList.toggle('hidden',navOffset<=0);document.getElementById('nav-down').classList.toggle('hidden',navOffset>=max);}

// === Notification Badge ===
var notifCounts={};
function updateBadge(platform){var el=document.getElementById('plat-'+platform);if(!el)return;var badge=el.querySelector('.notif-badge'),total=0;if(notifCounts[platform])Object.values(notifCounts[platform]).forEach(n=>{total+=n;});if(total>0){if(!badge){badge=document.createElement('span');badge.className='notif-badge';el.appendChild(badge);}badge.textContent=total>99?'99+':total;badge.classList.remove('hidden');}else if(badge)badge.classList.add('hidden');}
function parseNotifCount(title){var m=title.match(/\((\d+)\)/);return m?parseInt(m[1],10):0;}

// === Webview Management ===
function destroyOtherPlatformWebviews(keepPlatform){Object.keys(webviewMap).forEach(k=>{if(k.indexOf(keepPlatform+'_')!==0){webviewMap[k].remove();delete webviewMap[k];}});}

function getOrCreateWebview(platform,profileId,profileUuid){
    const key=platform+'_'+profileId;
    if(webviewMap[key]){hideLoading();return webviewMap[key];}
    destroyOtherPlatformWebviews(platform);
    showLoading('Đang tải '+(PLAT_NAMES[platform]||platform)+'...');
    const container=document.getElementById('webview-container'),wv=document.createElement('webview');
    wv.setAttribute('src',URLS[platform]);
    wv.setAttribute('partition','persist:'+platform+'_'+profileUuid);
    wv.setAttribute('useragent','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    wv.setAttribute('allowpopups','');wv.setAttribute('id','wv-'+key);
    wv._platform=platform;wv._profileId=profileId;wv.style.display='none';wv._crashCount=0;wv._stableTimer=null;
    wv.addEventListener('page-title-updated',e=>{if(!notifCounts[platform])notifCounts[platform]={};notifCounts[platform][profileId]=parseNotifCount(e.title);updateBadge(platform);});
    wv.addEventListener('dom-ready',()=>{hideLoading();window.api.syncThemeToWebview(wv.getWebContentsId(),platform);clearTimeout(wv._stableTimer);wv._stableTimer=setTimeout(()=>{wv._crashCount=0;},30000);});
    wv.addEventListener('did-fail-load',(e)=>{hideLoading();if(e.errorCode!==-3&&wv._crashCount<2){wv._crashCount++;setTimeout(()=>wv.reload(),1500);}});
    // ServiceWorker error recovery — tự reload khi gặp InvalidStateError
    wv._swRetry=0;
    wv.addEventListener('console-message',(e)=>{
        if(e.message&&e.message.indexOf('ServiceWorker')>-1&&e.message.indexOf('InvalidState')>-1&&wv._swRetry<2){
            wv._swRetry++;console.log('[SW Recovery] Retrying '+platform+'...');
            setTimeout(()=>wv.reload(),2000);
        }
    });
    wv.addEventListener('render-process-gone',()=>{clearTimeout(wv._stableTimer);wv._crashCount++;if(wv._crashCount<=3){showLoading('Đang khôi phục...');setTimeout(()=>wv.reload(),2000*wv._crashCount);}else hideLoading();});
    wv.addEventListener('crashed',()=>{clearTimeout(wv._stableTimer);wv._crashCount++;if(wv._crashCount<=3){showLoading('Đang khôi phục...');setTimeout(()=>wv.reload(),2000*wv._crashCount);}else hideLoading();});
    container.appendChild(wv);webviewMap[key]=wv;return wv;
}
function showWebview(key){Object.values(webviewMap).forEach(wv=>{wv.style.display='none';wv.classList.remove('active');});if(webviewMap[key]){webviewMap[key].style.display='inline-flex';webviewMap[key].classList.add('active');}}
function getActiveWebview(){if(!currentProfileId)return null;return webviewMap[currentPlat+'_'+currentProfileId]||null;}

// === Init ===
async function init(){
    profiles=await window.api.getProfiles();URLS=await window.api.getUrls();
    Object.keys(PLAT_NAMES).forEach(p=>{ICONS[p]=document.getElementById('plat-'+p)?document.getElementById('plat-'+p).innerHTML:'';if(!profiles[p])profiles[p]=[];});
    var found=false,allPlats=Object.keys(PLAT_NAMES);
    for(var i=0;i<allPlats.length;i++){if(profiles[allPlats[i]]&&profiles[allPlats[i]].length>0){selectPlatform(allPlats[i],true);found=true;break;}}
    if(!found)selectPlatform('messenger',false);
    document.getElementById('nav-up').classList.add('hidden');

    // HWID
    var hwid=await window.api.getHWID();
    document.getElementById('hwid-value').textContent=hwid;

    // PIN Lock check
    var hasPin=await window.api.hasPin();
    if(hasPin){
        document.getElementById('pin-overlay').classList.remove('hidden');
        var alMin=await window.api.getAutoLock();
        if(alMin>0){_autoLockMs=alMin*60*1000;}
    }

    // Donate check — chỉ hiện popup nếu chưa donate
    var donated=await window.api.checkDonate();
    if(!donated){
        document.getElementById('donate-overlay').style.display='flex';
    }
}

// === HWID ===
async function copyHWID(){
    await window.api.copyHWID();
    toast('📋 Đã sao chép mã hỗ trợ!\nHãy gửi mã này qua Telegram để tôi hỗ trợ kiểm tra lỗi cho bạn');
    window.api.openTelegram();
}

// === Donate ===
function openDonatePage(){
    document.getElementById('donate-overlay').style.display='none';
    window.api.openDonate();
}
function closeDonate(){
    document.getElementById('donate-overlay').style.display='none';
}

// === Auto Update UI ===
if(window.api.onUpdateAvailable){
    window.api.onUpdateAvailable((ver)=>{
        toast('🔄 Phiên bản mới '+ver+' đang được tải...');
    });
}
if(window.api.onUpdateDownloaded){
    window.api.onUpdateDownloaded((ver)=>{
        var t=document.getElementById('toast');
        t.innerHTML='✅ Đã tải xong v'+ver+' — <a href="#" onclick="window.api.installUpdate();return false;" style="color:#fb923c;text-decoration:underline;">Khởi động lại</a>';
        t.classList.remove('hidden');
    });
}

// === Platform & Profile Selection ===
function selectPlatform(plat,autoSwitch){
    currentPlat=plat;document.getElementById('plat-title').innerText=PLAT_NAMES[plat];
    document.querySelectorAll('.plat-item').forEach(el=>el.classList.remove('active'));
    document.getElementById('plat-'+plat).classList.add('active');
    renderProfiles();
    if(autoSwitch&&profiles[plat]&&profiles[plat].length>0)switchProfile(plat,profiles[plat][0].id);
    else{Object.values(webviewMap).forEach(wv=>{wv.style.display='none';wv.classList.remove('active');});window.api.hideZaloWindows();currentProfileId=null;}
}

// Color palette for letter avatars
var AVATAR_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1'];
function getAvatarColor(name){ var sum=0; for(var i=0;i<name.length;i++) sum+=name.charCodeAt(i); return AVATAR_COLORS[sum % AVATAR_COLORS.length]; }
function getInitial(name){ if(!name) return '?'; return name.charAt(0).toUpperCase(); }

function renderProfiles(){
    var list=document.getElementById('profile-list');list.innerHTML='';
    (profiles[currentPlat]||[]).forEach((p,idx)=>{
        var item=document.createElement('div');
        item.className='profile-item'+(currentProfileId===p.id?' active':'');
        item.id='btn-prof-'+p.id;
        item.setAttribute('draggable','true');
        item.setAttribute('data-profile-id',p.id);
        item.setAttribute('data-index',idx);
        var initial=getInitial(p.name);
        var bgColor=getAvatarColor(p.name);
        var menuId='menu-'+p.id;
        item.innerHTML=
            '<div class="prof-avatar" style="background:'+bgColor+';color:#fff;">'+initial+'</div>'
            +'<div class="prof-right">'
                +'<div class="prof-name">'+escapeHtml(p.name)+'</div>'
                +(p.phoneOrNick?'<div class="prof-detail">'+escapeHtml(p.phoneOrNick)+(p.proxy&&p.proxy.host?' 🔒':'')+'</div>':'')
                +'<div class="prof-options-wrap">'
                    +'<button class="prof-options-btn" onclick="toggleProfileMenu(event,\''+menuId+'\')">'
                        +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
                        +'<span>Tùy chọn</span>'
                    +'</button>'
                    +'<div class="prof-dropdown hidden" id="'+menuId+'">'
                        +'<div class="prof-menu-item" onclick="openProxyModal(event,\''+currentPlat+'\',\''+p.id+'\')">'
                            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
                            +'<span>Chỉnh proxy</span>'
                        +'</div>'
                        +'<div class="prof-menu-item" onclick="exportSession(event,\''+currentPlat+'\',\''+p.id+'\')">'
                            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
                            +'<span>Xuất dữ liệu</span>'
                        +'</div>'
                        +'<div class="prof-menu-sep"></div>'
                        +'<div class="prof-menu-item" onclick="editProfileInfo(event,\''+currentPlat+'\',\''+p.id+'\')">'
                            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>'
                            +'<span>Sửa thông tin</span>'
                        +'</div>'
                        +'<div class="prof-menu-item prof-menu-warn" onclick="logoutProfile(event,\''+currentPlat+'\',\''+p.id+'\')">'
                            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
                            +'<span>Đăng xuất</span>'
                        +'</div>'
                        +'<div class="prof-menu-item prof-menu-danger" onclick="deleteProfileInfo(event,\''+currentPlat+'\',\''+p.id+'\')">'
                            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
                            +'<span>Xóa tài khoản</span>'
                        +'</div>'
                    +'</div>'
                +'</div>'
            +'</div>';
        item.onclick=function(e){if(!e.target.closest('.prof-options-wrap'))switchProfile(currentPlat,p.id);};
        // Drag & Drop
        item.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',p.id);item.classList.add('dragging');});
        item.addEventListener('dragend',function(){item.classList.remove('dragging');});
        item.addEventListener('dragover',function(e){e.preventDefault();item.classList.add('drag-over');});
        item.addEventListener('dragleave',function(){item.classList.remove('drag-over');});
        item.addEventListener('drop',async function(e){
            e.preventDefault();item.classList.remove('drag-over');
            var draggedId=e.dataTransfer.getData('text/plain');if(draggedId===p.id)return;
            var ids=(profiles[currentPlat]||[]).map(x=>x.id);
            var fromIdx=ids.indexOf(draggedId),toIdx=ids.indexOf(p.id);
            if(fromIdx<0||toIdx<0)return;
            ids.splice(fromIdx,1);ids.splice(toIdx,0,draggedId);
            profiles=await window.api.reorderProfiles(currentPlat,ids);
            renderProfiles();toast('Đã sắp xếp lại!');
        });
        list.appendChild(item);
    });
}

// Toggle dropdown menu
function toggleProfileMenu(e,menuId){
    e.stopPropagation();
    // Close all other open menus
    document.querySelectorAll('.prof-dropdown').forEach(m=>{if(m.id!==menuId)m.classList.add('hidden');});
    var menu=document.getElementById(menuId);
    menu.classList.toggle('hidden');
}
// Close menus on outside click
document.addEventListener('click',function(){document.querySelectorAll('.prof-dropdown').forEach(m=>m.classList.add('hidden'));});

function switchProfile(plat,id){
    currentProfileId=id;currentPlat=plat;
    document.querySelectorAll('.profile-item').forEach(el=>el.classList.remove('active'));
    var btn=document.getElementById('btn-prof-'+id);if(btn)btn.classList.add('active');
    var profile=profiles[plat].find(p=>p.id===id);if(!profile)return;
    if(plat==='zalo'){Object.values(webviewMap).forEach(wv=>{wv.style.display='none';wv.classList.remove('active');});window.api.createZaloWindow(id,profile.uuid);window.api.showZaloWindow(id);}
    else{window.api.hideZaloWindows();getOrCreateWebview(plat,id,profile.uuid);showWebview(plat+'_'+id);}
    window.api.setTitle('AIO Social Pro - ['+(PLAT_NAMES[plat]||plat).toUpperCase()+']');
}

// === Modals ===
var modalMode='add',modalTargetId=null;
function openModal(mode,platform,id){
    var wv=getActiveWebview();if(wv)wv.style.display='none';
    modalMode=mode;modalTargetId=id||null;
    var title=document.getElementById('modal-title'),n=document.getElementById('modal-name'),d=document.getElementById('modal-detail');
    if(mode==='add'){title.innerText='Thêm tài khoản '+PLAT_NAMES[platform];n.value='';d.value='';}
    else{title.innerText='Chỉnh sửa thông tin';var p=profiles[platform].find(x=>x.id===id);if(p){n.value=p.name;d.value=p.phoneOrNick||'';}}
    document.getElementById('profile-modal').style.display='flex';n.focus();
}
function closeModal(){document.getElementById('profile-modal').style.display='none';var wv=getActiveWebview();if(wv){wv.style.display='inline-flex';wv.classList.add('active');}}
async function saveModal(){
    var name=document.getElementById('modal-name').value.trim(),detail=document.getElementById('modal-detail').value.trim();
    if(!name){alert('Vui lòng nhập tên hiển thị!');return;}
    if(modalMode==='add'){profiles=await window.api.addProfile(currentPlat,name,detail);renderProfiles();var newId=profiles[currentPlat][profiles[currentPlat].length-1].id;switchProfile(currentPlat,newId);}
    else{profiles=await window.api.editProfile(currentPlat,modalTargetId,name,detail);renderProfiles();}
    closeModal();
}
function addNewProfile(){openModal('add',currentPlat);}
function editProfileInfo(e,platform,id){e.stopPropagation();openModal('edit',platform,id);}
async function deleteProfileInfo(e,platform,id){
    e.stopPropagation();if(!confirm('Bạn có chắc muốn xóa tài khoản này?'))return;
    var key=platform+'_'+id;if(webviewMap[key]){webviewMap[key].remove();delete webviewMap[key];}
    if(platform==='zalo')window.api.hideZaloWindows();
    profiles=await window.api.deleteProfile(platform,id);renderProfiles();
    if(currentPlat===platform&&currentProfileId===id){if(profiles[platform].length>0)switchProfile(platform,profiles[platform][0].id);else{currentProfileId=null;window.api.hideZaloWindows();}}
}
async function logoutProfile(e,platform,id){
    e.stopPropagation();if(!confirm('Đăng xuất tài khoản này? Session sẽ bị xóa.'))return;
    var key=platform+'_'+id;if(webviewMap[key]){webviewMap[key].remove();delete webviewMap[key];}
    if(platform==='zalo')window.api.hideZaloWindows();
    await window.api.logoutProfile(platform,id);
    if(currentPlat===platform&&currentProfileId===id)switchProfile(platform,id);
    toast('Đã đăng xuất thành công!');
}

// === Export / Import Session ===
async function exportSession(e,platform,id){e.stopPropagation();var r=await window.api.exportSession(platform,id);if(r)toast('✅ Xuất dữ liệu thành công!');else toast('❌ Xuất dữ liệu thất bại');}
async function importSession(){var r=await window.api.importSession(currentPlat);if(r&&r!==false){profiles=typeof r==='object'?r:await window.api.getProfiles();renderProfiles();toast('✅ Nhập dữ liệu thành công!');}else toast('❌ Nhập dữ liệu thất bại hoặc đã hủy');}

// === Proxy Modal ===
async function openProxyModal(e,platform,id){
    e.stopPropagation();
    var proxy=await window.api.getProxy(platform,id);
    document.getElementById('proxy-platform').value=platform;
    document.getElementById('proxy-profile-id').value=id;
    document.getElementById('proxy-type').value=(proxy&&proxy.type)||'http';
    document.getElementById('proxy-host').value=(proxy&&proxy.host)||'';
    document.getElementById('proxy-port').value=(proxy&&proxy.port)||'';
    document.getElementById('proxy-modal').style.display='flex';
}
function closeProxyModal(){document.getElementById('proxy-modal').style.display='none';}
async function saveProxy(){
    toast('Tính năng Proxy đang phát triển và sẽ sớm ra mắt!');
}
async function clearProxy(){
    toast('Tính năng Proxy đang phát triển và sẽ sớm ra mắt!');
}

// === Settings Panel ===
async function openSettings(){
    var autoStart=await window.api.getAutoStart();
    document.getElementById('chk-autostart').checked=autoStart;
    var hasPin=await window.api.hasPin();
    document.getElementById('chk-pin').checked=hasPin;
    // Auto-lock row: chỉ hiện khi PIN đã bật
    var alRow=document.getElementById('autolock-row');
    if(hasPin){
        alRow.style.display='block';
        var alMin=await window.api.getAutoLock();
        document.getElementById('sel-autolock').value=String(alMin);
    } else {
        alRow.style.display='none';
    }
    document.getElementById('settings-modal').style.display='flex';
}
function closeSettings(){document.getElementById('settings-modal').style.display='none';}
async function toggleAutoStart(){var v=document.getElementById('chk-autostart').checked;await window.api.setAutoStart(v);toast(v?'✅ Khởi động cùng Windows':'Đã tắt khởi động cùng Windows');}
async function togglePin(){
    var v=document.getElementById('chk-pin').checked;
    if(v){
        document.getElementById('pin-setup-input').value='';
        document.getElementById('pin-setup-error').textContent='';
        document.getElementById('pin-setup-modal').style.display='flex';
        document.getElementById('pin-setup-input').focus();
    } else {
        await window.api.setPin(null);
        await window.api.setAutoLock(0);
        document.getElementById('autolock-row').style.display='none';
        stopAutoLockTimer();
        toast('Đã tắt mã PIN');
    }
}
function cancelPinSetup(){
    document.getElementById('pin-setup-modal').style.display='none';
    document.getElementById('chk-pin').checked=false;
}
async function confirmPinSetup(){
    var pin=document.getElementById('pin-setup-input').value;
    if(!pin||pin.length<4){
        document.getElementById('pin-setup-error').textContent='PIN phải từ 4 ký tự trở lên';
        return;
    }
    await window.api.setPin(pin);
    document.getElementById('pin-setup-modal').style.display='none';
    document.getElementById('autolock-row').style.display='block';
    toast('✅ Đã cài mã PIN');
}

// === Auto-lock timer ===
var _autoLockTimer=null, _autoLockMs=0;
async function setAutoLockTime(){
    var mins=parseInt(document.getElementById('sel-autolock').value)||0;
    await window.api.setAutoLock(mins);
    _autoLockMs=mins*60*1000;
    resetAutoLockTimer();
    toast(mins>0?'⏱️ Tự khóa sau '+mins+' phút':'Đã tắt tự khóa');
}
function resetAutoLockTimer(){
    clearTimeout(_autoLockTimer);
    if(_autoLockMs>0){
        _autoLockTimer=setTimeout(()=>{
            // Chỉ khóa nếu overlay chưa hiện
            if(document.getElementById('pin-overlay').classList.contains('hidden')){
                document.getElementById('pin-overlay').classList.remove('hidden');
                document.getElementById('pin-input').focus();
            }
        },_autoLockMs);
    }
}
function stopAutoLockTimer(){clearTimeout(_autoLockTimer);_autoLockMs=0;}

// Activity tracking — reset timer khi có hoạt động
['mousemove','mousedown','keydown','scroll','touchstart'].forEach(evt=>{
    document.addEventListener(evt,()=>{if(_autoLockMs>0)resetAutoLockTimer();},{passive:true});
});

// === PIN Lock ===
async function verifyPinInput(){
    var input=document.getElementById('pin-input'),pin=input.value;
    if(!pin)return;
    var ok=await window.api.verifyPin(pin);
    if(ok){
        document.getElementById('pin-overlay').classList.add('hidden');
        input.value='';document.getElementById('pin-error').textContent='';
        resetAutoLockTimer(); // Restart auto-lock countdown
    }
    else{input.value='';input.classList.add('shake');setTimeout(()=>input.classList.remove('shake'),500);document.getElementById('pin-error').textContent='Sai mã PIN!';}
}

// === Keyboard Shortcuts ===
function openShortcuts(){document.getElementById('shortcuts-modal').style.display='flex';}
function closeShortcuts(){document.getElementById('shortcuts-modal').style.display='none';}

// === Keyboard Shortcuts Handler ===
var platKeys=Object.keys(PLAT_NAMES);
document.addEventListener('keydown',function(e){
    if(e.ctrlKey&&e.key>='1'&&e.key<='9'){e.preventDefault();var idx=parseInt(e.key)-1;if(idx<platKeys.length)selectPlatform(platKeys[idx],true);}
    if(e.ctrlKey&&e.key==='0'){e.preventDefault();if(platKeys.length>9)selectPlatform(platKeys[9],true);}
});

// === Theme, Navigation, Zoom, Mute ===
(async function(){
    var saved=await window.api.getDarkMode(),isDark=saved==='dark';
    document.body.classList.toggle('dark-mode',isDark);document.body.classList.toggle('light-mode',!isDark);
    var sunIcon='<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    var moonIcon='<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>';
    document.getElementById('theme-icon').innerHTML=isDark?sunIcon:moonIcon;
    document.getElementById('btn-theme').addEventListener('click',async function(){
        var r=await window.api.toggleDarkMode();document.body.classList.toggle('dark-mode',r==='dark');document.body.classList.toggle('light-mode',r!=='dark');
        document.getElementById('theme-icon').innerHTML=r==='dark'?sunIcon:moonIcon;
        Object.values(webviewMap).forEach(wv=>{try{window.api.syncThemeToWebview(wv.getWebContentsId(),wv._platform);}catch(e){}});
    });
    document.getElementById('btn-home').addEventListener('click',()=>{var wv=getActiveWebview();if(wv&&URLS[currentPlat])wv.loadURL(URLS[currentPlat]);});
    document.getElementById('btn-back').addEventListener('click',()=>{var wv=getActiveWebview();if(wv&&wv.canGoBack())wv.goBack();});
    document.getElementById('btn-forward').addEventListener('click',()=>{var wv=getActiveWebview();if(wv&&wv.canGoForward())wv.goForward();});
    document.getElementById('btn-reload').addEventListener('click',()=>{var wv=getActiveWebview();if(wv)wv.reload();});
    var muted=false;
    document.getElementById('btn-mute').addEventListener('click',function(){
        muted=!muted;var wv=getActiveWebview();if(wv)wv.setAudioMuted(muted);
        this.classList.toggle('active-tool',muted);
        this.querySelector('svg').innerHTML=muted?'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>':'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
        this.setAttribute('data-tip',muted?'Bật tiếng':'Tắt tiếng');
    });
    var zl=100;
    document.getElementById('btn-zoom-in').addEventListener('click',()=>{zl=Math.min(zl+10,200);var wv=getActiveWebview();if(wv)wv.setZoomFactor(zl/100);toast('Zoom: '+zl+'%');});
    document.getElementById('btn-zoom-out').addEventListener('click',()=>{zl=Math.max(zl-10,50);var wv=getActiveWebview();if(wv)wv.setZoomFactor(zl/100);toast('Zoom: '+zl+'%');});
    // Settings button
    document.getElementById('btn-settings').addEventListener('click',openSettings);
    // Shortcuts button
    document.getElementById('btn-shortcuts').addEventListener('click',openShortcuts);
})();

// === Download Manager ===
var downloads={};
function renderDownloads(){
    var body=document.getElementById('dl-body');body.innerHTML='';
    var keys=Object.keys(downloads);
    if(!keys.length){body.innerHTML='<div style="text-align:center;opacity:0.5;padding:20px;font-size:0.8rem;">Không có file nào</div>';return;}
    keys.reverse().forEach(id=>{
        var dl=downloads[id],pct=dl.total>0?Math.round((dl.received/dl.total)*100):0;
        var status=dl.state==='completed'?'✅ Hoàn thành':dl.state==='cancelled'?'❌ Đã hủy':pct+'%';
        var size=dl.total>0?(dl.total/1048576).toFixed(1)+' MB':'';
        var item=document.createElement('div');item.className='download-item';
        item.innerHTML='<div class="dl-name">'+escapeHtml(dl.filename)+'</div>'+(dl.state==='progressing'?'<div class="dl-progress"><div class="dl-progress-bar" style="width:'+pct+'%"></div></div>':'')+'<div class="dl-status"><span>'+status+'</span><span>'+size+'</span></div>';
        body.appendChild(item);
    });
}
if(window.api.onDownloadProgress){window.api.onDownloadProgress(data=>{downloads[data.id]=data;renderDownloads();document.getElementById('download-panel').classList.remove('hidden');});}

// === Backup / Restore ===
async function backupProfiles(){var r=await window.api.backupProfiles();toast(r?'✅ Đã backup: '+r:'❌ Backup thất bại');}
async function restoreProfiles(){var r=await window.api.restoreProfiles();if(r){toast('✅ Đã restore! Đang tải lại...');setTimeout(()=>location.reload(),1500);}else toast('❌ Restore thất bại hoặc đã hủy');}

// === Platform nav wheel ===
document.getElementById('platform-nav').addEventListener('wheel',function(e){e.preventDefault();scrollPlatNav(e.deltaY>0?1:-1);},{passive:false});

// === PIN Enter key ===
document.addEventListener('DOMContentLoaded',()=>{
    var pinInput=document.getElementById('pin-input');
    if(pinInput)pinInput.addEventListener('keydown',e=>{if(e.key==='Enter')verifyPinInput();});
    var pinSetupInput=document.getElementById('pin-setup-input');
    if(pinSetupInput)pinSetupInput.addEventListener('keydown',e=>{if(e.key==='Enter')confirmPinSetup();if(e.key==='Escape')cancelPinSetup();});
});

// Boot
init();
