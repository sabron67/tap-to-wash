// Where customers send their M-Pesa money: a Till number (Lipa na M-Pesa > Buy Goods and Services) or a Paybill.
// The owner picks one in Admin > Settings > M-Pesa payments. Nothing here talks to Safaricom: it only works out
// what to tell the customer, so it works with the manual M-Pesa codes the rider or cashier records.

const TYPES = {
  till: 'Till number (Buy Goods)',
  paybill: 'Paybill',
};
const NUMBER_RE = /^\d{5,7}$/; // Till and Paybill numbers are 5 to 7 digits
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,29}$/;

const digits = (v) => String(v || '').replace(/\s+/g, '');

// Checks what the owner typed. Returns { ok: true, value } or { ok: false, error }.
function validateMpesa({ type, number, account, name }) {
  if (!type) return { ok: true, value: { mpesa_type: '', mpesa_number: '', mpesa_account: '', mpesa_name: '' } };
  if (!TYPES[type]) return { ok: false, error: 'Choose Till number or Paybill.' };
  const n = digits(number);
  if (!NUMBER_RE.test(n)) return { ok: false, error: `Enter your ${type === 'till' ? 'Till' : 'Paybill'} number using digits only (5 to 7 digits).` };
  const acc = type === 'paybill' ? String(account || '').trim() : '';
  if (acc && !ACCOUNT_RE.test(acc)) return { ok: false, error: 'The Paybill account can only use letters, numbers, spaces, dots, dashes and underscores (up to 30 characters).' };
  return { ok: true, value: { mpesa_type: type, mpesa_number: n, mpesa_account: acc, mpesa_name: String(name || '').trim().slice(0, 60) } };
}

// What to tell a customer who owes money on order `ref`. Returns null until the owner has set up a Till or Paybill.
function payInstructions(settings, { ref = '' } = {}) {
  const type = settings && settings.mpesa_type;
  const number = settings && digits(settings.mpesa_number);
  if (!TYPES[type] || !NUMBER_RE.test(number || '')) return null;
  const name = (settings.mpesa_name || '').trim();

  if (type === 'till') {
    return {
      type,
      label: 'Till number',
      number,
      account: '',
      name,
      steps: ['Open M-Pesa and choose Lipa na M-Pesa', 'Choose Buy Goods and Services', `Enter Till number ${number}`, 'Enter the amount, then your M-Pesa PIN'],
      summary: `Till number ${number}`,
    };
  }
  const fixed = (settings.mpesa_account || '').trim();
  const account = fixed || ref;
  return {
    type,
    label: 'Paybill number',
    number,
    account,
    accountIsRef: !fixed,
    name,
    steps: ['Open M-Pesa and choose Lipa na M-Pesa', 'Choose Paybill', `Enter business number ${number}`, `Enter account number ${account || 'your order reference'}`, 'Enter the amount, then your M-Pesa PIN'],
    summary: `Paybill ${number}${account ? `, account ${account}` : ''}`,
  };
}

module.exports = { TYPES, NUMBER_RE, validateMpesa, payInstructions };
