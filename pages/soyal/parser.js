export const RECORD_SIZE = 100;

export const KNOWN_OFFSETS = {
  0:'紀錄長度',1:'事件碼 (Function Code)',2:'來源站號 (Source Node)',3:'秒',4:'分',5:'時',6:'星期',7:'日',8:'月',9:'年',
  10:'訊息來源 (Message Source)',11:'使用者位址高位',12:'使用者位址低位',13:'子事件碼 (Sub Code)',14:'子功能 (Sub Function)',15:'擴充碼 (Extension Code)',16:'使用者層級',
  19:'門號',31:'XOR Checksum',32:'SUM Checksum',
  79:'接收秒',80:'接收分',81:'接收時',82:'接收星期',83:'接收日',84:'接收月',85:'接收年',
  96:'控制器站號',98:'訊息類型'
};

// 事件碼依 SOYAL 公開 Function code define table。
// code 為十進位事件編號；例如原始 byte 0x27 = 十進位 39，因此 701Client 顯示為 M39。
export const FUNCTION_CODES = {
  0:{zh:'場區碼錯誤',en:'Site code error'},
  1:{zh:'使用者 PIN 無效',en:'Invalid user PIN'},
  2:{zh:'錯誤次數超限，鍵盤鎖定',en:'Keypad Locked by error access over limits times'},
  3:{zh:'無效卡',en:'Invalid card'},
  4:{zh:'時段錯誤',en:'Time Zone error'},
  5:{zh:'門組錯誤',en:'Door Group error'},
  6:{zh:'已過有效期限',en:'Expiry Date'},
  7:{zh:'通行次數超限',en:'Over access times'},
  8:{zh:'PIN 碼錯誤',en:'PIN Code error'},
  9:{zh:'脅迫按鈕觸發',en:'Press duress PB'},
  10:{zh:'卡片＋密碼通行',en:'Access by Card and PIN'},
  11:{zh:'正常刷卡通行',en:'Normal Access by tag'},
  12:{zh:'強制控制器繼電器開啟',en:'Force Controller Relay ON'},
  13:{zh:'強制控制器繼電器關閉',en:'Force Controller Relay Off'},
  14:{zh:'控制器進入警戒',en:'Controller armed'},
  15:{zh:'控制器解除警戒',en:'Controller disarmed'},
  16:{zh:'出門按鈕',en:'Egress'},
  17:{zh:'警報事件',en:'Alarm event'},
  20:{zh:'控制器斷電',en:'Controller Power Off'},
  21:{zh:'脅迫事件',en:'Duress'},
  22:{zh:'保全求助',en:'Guards for help'},
  23:{zh:'清潔人員通行',en:'Cleaner access'},
  24:{zh:'控制器上電',en:'Controller Power On'},
  25:{zh:'強制控制器繼電器開／關錯誤',en:'Force Controller Relay On/Off Error'},
  26:{zh:'讀卡機恢復正常',en:'Reader Return to Normal (RTN)'},
  27:{zh:'求助按鈕按下',en:'Help push button pressed'},
  28:{zh:'僅密碼通行',en:'Access by PIN (Key Only)'},
  29:{zh:'數位輸入觸發',en:'Digital input actives'},
  30:{zh:'RS485 從屬讀卡機離線',en:'RS485 slave reader off line (Disconnected)'},
  31:{zh:'RS485 從屬讀卡機上線',en:'RS485 slave reader on line (Connected)'},
  32:{zh:'使用者 PIN 已變更',en:'User PIN code changed'},
  33:{zh:'變更使用者 PIN 失敗',en:'Change user PIN error'},
  34:{zh:'控制器上電',en:'Controller Power On'},
  35:{zh:'進入自動開門程序',en:'Enter Auto Door Open Procedure'},
  36:{zh:'離開自動開門程序',en:'Exit Auto Door Open Procedure'},
  37:{zh:'自動解除警戒',en:'Auto Disarmed'},
  38:{zh:'自動進入警戒',en:'Auto Armed'},
  39:{zh:'指紋／指靜脈通行',en:'Access by fingerprint or finger vein'},
  40:{zh:'指紋辨識失敗',en:'Fingerprint identify failed'},
  42:{zh:'遙控器「上」鍵按下',en:'Remote control “Up Key” pressed'},
  43:{zh:'停用讀卡機',en:'Disable Reader'},
  44:{zh:'啟用讀卡機',en:'Enable Reader'},
  45:{zh:'遙控器緊急鍵按下',en:'Remote control “Panic Key” pressed'},
  46:{zh:'停車系統使用者進場',en:'User entrance at parking system'},
  47:{zh:'停車系統使用者出場',en:'User exit at parking system'},
  48:{zh:'停車系統計數器觸發',en:'Counter triggered at parking system'},
  49:{zh:'繼電器鎖定',en:'Latch Relay'},
  53:{zh:'進入／離開編輯模式',en:'Enter/Exit Edit Mode'},
  55:{zh:'自由通行模式啟用／停用',en:'Free Access Mode Enable/Disable'},
  56:{zh:'指紋通行錯誤',en:'Access via Fingerprint Error'},
  59:{zh:'門開啟時禁止刷卡',en:'Inhibit card while door open'},
  60:{zh:'刷卡後禁止開門',en:'Never open door after card accessed'},
  62:{zh:'無法由 MIFARE 卡讀取日期／時間',en:'Can’t Read Date/Time from mifare card'},
  63:{zh:'無法由 MIFARE 卡讀取命令',en:'Can’t Read command from mifare card'},
  64:{zh:'MIFARE 卡扣值失敗',en:'Can’t deduct from mifare card'},
  65:{zh:'SOR 全域卡通行',en:'SOR global card accessed'},
  66:{zh:'SOR 干擾層錯誤',en:'SOR disturber layer error'},
  67:{zh:'拒絕通行：尚未到生效日期',en:'Access rejected: before begin date'},
  68:{zh:'拒絕通行：已過有效期限',en:'Access rejected: expiry'},
  69:{zh:'拒絕通行：卡片餘額不足',en:'Access rejected: card value not enough'},
  70:{zh:'通行成功並完成卡片扣值',en:'Access ok and card value deducted'},
  71:{zh:'通行成功，但由媒體讀取電梯資料失敗',en:'Access ok and read lift data from media failed'},
  72:{zh:'SOR 全域通行成功並完成扣值',en:'SOR global access ok and card value deducted'},
  73:{zh:'SOR 全域通行拒絕：餘額不足',en:'SOR global access reject by value not enough'},
  74:{zh:'SOR 全域通行成功，但扣值失敗',en:'SOR global access ok but card value deducted failed'},
  75:{zh:'SOR 全域通行成功，未扣值',en:'SOR global access ok without deducted'},
  86:{zh:'黑名單卡刷卡',en:'Black table tag accessed'},
  100:{zh:'指靜脈通行成功',en:'Access ok: access via vein'},
  101:{zh:'指靜脈通行拒絕',en:'Access reject: access via vein'},
  102:{zh:'內部門鎖鎖定，禁止通行',en:'Inhibited by internal lock locked for door Lock'},
  104:{zh:'火警輸入觸發',en:'Fire alarm input trigged'}
};

