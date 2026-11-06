import {parseBuffer,KNOWN_OFFSETS} from './parser.js';
import {exportEventExcel} from './event-excel.js';

const SETTINGS_API='./api/settings';
const PAGE_SIZE=1000;
const $=s=>document.querySelector(s);
const appShell=$('#appShell'),accessGate=$('#accessGate'),accessMessage=$('#accessMessage');
const fileInput=$('#fileInput'),pickBtn=$('#pickBtn'),dropZone=$('#dropZone'),body=$('#resultBody');
const toolbar=$('#toolbar'),resultSection=$('#resultSection'),tableWrap=$('#tableWrap');
const searchBox=$('#searchBox'),doorFilter=$('#doorFilter'),addressFilter=$('#addressFilter'),codeFilter=$('#codeFilter');
const paginationInfo=$('#paginationInfo'),pageStat=$('#pageStat');
const firstPageBtn=$('#firstPageBtn'),prevPageBtn=$('#prevPageBtn'),nextPageBtn=$('#nextPageBtn'),lastPageBtn=$('#lastPageBtn');
const dialog=$('#detailDialog'),hexGrid=$('#hexGrid'),detailSummary=$('#detailSummary');
const doorSettingsDialog=$('#doorSettingsDialog'),userSettingsDialog=$('#userSettingsDialog');
let allRecords=[],allErrors=[],filesLoaded=0,loadSequence=0,duplicateCount=0;
let sortKey='eventTime',sortDir='asc',currentPage=1;
let doorSettings=[],userSettings=[],doorMap=new Map(),userMap=new Map();
const recordKeys=new Set();
const ipPage=$('#ipPage'),soyalPage=$('#soyalPage');
let accessGranted=false;

function showPage(){
  if(!accessGranted)return;
  const ip=location.hash==='#ip';
  soyalPage.hidden=ip;ipPage.hidden=!ip;
  document.body.classList.toggle('ip-active',ip);
  $('#soyalTab').setAttribute('aria-current',ip?'false':'page');
  $('#ipTab').setAttribute('aria-current',ip?'page':'false');
  if(ip&&!ipPage.getAttribute('src'))ipPage.src='pages/ip/';
}
window.addEventListener('hashchange',showPage);
$('#logoutBtn').addEventListener('click',async()=>{
  const changed=Boolean(ipPage.contentWindow?.hasUnsavedExclusions?.());
  if((filesLoaded||changed)&&!confirm('目前有尚未保存的資料，登出後將清除畫面內容。確定登出？'))return;
  const button=$('#logoutBtn');button.disabled=true;$('#headerMessage').textContent='';
  try{
    const response=await fetch('/sched/api/v1/auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!response.ok&&response.status!==401){let data={};try{data=await response.json();}catch{}throw new Error(data.error?.message||data.error||'登出失敗，請稍後再試');}
    window.indarAuth.goToLogin('/boss/');
  }catch(error){$('#headerMessage').textContent=error.message||'登出失敗，請稍後再試';}
  finally{button.disabled=false;}
});

pickBtn.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>loadFiles([...e.target.files]));
['dragenter','dragover'].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.add('drag')}));
['dragleave','drop'].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.remove('drag')}));
dropZone.addEventListener('drop',e=>loadFiles([...e.dataTransfer.files]));
searchBox.addEventListener('input',resetPageAndRender);
doorFilter.addEventListener('change',resetPageAndRender);
addressFilter.addEventListener('change',resetPageAndRender);
codeFilter.addEventListener('change',resetPageAndRender);
$('#closeDialog').addEventListener('click',()=>dialog.close());
$('#clearBtn').addEventListener('click',clearImportedData);
$('#exportBtn').addEventListener('click',exportExcel);
firstPageBtn.addEventListener('click',()=>goToPage(1));
prevPageBtn.addEventListener('click',()=>goToPage(currentPage-1));
nextPageBtn.addEventListener('click',()=>goToPage(currentPage+1));
lastPageBtn.addEventListener('click',()=>goToPage(Number(lastPageBtn.dataset.lastPage)||1));
document.querySelectorAll('th[data-sort]').forEach(th=>th.addEventListener('click',()=>changeSort(th.dataset.sort)));

