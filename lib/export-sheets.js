// Sheet definitions for the Excel exports (inventory, profit, expenses, reviews, complaints). Built on lib/xlsx-export.js.
const { tableSheet, titleBlock, headerRow, printSetup, style, layoutOf, LIGHT, FMT } = require('./xlsx-export');

const KIND_LABEL = { opening: 'Opening stock', purchase: 'Bought', usage: 'Used', waste: 'Damaged / lost', adjustment: 'Stock count' };
const n = (v) => Number(v || 0);

/* ------------------------------ inventory ------------------------------ */
function stockSheet(rows, cur) {
  return {
    name: 'Stock', title: 'Stock list', landscape: true,
    subtitle: `Quantity x average cost = stock value (${cur}). Status and values are formulas; off supplies are not valued.`,
    columns: [
      { header: 'Supply', width: 28, type: 'text' }, { header: 'Category', width: 20, type: 'text' }, { header: 'Unit', width: 9, type: 'text' },
      { header: 'Quantity', width: 12, type: 'num' }, { header: 'Reorder level', width: 12, type: 'num' }, { header: `Average cost per unit (${cur})`, width: 16, type: 'money' },
      { header: `Stock value (${cur})`, width: 16, type: 'money', formula: (r) => `IF(J${r}="Yes",D${r}*F${r},0)`, result: (v) => (v[9] === 'Yes' ? n(v[3]) * n(v[5]) : 0) },
      { header: 'Status', width: 11, type: 'text', align: 'center', formula: (r) => `IF(J${r}="No","Off",IF(D${r}<=E${r},"Reorder","OK"))`, result: (v) => (v[9] === 'No' ? 'Off' : n(v[3]) <= n(v[4]) ? 'Reorder' : 'OK') },
      { header: 'Supplier', width: 22, type: 'text' }, { header: 'Active', width: 9, type: 'text', align: 'center' },
    ],
    rows: rows.map((x) => [x.name, x.category, x.unit, x.quantity, x.reorder_level, x.unit_cost, null, null, x.supplier, x.is_active ? 'Yes' : 'No']),
    totals: [{ col: 6, kind: 'sum' }, { col: 7, kind: 'countif', criteria: 'Reorder', fmt: '0" to reorder"' }],
  };
}

function movementsSheet(rows, from, to, cur) {
  return {
    name: 'Movements', title: 'Stock movements', landscape: true,
    subtitle: `${from} to ${to}. Value = quantity change x cost per unit (${cur}); purchases are positive, supplies used or lost are negative.`,
    columns: [
      { header: 'Date', width: 13, type: 'date' }, { header: 'Supply', width: 26, type: 'text' }, { header: 'Type', width: 15, type: 'text' },
      { header: 'Quantity change', width: 12, type: 'num' }, { header: 'Unit', width: 9, type: 'text' }, { header: `Cost per unit (${cur})`, width: 14, type: 'money' },
      { header: `Value (${cur})`, width: 16, type: 'money', formula: (r) => `D${r}*F${r}`, result: (v) => n(v[3]) * n(v[5]) },
      { header: 'Supplier', width: 20, type: 'text' }, { header: 'Invoice / reference', width: 18, type: 'text' }, { header: 'Note', width: 34, type: 'text', wrap: true }, { header: 'Recorded by', width: 16, type: 'text' },
    ],
    rows: rows.map((m) => [m.day, m.item_name, KIND_LABEL[m.kind] || m.kind, m.quantity_change, m.unit, m.unit_cost, null, m.supplier, m.reference, m.reason, m.by_name || '']),
    totals: [{ col: 6, kind: 'sum' }],
    totalLabel: 'Net value of movements',
  };
}

// Profit sheet: revenue, refunds and expenses are typed-in figures (yellow); supply costs are SUMIFS formulas over the Movements sheet.
function profitSheet(p, { from, to, cur, nMoves, nStock }) {
  return {
    custom: (wb) => {
      const ws = wb.addWorksheet('Profit', { views: [{ showGridLines: false }] });
      titleBlock(ws, 'Profit summary', `${from} to ${to}. Yellow cells are figures from the system and can be edited; everything else is a formula (amounts in ${cur}).`);
      headerRow(ws, ['Line', `Amount (${cur})`, 'Where it comes from'], [52, 20, 66]);
      const M = layoutOf(nMoves);
      const mv = (kind) => `SUMIFS(Movements!$G$${M.first}:$G$${M.last},Movements!$C$${M.first}:$C$${M.last},"${kind}")`;
      const S = layoutOf(nStock);
      const gross = p.revenue - p.refundsPaid - p.used - p.waste - p.adjust;
      const net = gross - p.expenses;
      const lines = [
        ['Revenue collected (payments received)', p.revenue, null, 'Payments received on requests in this period (same basis as the dashboard).', 'input'],
        ['Less: refunds paid', p.refundsPaid, null, 'Refunds marked as paid in Operations.', 'input'],
        ['Less: supplies used in washing', p.used, `-${mv('Used')}`, 'Movements sheet, type "Used", at cost.'],
        ['Less: supplies damaged or lost', p.waste, `-${mv('Damaged / lost')}`, 'Movements sheet, type "Damaged / lost", at cost.'],
        ['Less: stock count differences (negative = stock found)', p.adjust, `-${mv('Stock count')}`, 'Movements sheet, type "Stock count", at cost.'],
        ['GROSS PROFIT', gross, 'B5-B6-B7-B8-B9', 'Revenue less refunds and supplies.', 'bold'],
        ['Less: other operating expenses', p.expenses, null, 'Operations > Expenses (rent, salaries, water, fuel, repairs). Do not repeat stock purchases here.', 'input'],
        ['NET PROFIT', net, 'B10-B11', 'Gross profit less other expenses.', 'bold'],
        ['Profit margin', p.revenue > 0 ? net / p.revenue : 'n/a', 'IF(B5>0,B12/B5,"n/a")', 'Net profit as a share of revenue.', 'pct'],
        ['Memo: stock bought in this period', p.purchases, mv('Bought'), 'Information only: purchases reach profit when the stock is used.'],
        ['Memo: stock on hand at cost (today)', null, `Stock!$G$${S.total}`, 'Total of the Stock sheet (active supplies).'],
      ];
      lines.forEach(([label, value, formula, note, mode], i) => {
        const r = 5 + i;
        const a = ws.getCell(`A${r}`), b = ws.getCell(`B${r}`), c = ws.getCell(`C${r}`);
        a.value = label;
        if (mode === 'input') b.value = value;
        else b.value = { formula, result: value === null ? undefined : value };
        c.value = note;
        const bold = mode === 'bold';
        style(a, { bold, fill: bold ? LIGHT : undefined });
        style(b, { bold, fill: bold ? LIGHT : undefined, input: mode === 'input', fmt: mode === 'pct' ? FMT.pct : FMT.money, align: 'right' });
        style(c, { wrap: true, fill: bold ? LIGHT : undefined });
      });
      printSetup(ws, { landscape: false, lastRow: 5 + lines.length - 1, lastCol: 'C' });
    },
  };
}