const pad = n => String(n).padStart(2,'0');

export function formatTimestamp(r, offset=3){
  const s=r[offset], m=r[offset+1], h=r[offset+2], d=r[offset+4], mo=r[offset+5], y=r[offset+6];
  if ([s,m,h,d,mo,y].some(v=>v===undefined)) return '';
  if (s>59||m>59||h>23||d<1||d>31||mo<1||mo>12) return '';
  return `${2000+y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function parseRecord(record, index=0, fileName=''){
  if (!(record instanceof Uint8Array) || record.length!==RECORD_SIZE) throw new Error('Record 必須正好 100 bytes');
  const userAddress=(record[11]<<8)|record[12];
  const functionCode=record[1];
  const functionDef=FUNCTION_CODES[functionCode];
  const functionLabel=`M${String(functionCode).padStart(2,'0')}`;
  return {
    index,
    fileName,
    raw:record,
    validLength:record[0]===0x21,
    length:record[0],
    functionCode,
    functionLabel,
    // 舊欄位保留相容性；內容已改為 SOYAL 的十進位 M 碼。
    functionHex:functionLabel,
    functionName:functionDef?.zh||'未識別事件',
    functionNameEn:functionDef?.en||'',
    node:record[2],
    eventTime:formatTimestamp(record,3),
    messageSource:record[10],
    userAddress,
    subCode:record[13],
    subFunction:record[14],
    extensionCode:record[15],
    userLevel:record[16],
    door:record[19],
    xorChecksum:record[31],
    sumChecksum:record[32],
    recordedTime:formatTimestamp(record,79),
    controllerNode:record[96],
    messageType:record[98]
  };
}

export function parseBuffer(buffer,fileName=''){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  const records=[];
  const errors=[];
  const count=Math.floor(bytes.length/RECORD_SIZE);
  for(let i=0;i<count;i++){
    const r=bytes.slice(i*RECORD_SIZE,(i+1)*RECORD_SIZE);
    try{records.push(parseRecord(r,i+1,fileName));}catch(err){errors.push({index:i+1,error:String(err)});}
  }
  if(bytes.length%RECORD_SIZE) errors.push({index:count+1,error:`尾端剩餘 ${bytes.length%RECORD_SIZE} bytes，不足 100 bytes`});
  return {records,errors,totalBytes:bytes.length};
}