$('#doorSettingsBtn').addEventListener('click',async()=>{await loadSettings();doorSettingsDialog.showModal();});
$('#userSettingsBtn').addEventListener('click',async()=>{await loadSettings();userSettingsDialog.showModal();});
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>document.getElementById(btn.dataset.close).close()));
$('#doorForm').addEventListener('submit',saveDoorSetting);$('#userForm').addEventListener('submit',saveUserSetting);
$('#doorCancelEdit').addEventListener('click',resetDoorForm);$('#userCancelEdit').addEventListener('click',resetUserForm);
$('#doorSettingsBody').addEventListener('click',handleDoorTableClick);$('#userSettingsBody').addEventListener('click',handleUserTableClick);
checkAccess().catch(err=>showAccessError(err));

async function checkAccess(){
  const response=await fetch('./api/access',{credentials:'same-origin',cache:'no-store'});
  let result={};try{result=await response.json();}catch{}
  if(response.ok){const user=result.user||{};$('#accountName').textContent=user.code?`${user.name||''}（${user.code}）`:user.name||'';accessGranted=true;showPage();accessGate.hidden=true;appShell.hidden=false;loadSettings().catch(error=>{if(error.status===401)showAccessError(error);else $('#headerMessage').textContent='SOYAL 設定讀取失敗，請重新整理或稍後再試。';});return;}
  const error=new Error(typeof result.error==='string'?result.error:(result.error?.message||'無法確認 BOSS 使用權限'));error.status=response.status;throw error;
}
function showAccessError(error){
  if(error.status===401){window.indarAuth.goToLogin('/boss/'+(location.hash==='#ip'?'#ip':''));return;}
  appShell.hidden=true;accessGate.hidden=false;
  accessMessage.textContent=error.status===403?'此帳號尚未開放使用 BOSS，請聯絡管理員。':error.status>=500?'BOSS 權限服務暫時無法使用，請稍後再試。':error.message;
  accessMessage.classList.add('error');
}

async function settingsRequest(type,method='GET',payload={}){
  const url=method==='GET'?`${SETTINGS_API}?type=${encodeURIComponent(type)}`:SETTINGS_API;
  const options={method,headers:{'Content-Type':'application/json'}};if(method!=='GET')options.body=JSON.stringify({type,...payload});
  const response=await fetch(url,options);let result={};try{result=await response.json();}catch{}
  if(!response.ok){const message=typeof result.error==='string'?result.error:(result.error?.message||`設定 API 錯誤 (${response.status})`);throw Object.assign(new Error(message),{status:response.status});}return result;
}

async function loadSettings(){
  const [doors,users]=await Promise.all([settingsRequest('doors'),settingsRequest('users')]);
  doorSettings=doors.data||[];userSettings=users.data||[];
  doorMap=new Map(doorSettings.map(d=>[String(d.door_no),d.door_name]));
  userMap=new Map(userSettings.map(u=>[String(u.user_address),u.user_name]));
  renderDoorSettings();renderUserSettings();if(allRecords.length){refreshFilters();render();}
}

function getDoorName(r){return doorMap.get(String(r.door))||'';}
function getUserName(r){return userMap.get(String(r.userAddress))||'';}
function formatUserCode(value){const n=Number(value);return Number.isFinite(n)?String(n).padStart(4,'0'):String(value??'');}
function rawRecordKey(r){let key='';for(const b of r.raw)key+=b.toString(16).padStart(2,'0');return key;}

async function loadFiles(files){
  const msgs=files.filter(f=>f.name.toLowerCase().endsWith('.msg'));if(!msgs.length)return;
  for(const file of msgs){
    const parsed=parseBuffer(await file.arrayBuffer(),file.name);allErrors.push(...parsed.errors);filesLoaded++;
    for(const r of parsed.records){
      const key=rawRecordKey(r);if(recordKeys.has(key)){duplicateCount++;continue;}
      recordKeys.add(key);r.loadOrder=++loadSequence;r.recordIndex=allRecords.length;allRecords.push(r);
    }
  }
  currentPage=1;refreshFilters();render();toolbar.hidden=false;resultSection.hidden=false;
  $('#fileStat').textContent=`檔案 ${filesLoaded} 個`;$('#recordStat').textContent=`紀錄 ${allRecords.length} 筆`;$('#duplicateStat').textContent=`重複略過 ${duplicateCount} 筆`;$('#errorStat').textContent=`格式警告 ${allErrors.length} 個`;fileInput.value='';
}