/* ------------------------------ operations ------------------------------ */
function expenseSheets(rows, cur) {
  const L = layoutOf(rows.length);
  const cats = [...new Set(rows.map((r) => r.category))].sort();
  const sumFor = (c) => rows.filter((r) => r.category === c).reduce((a, r) => a + n(r.amount), 0);
  const total = rows.reduce((a, r) => a + n(r.amount), 0);
  const CL = layoutOf(cats.length);
  return [
    {
      name: 'Expenses', title: 'Expenses', subtitle: `Operating costs in ${cur}. The total is a formula.`, landscape: false,
      columns: [{ header: 'Date', width: 14, type: 'date' }, { header: 'Category', width: 22, type: 'text' }, { header: 'Description', width: 48, type: 'text', wrap: true }, { header: `Amount (${cur})`, width: 16, type: 'money' }],
      rows: rows.map((x) => [x.day, x.category, x.description, x.amount]), totals: [{ col: 3, kind: 'sum' }],
    },
    {
      name: 'By Category', title: 'Expenses by category', subtitle: 'SUMIF formulas over the Expenses sheet.', landscape: false,
      columns: [
        { header: 'Category', width: 28, type: 'text' },
        { header: `Total (${cur})`, width: 18, type: 'money', formula: (r) => `SUMIF(Expenses!$B$${L.first}:$B$${L.last},A${r},Expenses!$D$${L.first}:$D$${L.last})`, result: (v) => sumFor(v[0]) },
        { header: 'Share of all expenses', width: 18, type: 'pct', formula: (r) => `IF($B$${CL.total}=0,0,B${r}/$B$${CL.total})`, result: (v) => (total ? sumFor(v[0]) / total : 0) },
      ],
      rows: cats.map((c) => [c, null, null]), totals: [{ col: 1, kind: 'sum' }, { col: 2, kind: 'sum' }],
    },
  ];
}

function reviewsSheet(rows) {
  return {
    name: 'Reviews', title: 'Customer reviews', subtitle: 'Ratings out of 5. The average is a formula.', landscape: true,
    columns: [{ header: 'Order', width: 16, type: 'text' }, { header: 'Customer', width: 24, type: 'text' }, { header: 'Phone', width: 16, type: 'text' }, { header: 'Rating', width: 9, type: 'int', align: 'center' }, { header: 'Comment', width: 56, type: 'text', wrap: true }, { header: 'Date', width: 14, type: 'date' }],
    rows: rows.map((x) => [x.ref_code, x.name, x.phone, x.rating, x.comment, x.day]),
    totals: [{ col: 3, kind: 'average', fmt: '0.00' }], totalLabel: 'Average rating',
  };
}

function complaintsSheet(rows) {
  return {
    name: 'Complaints', title: 'Customer complaints', subtitle: 'The number of complaints is a formula.', landscape: true,
    columns: [{ header: 'Subject', width: 30, type: 'text', wrap: true }, { header: 'Details', width: 44, type: 'text', wrap: true }, { header: 'Status', width: 14, type: 'text', align: 'center' }, { header: 'Resolution', width: 36, type: 'text', wrap: true }, { header: 'Date', width: 14, type: 'date' }, { header: 'Customer', width: 22, type: 'text' }, { header: 'Phone', width: 16, type: 'text' }],
    rows: rows.map((x) => [x.subject, x.details, x.status, x.resolution, x.day, x.name || '', x.phone || '']),
    totals: [{ col: 2, kind: 'count', fmt: '0" complaints"' }], totalLabel: 'Number of complaints',
  };
}

module.exports = { KIND_LABEL, stockSheet, movementsSheet, profitSheet, expenseSheets, reviewsSheet, complaintsSheet, tableSheet };
