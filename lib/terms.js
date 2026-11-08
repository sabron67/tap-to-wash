const { raw, esc } = require('./html');

// Default Terms of Service. The admin can edit them in Settings; every edit raises the version number.
// Format: "## Heading", "- bullet", blank line = new paragraph. {{business}} is replaced by the business name.
const DEFAULT_TERMS = `## 1. About these terms
By tapping "Tap to wash" and sending a request you agree to these terms with {{business}} ("we", "us"). Please read them before you send a request.

## 2. Our service
- We collect your laundry from the location you share, wash, dry, fold or press it as described, and deliver it back.
- A request is not a confirmed booking until we contact you by phone or message to confirm.
- Prices shown on the website are estimates. The final price is confirmed after your items are weighed or counted.

## 3. Your responsibilities
- Give us a correct name, phone number and a clear description of where to find you.
- Check pockets and remove valuables, money and documents before hand-over. We are not responsible for items left in garments.
- Tell us about stains, delicate fabrics, colours that may run, and any special care needs.

## 4. Care of your items
- We take reasonable care with every item and follow the care label where one is present.
- Some stains, dyes, wear and damage cannot be fully removed. We cannot accept responsibility for damage that comes from the fabric, its age, or a missing or incorrect care label.
- If an item is lost or damaged by us, please tell us within 24 hours of delivery. Compensation is limited to a fair value of the item, and not more than ten (10) times the price charged for washing it.

## 5. Payment
- Payment is due when your items are delivered, unless we agree otherwise in advance.
- We may keep items until the amount due has been paid.

## 6. Uncollected items
- Please collect or accept delivery promptly. Items not collected within 30 days of being ready may be donated or disposed of after we have tried to contact you.

## 7. Cancellations
- You may cancel before pick-up at no cost. Once items have been picked up, the work already done must be paid for.

## 8. Your information
- We use your name, phone number and shared location only to carry out your request, contact you and keep our business records.
- We do not sell your information. You may ask us to correct or delete it by contacting us.

## 9. Changes
- We may update these terms. You will be asked to accept the current version each time you send a request.`;

// Tiny, safe renderer: escapes everything, then builds headings, bullet lists and paragraphs.
function renderTerms(text, business) {
  const src = String(text || '').replace(/\r/g, '').replace(/\{\{business\}\}/g, business || 'us');
  const out = [];
  let list = [];
  let para = [];
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`); list = []; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${esc(para.join(' '))}</p>`); para = []; } };
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t) { flushList(); flushPara(); continue; }
    if (t.startsWith('## ')) { flushList(); flushPara(); out.push(`<h2>${esc(t.slice(3))}</h2>`); continue; }
    if (t.startsWith('- ')) { flushPara(); list.push(t.slice(2)); continue; }
    flushList();
    para.push(t);
  }
  flushList(); flushPara();
  return raw(out.join('\n'));
}

module.exports = { DEFAULT_TERMS, renderTerms };