function clearImportedData(){
  if(!allRecords.length&&!filesLoaded)return;
  if(!confirm('確定要清空目前已匯入的所有資料嗎？'))return;
  allRecords=[];allErrors=[];filesLoaded=0;loadSequence=0;duplicateCount=0;recordKeys.clear();
  sortKey='eventTime';sortDir='asc';currentPage=1;searchBox.value='';
  doorFilter.innerHTML='<option value="">全部門號</option>';
  addressFilter.innerHTML='<option value="">全部使用者</option>';
  codeFilter.innerHTML='<option value="">全部事件</option>';
  body.innerHTML='';fileInput.value='';paginationInfo.textContent='';pageStat.textContent='';
  $('#fileStat').textContent='';$('#recordStat').textContent='';$('#duplicateStat').textContent='';$('#errorStat').textContent='';
  toolbar.hidden=true;resultSection.hidden=true;
  if(dialog.open)dialog.close();
}

function refreshFilters(){
  const selectedDoor=doorFilter.value,selectedAddress=addressFilter.value,selectedCode=codeFilter.value;
  const doors=[...new Set(allRecords.map(r=>r.door))].sort((a,b)=>a-b);
  doorFilter.innerHTML='<option value="">全部門號</option>'+doors.map(door=>{
    const name=doorMap.get(String(door))||'未設定';
    return `<option value="${door}">${door} | ${esc(name)}</option>`;
  }).join('');
  if(doors.map(String).includes(selectedDoor))doorFilter.value=selectedDoor;

  const addresses=[...new Set(allRecords.map(r=>r.userAddress))].sort((a,b)=>a-b);
  addressFilter.innerHTML='<option value="">全部使用者</option>'+addresses.map(a=>{const name=userMap.get(String(a));return `<option value="${a}">${formatUserCode(a)}${name?`｜${esc(name)}`:''}</option>`;}).join('');
  if(addresses.map(String).includes(selectedAddress))addressFilter.value=selectedAddress;
  const codes=[...new Map(allRecords.map(r=>[r.functionLabel,`${r.functionLabel}｜${r.functionName}`])).entries()].sort((a,b)=>Number(a[0].slice(1))-Number(b[0].slice(1)));
  codeFilter.innerHTML='<option value="">全部事件</option>'+codes.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');if(codes.some(([value])=>value===selectedCode))codeFilter.value=selectedCode;
}

function resetPageAndRender(){currentPage=1;render();}
function changeSort(key){if(sortKey===key)sortDir=sortDir==='asc'?'desc':'asc';else{sortKey=key;sortDir='asc';}currentPage=1;render();}
function compareValues(a,b,key){
  if(key==='doorName')return getDoorName(a).localeCompare(getDoorName(b),'zh-Hant',{numeric:true,sensitivity:'base'});
  if(key==='userName')return getUserName(a).localeCompare(getUserName(b),'zh-Hant',{numeric:true,sensitivity:'base'});
  const numericKeys=new Set(['loadOrder','node','door','userAddress','functionCode']);if(numericKeys.has(key))return Number(a[key]??0)-Number(b[key]??0);
  return String(a[key]??'').localeCompare(String(b[key]??''),'zh-Hant',{numeric:true,sensitivity:'base'});
}
function updateSortHeaders(){document.querySelectorAll('th[data-sort]').forEach(th=>{const active=th.dataset.sort===sortKey;th.setAttribute('aria-sort',active?(sortDir==='asc'?'ascending':'descending'):'none');const mark=th.querySelector('.sort-mark');if(mark)mark.textContent=active?(sortDir==='asc'?'▲':'▼'):'';});}

