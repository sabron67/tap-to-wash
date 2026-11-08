// Builds the business workbook (Excel) with live formulas. Calibri 11, A4, black-and-white friendly, author "Sabron".
const ExcelJS = require('exceljs');
const { STATUSES, STATUS_MAP } = require('./helpers');

const FONT = 'Calibri';
const AUTHOR = 'Sabron';
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const MED = { style: 'medium', color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const INPUT_BORDER = { top: MED, left: MED, bottom: MED, right: MED };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const LIGHT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const INPUT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const MONEY = '#,##0.00';
const INT = '#,##0';
const PCT = '0.0%';
const DATE = 'dd-mmm-yyyy';

const REQ_FIRST = 5, REQ_LAST = 5004; // formulas look at up to 5,000 requests
const ITEM_LAST = 10004;
const CUST_LAST = 2004;
const RATE_LAST = 104;
const CAT_ROWS = 60;

const rq = (col) => `Requests!$${col}$${REQ_FIRST}:$${col}$${REQ_LAST}`;
const it = (col) => `Items!$${col}$${REQ_FIRST}:$${col}$${ITEM_LAST}`;
const rt = (col) => `Rates!$${col}$5:$${col}$${RATE_LAST}`;

const toDate = (ymd) => {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function setup(ws, { orientation = 'portrait', lastRow, lastCol, titles = true }) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0, // as many pages tall as needed - never shrink to one page
    margins: { left: 0.5, right: 0.5, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    horizontalCentered: false,
    printArea: `A1:${lastCol}${lastRow}`,
    blackAndWhite: true,
  };
  if (titles) ws.pageSetup.printTitlesRow = '4:4';
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${ws.name} - prepared by ${AUTHOR}&C&"Calibri,Regular"&9Page &P of &N&R&"Calibri,Regular"&9&D`;
}

function titleBlock(ws, title, sub, lastCol) {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: FONT, size: 16, bold: true };
  ws.getCell('A2').value = sub;
  ws.getCell('A2').font = { name: FONT, size: 11, italic: true };
  ws.getCell('A2').alignment = { wrapText: false };
  void lastCol;
}

function headerRow(ws, rowNo, labels, widths) {
  const row = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1);
    c.value = l;
    c.font = { name: FONT, size: 11, bold: true };
    c.fill = GREY;
    c.border = BORDER;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 32;
  if (widths) widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function boxed(cell, { fmt, bold = false, fill, align, input = false, wrap = false } = {}) {
  cell.border = input ? INPUT_BORDER : BORDER;
  cell.font = { name: FONT, size: 11, bold };
  if (fmt) cell.numFmt = fmt;
  if (fill || input) cell.fill = fill || INPUT;
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: wrap };
}

async function buildWorkbook({ settings, from, to, requests, items, customers, categories, truncated }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = AUTHOR;
  wb.lastModifiedBy = AUTHOR;
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = `${settings.business_name} - business report`;
  wb.subject = 'Requests, income and laundry costing calculators';
  wb.company = settings.business_name;
  wb.calcProperties = { fullCalcOnLoad: true };

  const names = ['Summary', 'Inputs', 'Costing', 'Quote', 'Rates', 'Requests', 'Items', 'By Category', 'By Month', 'Customers'];
  const W = Object.fromEntries(names.map((n) => [n, wb.addWorksheet(n, { views: [{ showGridLines: false }] })]));
  const cur = settings.currency;
  const period = `${from} to ${to}`;

  /* ------------------------------ Rates ------------------------------ */
  {
    const ws = W.Rates;
    titleBlock(ws, 'Service rates', `Edit prices here (yellow cells) - the Quote, Items and By Category sheets update automatically. Prices in ${cur}.`);
    headerRow(ws, 4, ['Service / category', 'Unit', `Price (${cur})`, 'Shown on website'], [38, 12, 16, 18]);
    for (let r = 5; r <= RATE_LAST; r++) {
      const c = categories[r - 5];
      ws.getCell(`A${r}`).value = c ? c.name : null;
      ws.getCell(`B${r}`).value = c ? c.unit : null;
      ws.getCell(`C${r}`).value = c && c.price !== null ? Number(c.price) : null;
      ws.getCell(`D${r}`).value = c ? (c.is_active ? 'Yes' : 'No') : null;
      ['A', 'B', 'C', 'D'].forEach((col) => boxed(ws.getCell(`${col}${r}`), { input: true, fmt: col === 'C' ? MONEY : undefined, align: col === 'D' || col === 'B' ? 'center' : undefined }));
    }
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(ws, { lastRow: Math.max(4 + categories.length + 5, 25), lastCol: 'D' });
  }

  /* ------------------------------ Inputs ------------------------------ */
  const I = {}; // key -> absolute reference
  {
    const ws = W.Inputs;
    titleBlock(ws, 'Assumptions (change the yellow cells)', `Every calculator in this workbook reads from this sheet. Amounts in ${cur}. Replace the sample figures with your own.`);
    headerRow(ws, 4, ['Assumption', 'Value', 'Notes'], [46, 18, 62]);
    let row = 5;
    const section = (text) => {
      ws.mergeCells(`A${row}:C${row}`);
      const c = ws.getCell(`A${row}`);
      c.value = text;
      c.font = { name: FONT, size: 11, bold: true };
      c.fill = LIGHT;
      c.border = BORDER;
      row++;
    };
    const inp = (key, label, value, fmt, note = '') => {
      ws.getCell(`A${row}`).value = label;
      boxed(ws.getCell(`A${row}`));
      ws.getCell(`B${row}`).value = value;
      boxed(ws.getCell(`B${row}`), { input: true, fmt, bold: true, align: 'right' });
      ws.getCell(`C${row}`).value = note;
      boxed(ws.getCell(`C${row}`), { wrap: true });
      I[key] = `Inputs!$B$${row}`;
      row++;
    };
    const kgPrices = categories.filter((c) => String(c.unit).toLowerCase() === 'kg' && c.price !== null).map((c) => Number(c.price));
    const avgKg = kgPrices.length ? Math.round(kgPrices.reduce((a, b) => a + b, 0) / kgPrices.length) : 150;

    section('Pricing');
    inp('price_kg', `Average selling price per kg (${cur})`, avgKg, MONEY, 'Taken from your kg-priced services when there are any.');
    inp('vat', 'VAT rate', 0.16, PCT, 'Kenya standard rate is 16%. Use 0% if you are not VAT-registered.');
    inp('discount', 'Standard discount on quotes', 0, PCT, 'Applied on the Quote sheet.');
    inp('delivery_fee', `Delivery fee charged per order (${cur})`, 100, MONEY, 'Charged on the Quote sheet when an order has items.');
    inp('target', 'Target profit margin', 0.3, PCT, 'Used to suggest a selling price on the Costing sheet.');
    section('Capacity');
    inp('machines', 'Number of washing machines', 2, INT);
    inp('cap_kg', 'Capacity of one load (kg)', 10, INT);
    inp('loads_day', 'Loads per machine per day', 6, INT);
    inp('days', 'Working days per month', 26, INT);
    inp('util', 'Expected utilisation of capacity', 0.7, PCT, 'Share of the time the machines are actually full and running.');
    inp('exp_kg', 'Expected kilograms washed per month', 1500, INT, 'Your forecast. Compare it with the capacity on the Costing sheet.');
    inp('kg_order', 'Average kg per order', 6, MONEY, 'Used to spread the delivery cost over each kg.');
    section('Variable costs');
    inp('water_l_load', 'Water used per load (litres)', 60, INT);
    inp('water_m3', `Water price (${cur} per cubic metre)`, 150, MONEY, 'One cubic metre = 1,000 litres.');
    inp('kwh_load', 'Electricity per load (kWh)', 2.5, MONEY, 'Washing and drying. Check the machine plate or measure it.');
    inp('kwh_price', `Electricity price (${cur} per kWh)`, 28, MONEY);
    inp('det_load', `Detergent and softener per load (${cur})`, 25, MONEY);
    inp('pack_kg', `Packaging per kg (${cur})`, 5, MONEY, 'Bags, hangers, tags.');
    inp('del_order', `Delivery cost per order (${cur})`, 150, MONEY, 'Fuel or rider pay for pick-up and drop-off.');
    inp('fee_pct', 'Payment fees (share of sales)', 0.01, PCT, 'Mobile-money or card charges.');
    section('Fixed costs per month');
    inp('rent', `Rent (${cur})`, 20000, MONEY);
    inp('wages', `Wages and salaries (${cur})`, 30000, MONEY);
    inp('util_fixed', `Fixed utilities and internet (${cur})`, 3000, MONEY);
    inp('marketing', `Marketing (${cur})`, 2000, MONEY);
    inp('maint', `Machine repairs and servicing (${cur})`, 2000, MONEY);
    inp('other_fixed', `Other fixed costs (${cur})`, 2000, MONEY, 'Licences, insurance, cleaning supplies, etc.');
    section('Equipment');
    inp('machine_cost', `Cost of one machine (${cur})`, 150000, MONEY);
    inp('life', 'Useful life of a machine (months)', 60, INT, 'Used to work out monthly depreciation.');
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(ws, { lastRow: row - 1, lastCol: 'C' });
  }

  /* ------------------------------ Costing ------------------------------ */
  const C = {};
  {
    const ws = W.Costing;
    titleBlock(ws, 'Costing, break-even and pricing', `All figures are calculated from the Inputs sheet. Amounts in ${cur}. VAT is not included (it is passed on to the tax office).`);
    headerRow(ws, 4, ['Measure', 'Result', 'How it is worked out'], [46, 20, 62]);
    let row = 5;
    const section = (text) => {
      ws.mergeCells(`A${row}:C${row}`);
      const c = ws.getCell(`A${row}`);
      c.value = text;
      c.font = { name: FONT, size: 11, bold: true };
      c.fill = LIGHT;
      c.border = BORDER;
      row++;
    };
    const calc = (key, label, formula, fmt, note = '', bold = false) => {
      ws.getCell(`A${row}`).value = label;
      boxed(ws.getCell(`A${row}`), { bold });
      ws.getCell(`B${row}`).value = { formula };
      boxed(ws.getCell(`B${row}`), { fmt, bold, align: 'right' });
      ws.getCell(`C${row}`).value = note;
      boxed(ws.getCell(`C${row}`), { wrap: true });
      C[key] = `$B$${row}`;
      row++;
    };
    const c = (k) => C[k];
    section('Capacity');
    calc('cap_month', 'Monthly capacity (kg)', `${I.machines}*${I.cap_kg}*${I.loads_day}*${I.days}*${I.util}`, INT, 'Machines × kg per load × loads per day × days × utilisation');
    calc('need_loads', 'Loads needed per month', `IFERROR(${I.exp_kg}/${I.cap_kg},0)`, INT, 'Expected kg ÷ kg per load');
    calc('cap_use', 'Share of capacity used', `IF(${c('cap_month')}=0,0,${I.exp_kg}/${c('cap_month')})`, PCT, 'Expected kg ÷ monthly capacity');
    calc('cap_flag', 'Capacity check', `IF(${c('cap_use')}>1,"Over capacity - add machines or shifts",IF(${c('cap_use')}>0.85,"Near capacity","Within capacity"))`, undefined, 'Warns when demand is more than you can wash');
    section('Variable cost per load');
    calc('water_load', 'Water per load', `${I.water_l_load}/1000*${I.water_m3}`, MONEY);
    calc('elec_load', 'Electricity per load', `${I.kwh_load}*${I.kwh_price}`, MONEY);
    calc('det_load', 'Detergent per load', `${I.det_load}`, MONEY);
    calc('var_load', 'Total variable cost per load', `${c('water_load')}+${c('elec_load')}+${c('det_load')}`, MONEY, '', true);
    section('Variable cost per kg');
    calc('wash_kg', 'Washing (water, power, detergent)', `IFERROR(${c('var_load')}/${I.cap_kg},0)`, MONEY, 'Cost per load ÷ kg per load');
    calc('pack_kg', 'Packaging', `${I.pack_kg}`, MONEY);
    calc('del_kg', 'Delivery', `IFERROR(${I.del_order}/${I.kg_order},0)`, MONEY, 'Delivery cost per order ÷ average kg per order');
    calc('fee_kg', 'Payment fees', `${I.price_kg}*${I.fee_pct}`, MONEY, 'Selling price × fee share');
    calc('var_kg', 'Total variable cost per kg', `${c('wash_kg')}+${c('pack_kg')}+${c('del_kg')}+${c('fee_kg')}`, MONEY, '', true);
    section('Fixed costs');
    calc('depr', 'Machine depreciation per month', `IFERROR(${I.machines}*${I.machine_cost}/${I.life},0)`, MONEY, 'Machines × cost ÷ useful life');
    calc('fixed_month', 'Total fixed costs per month', `${I.rent}+${I.wages}+${I.util_fixed}+${I.marketing}+${I.maint}+${I.other_fixed}+${c('depr')}`, MONEY, 'Rent, wages, utilities, marketing, repairs, other and depreciation', true);
    calc('fixed_kg', 'Fixed cost per kg', `IFERROR(${c('fixed_month')}/${I.exp_kg},0)`, MONEY, 'Fixed costs ÷ expected kg');
    section('Profit and pricing');
    calc('cost_kg', 'Total cost per kg', `${c('var_kg')}+${c('fixed_kg')}`, MONEY, 'Variable + fixed', true);
    calc('price', 'Selling price per kg', `${I.price_kg}`, MONEY);
    calc('margin_kg', 'Profit per kg', `${c('price')}-${c('cost_kg')}`, MONEY, 'Selling price - total cost', true);
    calc('margin_pct', 'Profit margin', `IF(${c('price')}=0,0,${c('margin_kg')}/${c('price')})`, PCT);
    calc('revenue', 'Expected sales per month', `${c('price')}*${I.exp_kg}`, MONEY, 'Price × expected kg');
    calc('total_cost', 'Expected costs per month', `${c('var_kg')}*${I.exp_kg}+${c('fixed_month')}`, MONEY);
    calc('profit', 'Expected profit per month', `${c('revenue')}-${c('total_cost')}`, MONEY, 'Sales - costs', true);
    calc('breakeven', 'Break-even volume (kg per month)', `IF(${c('price')}-${c('var_kg')}<=0,"n/a",${c('fixed_month')}/(${c('price')}-${c('var_kg')}))`, INT, 'Fixed costs ÷ (price - variable cost per kg). Below this you lose money.', true);
    calc('breakeven_cap', 'Break-even as a share of capacity', `IFERROR(${c('breakeven')}/${c('cap_month')},"n/a")`, PCT);
    calc('suggest', 'Suggested price per kg for the target margin', `IFERROR((${c('wash_kg')}+${c('pack_kg')}+${c('del_kg')}+${c('fixed_kg')})/(1-${I.target}-${I.fee_pct}),0)`, MONEY, 'Cost ÷ (1 - target margin - payment fee share)', true);
    setup(ws, { lastRow: row - 1, lastCol: 'C' });
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  }

  /* ------------------------------ Quote ------------------------------ */
  {
    const ws = W.Quote;
    titleBlock(ws, 'Quote calculator', 'Pick a service in column A (list from the Rates sheet) and type the quantity. Totals include discount, delivery and VAT from the Inputs sheet.');
    ws.getCell('A3').value = 'Customer:';
    ws.getCell('A3').font = { name: FONT, size: 11, bold: true };
    ws.mergeCells('B3:C3');
    boxed(ws.getCell('B3'), { input: true });
    ws.getCell('D3').value = 'Date:';
    ws.getCell('D3').font = { name: FONT, size: 11, bold: true };
    ws.getCell('D3').alignment = { horizontal: 'right' };
    boxed(ws.getCell('E3'), { input: true, fmt: DATE });
    headerRow(ws, 4, ['Service', 'Unit', 'Quantity', `Rate (${cur})`, `Amount (${cur})`], [40, 10, 12, 16, 18]);
    const first = 5, last = 24;
    for (let r = first; r <= last; r++) {
      boxed(ws.getCell(`A${r}`), { input: true });
      ws.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Rates!$A$5:$A$${RATE_LAST}`], showErrorMessage: true, errorTitle: 'Unknown service', error: 'Choose a service from the list (add new ones on the Rates sheet).' };
      ws.getCell(`B${r}`).value = { formula: `IF($A${r}="","",IFERROR(INDEX(${rt('B')},MATCH($A${r},${rt('A')},0)),""))` };
      boxed(ws.getCell(`B${r}`), { align: 'center' });
      boxed(ws.getCell(`C${r}`), { input: true, fmt: '#,##0.##' });
      ws.getCell(`D${r}`).value = { formula: `IF($A${r}="","",IFERROR(INDEX(${rt('C')},MATCH($A${r},${rt('A')},0)),0))` };
      boxed(ws.getCell(`D${r}`), { fmt: MONEY });
      ws.getCell(`E${r}`).value = { formula: `IF(OR($A${r}="",$C${r}=""),0,$C${r}*$D${r})` };
      boxed(ws.getCell(`E${r}`), { fmt: MONEY });
    }
    let r = last + 2;
    const tot = (label, formula, bold = false, fmt = MONEY) => {
      ws.mergeCells(`A${r}:D${r}`);
      ws.getCell(`A${r}`).value = label;
      boxed(ws.getCell(`A${r}`), { bold, align: 'right' });
      ws.getCell(`E${r}`).value = { formula };
      boxed(ws.getCell(`E${r}`), { fmt, bold });
      r++;
      return `E${r - 1}`;
    };
    const sub = tot('Subtotal', `SUM(E${first}:E${last})`);
    const disc = tot('Discount', `-${sub}*${I.discount}`);
    const del = tot('Delivery fee', `IF(${sub}>0,${I.delivery_fee},0)`);
    const taxable = tot('Amount before VAT', `${sub}+${disc}+${del}`);
    const vat = tot('VAT', `${taxable}*${I.vat}`);
    tot('TOTAL TO PAY', `${taxable}+${vat}`, true);
    setup(ws, { lastRow: r - 1, lastCol: 'E' });
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  }

  /* ------------------------------ Requests ------------------------------ */
  const reqCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  {
    const ws = W.Requests;
    titleBlock(ws, 'Requests', `Received ${period}. Balance, payment status and turnaround are formulas.${truncated.requests ? ' NOTE: only the first 5,000 requests are included - narrow the dates.' : ''}`);
    headerRow(ws, 4, ['Reference', 'Received', 'Customer', 'Phone', 'Status', 'Items', 'Location', `Total (${cur})`, `Paid (${cur})`, 'Delivered on', 'Terms version accepted', `Balance (${cur})`, 'Payment', 'Turnaround (days)'],
      [15, 13, 22, 16, 12, 34, 32, 14, 14, 13, 11, 14, 12, 12]);
    requests.forEach((q, i) => {
      const n = REQ_FIRST + i;
      const row = ws.getRow(n);
      row.getCell(1).value = q.ref_code;
      row.getCell(2).value = toDate(q.day);
      row.getCell(3).value = q.customer_name;
      row.getCell(4).value = q.customer_phone;
      row.getCell(5).value = STATUS_MAP[q.status] ? STATUS_MAP[q.status].label : q.status;
      row.getCell(6).value = q.items || '';
      row.getCell(7).value = q.location_description;
      row.getCell(8).value = Number(q.total_amount);
      row.getCell(9).value = Number(q.amount_paid);
      row.getCell(10).value = q.delivered_day ? toDate(q.delivered_day) : null;
      row.getCell(11).value = q.terms_version || null;
      row.getCell(12).value = { formula: `IF(E${n}="Cancelled",0,MAX(0,H${n}-I${n}))` };
      row.getCell(13).value = { formula: `IF(H${n}<=0,"Not priced",IF(I${n}>=H${n},"Paid",IF(I${n}>0,"Part paid","Unpaid")))` };
      row.getCell(14).value = { formula: `IF(J${n}="","",J${n}-B${n})` };
      reqCols.forEach((col, k) => {
        boxed(row.getCell(k + 1), { fmt: ['H', 'I', 'L'].includes(col) ? MONEY : ['B', 'J'].includes(col) ? DATE : col === 'N' ? INT : undefined, wrap: ['F', 'G'].includes(col), align: ['B', 'E', 'J', 'K', 'M', 'N'].includes(col) ? 'center' : undefined });
      });
    });
    const last = Math.max(REQ_FIRST + requests.length - 1, REQ_FIRST);
    ws.autoFilter = `A4:N${last}`;
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1, showGridLines: false }];
    setup(ws, { orientation: 'landscape', lastRow: last, lastCol: 'N' });
  }

  /* ------------------------------ Items ------------------------------ */
  {
    const ws = W.Items;
    titleBlock(ws, 'Items washed', `Items on requests received ${period} (cancelled requests left out). Rates come from the Rates sheet.${truncated.items ? ' NOTE: only the first 10,000 lines are included.' : ''}`);
    headerRow(ws, 4, ['Reference', 'Received', 'Service / category', 'Quantity', 'Unit', `Rate (${cur})`, `Line value (${cur})`], [15, 13, 34, 11, 10, 14, 18]);
    items.forEach((x, i) => {
      const n = REQ_FIRST + i;
      const row = ws.getRow(n);
      row.getCell(1).value = x.ref_code;
      row.getCell(2).value = toDate(x.day);
      row.getCell(3).value = x.category_name;
      row.getCell(4).value = x.quantity;
      row.getCell(5).value = { formula: `IFERROR(INDEX(${rt('B')},MATCH(C${n},${rt('A')},0)),"")` };
      row.getCell(6).value = { formula: `IFERROR(INDEX(${rt('C')},MATCH(C${n},${rt('A')},0)),0)` };
      row.getCell(7).value = { formula: `D${n}*F${n}` };
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((col, k) => boxed(row.getCell(k + 1), { fmt: col === 'B' ? DATE : col === 'F' || col === 'G' ? MONEY : col === 'D' ? INT : undefined, align: ['B', 'D', 'E'].includes(col) ? 'center' : undefined }));
    });
    const last = Math.max(REQ_FIRST + items.length - 1, REQ_FIRST);
    ws.autoFilter = `A4:G${last}`;
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(ws, { lastRow: last, lastCol: 'G' });
  }

  /* ------------------------------ By Category ------------------------------ */
  {
    const ws = W.Customers; // placeholder reference to keep order logic simple
    void ws;
    const wc = W['By Category'];
    titleBlock(wc, 'Sales by service', `Counts and values from the Items sheet (${period}).`);
    headerRow(wc, 4, ['Service / category', 'Unit', 'Lines', 'Quantity', `Value (${cur})`, 'Share of value'], [36, 10, 10, 12, 18, 14]);
    const first = 5, last = first + CAT_ROWS - 1, totalRow = last + 1;
    for (let r = first; r <= last; r++) {
      wc.getCell(`A${r}`).value = { formula: `IF(Rates!A${r}="","",Rates!A${r})` };
      wc.getCell(`B${r}`).value = { formula: `IF(A${r}="","",Rates!B${r})` };
      wc.getCell(`C${r}`).value = { formula: `IF(A${r}="","",COUNTIF(${it('C')},A${r}))` };
      wc.getCell(`D${r}`).value = { formula: `IF(A${r}="","",SUMIF(${it('C')},A${r},${it('D')}))` };
      wc.getCell(`E${r}`).value = { formula: `IF(A${r}="","",SUMIF(${it('C')},A${r},${it('G')}))` };
      wc.getCell(`F${r}`).value = { formula: `IF(A${r}="","",IF($E$${totalRow}=0,0,E${r}/$E$${totalRow}))` };
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => boxed(wc.getCell(`${col}${r}`), { fmt: col === 'E' ? MONEY : col === 'F' ? PCT : col === 'C' || col === 'D' ? INT : undefined, align: col === 'B' ? 'center' : undefined }));
    }
    wc.getCell(`A${totalRow}`).value = 'TOTAL';
    wc.getCell(`C${totalRow}`).value = { formula: `SUM(C${first}:C${last})` };
    wc.getCell(`D${totalRow}`).value = { formula: `SUM(D${first}:D${last})` };
    wc.getCell(`E${totalRow}`).value = { formula: `SUM(E${first}:E${last})` };
    wc.getCell(`F${totalRow}`).value = { formula: `SUM(F${first}:F${last})` };
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => boxed(wc.getCell(`${col}${totalRow}`), { bold: true, fill: GREY, fmt: col === 'E' ? MONEY : col === 'F' ? PCT : col === 'C' || col === 'D' ? INT : undefined }));
    wc.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(wc, { lastRow: totalRow, lastCol: 'F' });
  }

  /* ------------------------------ By Month ------------------------------ */
  {
    const ws = W['By Month'];
    titleBlock(ws, 'Requests by month', `Twelve months ending in ${to.slice(0, 7)}. Only requests inside the report period (${period}) are in the workbook.`);
    headerRow(ws, 4, ['Month', 'Requests', `Billed (${cur})`, `Collected (${cur})`, `Outstanding (${cur})`, `Average order (${cur})`], [16, 12, 18, 18, 18, 18]);
    const first = 5, last = 16, totalRow = 17;
    for (let r = first; r <= last; r++) {
      ws.getCell(`A${r}`).value = { formula: r === first ? `DATE(YEAR(Summary!$B$5),MONTH(Summary!$B$5)-11,1)` : `EDATE(A${r - 1},1)` };
      const rng = (col) => `${rq(col)},">="&$A${r},${rq('B')},"<"&EDATE($A${r},1)`;
      ws.getCell(`B${r}`).value = { formula: `COUNTIFS(${rq('B')},">="&$A${r},${rq('B')},"<"&EDATE($A${r},1))` };
      ws.getCell(`C${r}`).value = { formula: `SUMIFS(${rq('H')},${rng('B')})` };
      ws.getCell(`D${r}`).value = { formula: `SUMIFS(${rq('I')},${rng('B')})` };
      ws.getCell(`E${r}`).value = { formula: `SUMIFS(${rq('L')},${rng('B')})` };
      ws.getCell(`F${r}`).value = { formula: `IF(B${r}=0,0,C${r}/B${r})` };
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => boxed(ws.getCell(`${col}${r}`), { fmt: col === 'A' ? 'mmm yyyy' : col === 'B' ? INT : MONEY, align: col === 'A' ? 'center' : undefined }));
    }
    ws.getCell(`A${totalRow}`).value = 'TOTAL';
    ['B', 'C', 'D', 'E'].forEach((col) => (ws.getCell(`${col}${totalRow}`).value = { formula: `SUM(${col}${first}:${col}${last})` }));
    ws.getCell(`F${totalRow}`).value = { formula: `IF(B${totalRow}=0,0,C${totalRow}/B${totalRow})` };
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => boxed(ws.getCell(`${col}${totalRow}`), { bold: true, fill: GREY, fmt: col === 'B' ? INT : col === 'A' ? undefined : MONEY }));
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(ws, { lastRow: totalRow, lastCol: 'F' });
  }

  /* ------------------------------ Customers ------------------------------ */
  {
    const ws = W.Customers;
    titleBlock(ws, 'Customers', `Customers who made a request in ${period}. Totals are formulas over the Requests sheet.${truncated.customers ? ' NOTE: only the first 2,000 customers are listed.' : ''}`);
    headerRow(ws, 4, ['Customer', 'Phone', 'Requests', `Billed (${cur})`, `Paid (${cur})`, `Balance (${cur})`, 'Last request'], [28, 18, 11, 16, 16, 16, 15]);
    customers.forEach((c, i) => {
      const n = REQ_FIRST + i;
      const row = ws.getRow(n);
      row.getCell(1).value = c.name;
      row.getCell(2).value = c.phone;
      row.getCell(3).value = { formula: `SUMPRODUCT(--(${rq('D')}=B${n}))` };
      row.getCell(4).value = { formula: `SUMPRODUCT((${rq('D')}=B${n})*${rq('H')})` };
      row.getCell(5).value = { formula: `SUMPRODUCT((${rq('D')}=B${n})*${rq('I')})` };
      row.getCell(6).value = { formula: `SUMPRODUCT((${rq('D')}=B${n})*${rq('L')})` };
      row.getCell(7).value = { formula: `IF(C${n}=0,"",SUMPRODUCT(MAX((${rq('D')}=B${n})*${rq('B')})))` };
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((col, k) => boxed(row.getCell(k + 1), { fmt: col === 'C' ? INT : ['D', 'E', 'F'].includes(col) ? MONEY : col === 'G' ? DATE : undefined, align: ['C', 'G'].includes(col) ? 'center' : undefined }));
    });
    const last = Math.max(REQ_FIRST + customers.length - 1, REQ_FIRST);
    ws.autoFilter = `A4:G${last}`;
    ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
    setup(ws, { lastRow: last, lastCol: 'G' });
  }

  /* ------------------------------ Summary ------------------------------ */
  {
    const ws = W.Summary;
    titleBlock(ws, `${settings.business_name} - business report`, `Period ${period}. Generated for ${AUTHOR}'s records. Figures are live formulas: edit the yellow cells on Inputs, Rates and Quote.`);
    [['Period from', toDate(from), DATE], ['Period to', toDate(to), DATE], ['Generated on', new Date(), DATE], ['Currency', cur, undefined]].forEach(([label, val, fmt], i) => {
      const r = 4 + i;
      ws.getCell(`A${r}`).value = label;
      boxed(ws.getCell(`A${r}`), { bold: true });
      ws.getCell(`B${r}`).value = val;
      boxed(ws.getCell(`B${r}`), { fmt, align: 'right' });
    });
    ws.getColumn(1).width = 44;
    ws.getColumn(2).width = 20;
    ws.getColumn(3).width = 20;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 36;

    const kpiHead = (r, labels) => {
      labels.forEach((l, i) => {
        const c = ws.getRow(r).getCell(i + 1);
        c.value = l;
        c.font = { name: FONT, size: 11, bold: true };
        c.fill = GREY;
        c.border = BORDER;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    };
    kpiHead(9, ['Measure', 'Value', 'Notes']);
    ws.mergeCells('C9:E9');
    let r = 10;
    const kpi = (label, formula, fmt, note = '') => {
      ws.getCell(`A${r}`).value = label;
      boxed(ws.getCell(`A${r}`));
      ws.getCell(`B${r}`).value = { formula };
      boxed(ws.getCell(`B${r}`), { fmt, bold: true, align: 'right' });
      ws.mergeCells(`C${r}:E${r}`);
      ws.getCell(`C${r}`).value = note;
      boxed(ws.getCell(`C${r}`), { wrap: true });
      return `B${r++}`;
    };
    const nReq = kpi('Requests received', `COUNTA(${rq('A')})`, INT);
    const nDel = kpi('Delivered', `COUNTIF(${rq('E')},"Delivered")`, INT);
    const nCan = kpi('Cancelled', `COUNTIF(${rq('E')},"Cancelled")`, INT);
    kpi('In progress', `${nReq}-${nDel}-${nCan}`, INT, 'Received - delivered - cancelled');
    const billed = kpi(`Total billed (${cur})`, `SUM(${rq('H')})`, MONEY);
    const paid = kpi(`Collected (${cur})`, `SUM(${rq('I')})`, MONEY);
    kpi(`Outstanding balance (${cur})`, `SUM(${rq('L')})`, MONEY, 'Cancelled requests are not counted');
    kpi('Collection rate', `IF(${billed}=0,0,${paid}/${billed})`, PCT, 'Collected ÷ billed');
    kpi(`Average order value (${cur})`, `IFERROR(${billed}/COUNTIF(${rq('H')},">0"),0)`, MONEY, 'Billed ÷ priced requests');
    kpi('Requests not yet priced', `COUNTIF(${rq('M')},"Not priced")`, INT, 'Enter totals on these in the admin area');
    kpi('Average turnaround (days)', `IFERROR(AVERAGE(${rq('N')}),0)`, '0.0', 'Received to delivered');
    kpi('Customers in this period', `COUNTA(Customers!$A$5:$A$${CUST_LAST})`, INT);
    kpi('Repeat customers', `COUNTIF(Customers!$C$5:$C$${CUST_LAST},">1")`, INT, 'More than one request in the period');

    r += 1;
    kpiHead(r, ['Business model (Inputs and Costing)', 'Value', 'Notes']);
    ws.mergeCells(`C${r}:E${r}`);
    r += 1;
    kpi('Monthly capacity (kg)', `Costing!${C.cap_month}`, INT);
    kpi('Capacity check', `Costing!${C.cap_flag}`, undefined);
    kpi(`Total cost per kg (${cur})`, `Costing!${C.cost_kg}`, MONEY);
    kpi(`Profit per kg (${cur})`, `Costing!${C.margin_kg}`, MONEY);
    kpi('Break-even volume (kg per month)', `Costing!${C.breakeven}`, INT);
    kpi(`Expected profit per month (${cur})`, `Costing!${C.profit}`, MONEY);
    kpi(`Suggested price per kg (${cur})`, `Costing!${C.suggest}`, MONEY, 'For the target margin on Inputs');

    r += 1;
    kpiHead(r, ['Status', 'Requests', `Billed (${cur})`, `Collected (${cur})`]);
    r += 1;
    const firstStatus = r;
    STATUSES.forEach((s) => {
      ws.getCell(`A${r}`).value = s.label;
      boxed(ws.getCell(`A${r}`));
      ws.getCell(`B${r}`).value = { formula: `COUNTIF(${rq('E')},A${r})` };
      boxed(ws.getCell(`B${r}`), { fmt: INT });
      ws.getCell(`C${r}`).value = { formula: `SUMIF(${rq('E')},A${r},${rq('H')})` };
      boxed(ws.getCell(`C${r}`), { fmt: MONEY });
      ws.getCell(`D${r}`).value = { formula: `SUMIF(${rq('E')},A${r},${rq('I')})` };
      boxed(ws.getCell(`D${r}`), { fmt: MONEY });
      r++;
    });
    ws.getCell(`A${r}`).value = 'TOTAL';
    ['B', 'C', 'D'].forEach((col) => (ws.getCell(`${col}${r}`).value = { formula: `SUM(${col}${firstStatus}:${col}${r - 1})` }));
    boxed(ws.getCell(`A${r}`), { bold: true, fill: GREY });
    ['B', 'C', 'D'].forEach((col) => boxed(ws.getCell(`${col}${r}`), { bold: true, fill: GREY, fmt: col === 'B' ? INT : MONEY }));
    if (truncated.requests || truncated.items || truncated.customers) {
      r += 2;
      ws.getCell(`A${r}`).value = 'Warning: this period has more records than the workbook can hold. Choose a shorter period for complete figures.';
      ws.getCell(`A${r}`).font = { name: FONT, size: 11, bold: true };
    }
    setup(ws, { lastRow: r, lastCol: 'E', titles: false });
  }

  // Calibri everywhere (cells with no explicit font get it too)
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.font = { ...(cell.font || {}), name: FONT, size: (cell.font && cell.font.size) || 11 };
      })
    );
  });
  return wb;
}

module.exports = { buildWorkbook };
