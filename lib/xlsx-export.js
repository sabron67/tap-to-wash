// Shared Excel export builder (replaces the old CSV exports). Calibri 11, A4, black-and-white friendly, author "Sabron".
// Every total, value and status column is a live formula, so edited cells recalculate when the file is opened.
const ExcelJS = require('exceljs');

const FONT = 'Calibri';
const AUTHOR = 'Sabron';
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const MED = { style: 'medium', color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const INPUT_BORDER = { top: MED, left: MED, bottom: MED, right: MED };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const LIGHT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const INPUT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const FMT = { money: '#,##0.00', num: '#,##0.00', int: '#,##0', date: 'dd-mmm-yyyy', pct: '0.0%' };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const colL = (i) => String.fromCharCode(65 + i);
const toDate = (ymd) => {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
// Row layout of every table sheet: title rows 1-2, headings row 4, data from row 5, totals row straight after the data.
const layoutOf = (n) => ({ first: 5, last: Math.max(4 + n, 5), total: 5 + Math.max(n, 1) });

function style(cell, { fmt, bold = false, fill, align, wrap = false, input = false, italic = false } = {}) {
  cell.border = input ? INPUT_BORDER : BORDER;
  cell.font = { name: FONT, size: 11, bold, italic };
  if (fmt) cell.numFmt = fmt;
  if (fill || input) cell.fill = fill || INPUT;
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: wrap };
}

function titleBlock(ws, title, sub) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: FONT, size: 16, bold: true };
  ws.getCell('A2').value = sub;
  ws.getCell('A2').font = { name: FONT, size: 11, italic: true };
}

function headerRow(ws, labels, widths) {
  const row = ws.getRow(4);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { name: FONT, size: 11, bold: true };
    c.fill = GREY;
    c.border = BORDER;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 32;
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function printSetup(ws, { landscape, lastRow, lastCol }) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0, // never shrink everything onto one page
    margins: { left: 0.5, right: 0.5, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    printArea: `A1:${lastCol}${lastRow}`,
    printTitlesRow: '4:4',
    blackAndWhite: true,
  };
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${ws.name} - prepared by ${AUTHOR}&C&"Calibri,Regular"&9Page &P of &N&R&"Calibri,Regular"&9&D`;
}

/*
 * Table sheet spec:
 *  name, title, subtitle, landscape, rows (array of arrays)
 *  columns: [{ header, width, type: text|money|num|int|date|pct, wrap, align,
 *              formula: (rowNo) => '=...'   (optional: makes the column a live formula)
 *              result:  (rowValues) => value (optional cached result for viewers that do not recalculate) }]
 *  totals: [{ col, kind: 'sum' | 'average' | 'count' | 'countif', criteria, fmt }], totalLabel
 */
function tableSheet(wb, spec) {
  const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  titleBlock(ws, spec.title, spec.subtitle);
  headerRow(ws, spec.columns.map((c) => c.header), spec.columns.map((c) => c.width));
  const n = spec.rows.length;
  const L = layoutOf(n);
  const lastCol = colL(spec.columns.length - 1);

  const valueOf = (vals, ci) => {
    const c = spec.columns[ci];
    if (c.formula) return c.result ? c.result(vals) : 0;
    return c.type === 'text' || c.type === 'date' ? vals[ci] : Number(vals[ci]);
  };

  spec.rows.forEach((vals, i) => {
    const r = L.first + i;
    spec.columns.forEach((c, ci) => {
      const cell = ws.getCell(`${colL(ci)}${r}`);
      if (c.formula) {
        const f = c.formula(r).replace(/^=/, '');
        cell.value = c.result ? { formula: f, result: c.result(vals) } : { formula: f };
      } else if (c.type === 'date') cell.value = toDate(vals[ci]);
      else if (['money', 'num', 'int', 'pct'].includes(c.type)) cell.value = vals[ci] === null || vals[ci] === undefined || vals[ci] === '' ? null : Number(vals[ci]);
      else cell.value = vals[ci] === null || vals[ci] === undefined ? '' : String(vals[ci]); // text stays text: it can never run as a formula
      style(cell, { fmt: FMT[c.type], align: c.align || (c.type === 'date' ? 'center' : ['money', 'num', 'int', 'pct'].includes(c.type) ? 'right' : undefined), wrap: !!c.wrap });
    });
  });
  if (!n) {
    ws.getCell('A5').value = 'No records';
    style(ws.getCell('A5'), { italic: true });
  }

  // Totals row (formulas over the data rows)
  const totals = spec.totals || [];
  if (totals.length) {
    spec.columns.forEach((c, ci) => style(ws.getCell(`${colL(ci)}${L.total}`), { bold: true, fill: LIGHT }));
    ws.getCell(`A${L.total}`).value = spec.totalLabel || 'Total';
    totals.forEach((t) => {
      const letter = colL(t.col);
      const rng = `${letter}${L.first}:${letter}${L.last}`;
      const nums = spec.rows.map((v) => valueOf(v, t.col)).filter((v) => v !== null && v !== '' && !Number.isNaN(v));
      let f, result;
      if (t.kind === 'average') { f = `IFERROR(AVERAGE(${rng}),0)`; result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }
      else if (t.kind === 'count') { f = `COUNTA(${rng})`; result = spec.rows.filter((v) => String(valueOf(v, t.col) ?? '') !== '').length; }
      else if (t.kind === 'countif') { f = `COUNTIF(${rng},"${t.criteria}")`; result = spec.rows.filter((v) => valueOf(v, t.col) === t.criteria).length; }
      else { f = `SUM(${rng})`; result = nums.reduce((a, b) => a + b, 0); }
      const cell = ws.getCell(`${letter}${L.total}`);
      cell.value = { formula: f, result };
      style(cell, { bold: true, fill: LIGHT, align: 'right', fmt: t.fmt || FMT[spec.columns[t.col].type] || FMT.int });
    });
  }
  printSetup(ws, { landscape: spec.landscape, lastRow: totals.length ? L.total : L.last, lastCol });
  return ws;
}

async function buildWorkbook({ title, sheets }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = AUTHOR;
  wb.lastModifiedBy = AUTHOR;
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = title;
  wb.calcProperties = { fullCalcOnLoad: true };
  sheets.forEach((s) => (s.custom ? s.custom(wb) : tableSheet(wb, s)));
  return wb.xlsx.writeBuffer();
}

// Sends the workbook as a download. File names use hyphens, never underscores.
async function sendWorkbook(res, filename, book) {
  const buf = await buildWorkbook(book);
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
}

module.exports = { buildWorkbook, sendWorkbook, tableSheet, titleBlock, headerRow, printSetup, style, layoutOf, colL, FONT, AUTHOR, FMT, LIGHT, GREY };