function getFiltered(){
  const q=searchBox.value.trim().toLowerCase();const filtered=allRecords.filter(r=>{
    if(doorFilter.value&&String(r.door)!==doorFilter.value)return false;if(addressFilter.value&&String(r.userAddress)!==addressFilter.value)return false;if(codeFilter.value&&r.functionLabel!==codeFilter.value)return false;
    const hay=[r.eventTime,r.door,getDoorName(r),r.userAddress,formatUserCode(r.userAddress),getUserName(r),r.functionLabel,r.functionName,r.functionNameEn,r.fileName].join(' ').toLowerCase();return !q||hay.includes(q);
  });
  return filtered.sort((a,b)=>{const primary=compareValues(a,b,sortKey);if(primary!==0)return sortDir==='asc'?primary:-primary;return a.loadOrder-b.loadOrder;});
}

function goToPage(page){
  const totalPages=Number(lastPageBtn.dataset.lastPage)||1;
  const next=Math.min(Math.max(1,page),totalPages);if(next===currentPage)return;
  currentPage=next;render();tableWrap.scrollTop=0;
}

function updatePagination(totalRecords,totalPages,startIndex,endIndex){
  pageStat.textContent=`第 ${currentPage} / ${totalPages} 頁`;
  paginationInfo.textContent=totalRecords?`目前顯示 ${startIndex+1}–${endIndex} 筆，共 ${totalRecords} 筆；每頁 ${PAGE_SIZE} 筆`:'沒有符合條件的資料';
  firstPageBtn.disabled=currentPage<=1;prevPageBtn.disabled=currentPage<=1;
  nextPageBtn.disabled=currentPage>=totalPages;lastPageBtn.disabled=currentPage>=totalPages;
  lastPageBtn.dataset.lastPage=String(totalPages);
}

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function render(){
  updateSortHeaders();
  const records=getFiltered();const totalPages=Math.max(1,Math.ceil(records.length/PAGE_SIZE));
  if(currentPage>totalPages)currentPage=totalPages;
  const start=(currentPage-1)*PAGE_SIZE;const end=Math.min(start+PAGE_SIZE,records.length);const pageRecords=records.slice(start,end);
  body.innerHTML=pageRecords.map((r,i)=>`<tr><td>${start+i+1}</td><td>${esc(r.eventTime)}</td><td>${r.door}</td><td>${esc(getDoorName(r))}</td><td>${formatUserCode(r.userAddress)}</td><td>${esc(getUserName(r))}</td><td><code>${r.functionLabel}</code></td><td>${esc(r.functionName)}</td><td>${esc(r.fileName)}</td><td><button data-key="${r.recordIndex}">HEX</button></td></tr>`).join('');
  body.querySelectorAll('button[data-key]').forEach(btn=>btn.addEventListener('click',()=>showDetail(allRecords[Number(btn.dataset.key)])));
  updatePagination(records.length,totalPages,start,end);
}

function showDetail(r){
  detailSummary.innerHTML=[['事件時間',r.eventTime],['Node',r.node],['門號',r.door],['門名稱',getDoorName(r)||'—'],['使用者代碼',formatUserCode(r.userAddress)],['使用者名稱',getUserName(r)||'—'],['事件碼',r.functionLabel],['事件名稱',r.functionName],['官方英文定義',r.functionNameEn||'—'],['接收時間',r.recordedTime],['Controller Node',r.controllerNode],['Message Type',r.messageType],['來源檔',r.fileName]].map(([k,v])=>`<div><small>${k}</small><br><strong>${esc(v)}</strong></div>`).join('');
  hexGrid.innerHTML=[...r.raw].map((v,i)=>`<div class="hex-byte ${KNOWN_OFFSETS[i]?'known':''}"><small>+${String(i).padStart(2,'0')} ${esc(KNOWN_OFFSETS[i]||'未確認')}</small><strong>${v.toString(16).toUpperCase().padStart(2,'0')}</strong><small>${v}</small></div>`).join('');dialog.showModal();
}

function exportExcel(){
  const records=getFiltered();const headers=['#','事件時間','門號','門名稱','使用者代碼','使用者名稱','事件碼','事件名稱','檔案'];
  const rows=records.map((r,i)=>[i+1,r.eventTime,r.door,getDoorName(r),formatUserCode(r.userAddress),getUserName(r),r.functionLabel,r.functionName,r.fileName]);
  exportEventExcel(headers,rows);
}

