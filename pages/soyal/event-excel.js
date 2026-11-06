function esc(v){return String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

export function exportEventExcel(headers,rows,fileName='SOYAL_事件紀錄.xls'){
  const table=[headers,...rows].map((row,rowIndex)=>{
    const cells=row.map(value=>{
      const isNumber=typeof value==='number'&&Number.isFinite(value);
      const type=isNumber?'Number':'String';
      return `<Cell${rowIndex===0?' ss:StyleID="Header"':''}><Data ss:Type="${type}">${esc(value)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="事件紀錄"><Table>${table}</Table><AutoFilter xmlns="urn:schemas-microsoft-com:office:excel" x:Range="R1C1:R${rows.length+1}C${headers.length}" xmlns:x="urn:schemas-microsoft-com:office:excel"/></Worksheet></Workbook>`;
  const blob=new Blob(['\uFEFF',xml],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