function setMessage(id,text,isError=false){const el=$(id);el.textContent=text;el.classList.toggle('error',isError);}
/* Exact pencil/trashcan SVG paths from the shared shift schedule controls. */
const settingsIconPaths = { edit: '<path d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>' };
function settingsActionButton(kind, id) {
  const label = kind === 'edit' ? '修改' : '刪除';
  const className = 'boss-action-icon' + (kind === 'delete' ? ' boss-action-delete' : '');
  return `<button type="button" class="${className}" data-action="${kind}" data-id="${esc(id)}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${settingsIconPaths[kind]}</svg></button>`;
}
function renderDoorSettings(){const tbody=$('#doorSettingsBody');tbody.innerHTML=doorSettings.map(d=>`<tr><td>${d.door_no}</td><td>${esc(d.door_name)}</td><td>${settingsActionButton('edit', d.id)} ${settingsActionButton('delete', d.id)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty-cell">尚無門號設定</td></tr>';}
function renderUserSettings(){const tbody=$('#userSettingsBody');tbody.innerHTML=userSettings.map(u=>`<tr><td>${formatUserCode(u.user_address)}</td><td>${esc(u.user_name)}</td><td>${settingsActionButton('edit', u.id)} ${settingsActionButton('delete', u.id)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty-cell">尚無使用者設定</td></tr>';}

async function saveDoorSetting(e){e.preventDefault();const id=Number($('#doorEditId').value)||null;const data={door_no:Number($('#doorNo').value),door_name:$('#doorName').value.trim()};try{setMessage('#doorMessage','儲存中…');await settingsRequest('doors',id?'PUT':'POST',id?{id,data}:{data});resetDoorForm();await loadSettings();setMessage('#doorMessage','已儲存');}catch(err){setMessage('#doorMessage',err.message,true);}}
async function saveUserSetting(e){e.preventDefault();const id=Number($('#userEditId').value)||null;const data={user_address:Number($('#userAddressInput').value),user_name:$('#userName').value.trim()};try{setMessage('#userMessage','儲存中…');await settingsRequest('users',id?'PUT':'POST',id?{id,data}:{data});resetUserForm();await loadSettings();setMessage('#userMessage','已儲存');}catch(err){setMessage('#userMessage',err.message,true);}}
function handleDoorTableClick(e){const btn=e.target.closest('button[data-action]');if(!btn)return;const row=doorSettings.find(d=>Number(d.id)===Number(btn.dataset.id));if(!row)return;if(btn.dataset.action==='edit'){$('#doorEditId').value=row.id;$('#doorNo').value=row.door_no;$('#doorName').value=row.door_name;$('#doorCancelEdit').hidden=false;$('#doorName').focus();return;}if(btn.dataset.action==='delete')deleteDoorSetting(row);}
function handleUserTableClick(e){const btn=e.target.closest('button[data-action]');if(!btn)return;const row=userSettings.find(u=>Number(u.id)===Number(btn.dataset.id));if(!row)return;if(btn.dataset.action==='edit'){$('#userEditId').value=row.id;$('#userAddressInput').value=row.user_address;$('#userName').value=row.user_name;$('#userCancelEdit').hidden=false;$('#userName').focus();return;}if(btn.dataset.action==='delete')deleteUserSetting(row);}
async function deleteDoorSetting(row){if(!confirm(`確定刪除門號 ${row.door_no}「${row.door_name}」？`))return;try{await settingsRequest('doors','DELETE',{id:row.id});await loadSettings();setMessage('#doorMessage','已刪除');}catch(err){setMessage('#doorMessage',err.message,true);}}
async function deleteUserSetting(row){if(!confirm(`確定刪除使用者代碼 ${formatUserCode(row.user_address)}「${row.user_name}」？`))return;try{await settingsRequest('users','DELETE',{id:row.id});await loadSettings();setMessage('#userMessage','已刪除');}catch(err){setMessage('#userMessage',err.message,true);}}
function resetDoorForm(){$('#doorEditId').value='';$('#doorForm').reset();$('#doorCancelEdit').hidden=true;}
function resetUserForm(){$('#userEditId').value='';$('#userForm').reset();$('#userCancelEdit').hidden=true;}
