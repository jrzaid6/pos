const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const number = (value, label, { min = 0, max = 99999999, places = 2 } = {}) => {
    if (!['number','string'].includes(typeof value) || (typeof value==='string' && !value.trim())) fail(`${label} is required`);
    const n = Number(value), scale = 10 ** places;
    if (!Number.isFinite(n) || n < min || n > max || Math.abs(n * scale - Math.round(n * scale)) > 0.00001) {
        fail(`${label} must be between ${min} and ${max}, with at most ${places} decimal places`);
    }
    return n;
};
const cents = value => Math.round(Number(value) * 100);
const money = value => cents(value) / 100;
// Quantity has 3 decimal places and price has 2. Multiply integers, round once.
const lineTotal = (quantity, price) => Number((BigInt(Math.round(Number(quantity)*1000))*BigInt(cents(price))+500n)/1000n)/100;
const text = (value, label, max, required = false) => {
    if (value != null && typeof value !== 'string') fail(`${label} must be text`);
    const result = (value || '').trim();
    if ((required && !result) || result.length > max) fail(`${label} ${required ? 'is required and ' : ''}must be at most ${max} characters`);
    return result || null;
};
const id = value => number(value, 'Record ID', { min: 1, max: 2147483647, places: 0 });
const date = (value, label, optional = false) => {
    if (!value && optional) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${label} must be a valid date`);
    return value;
};
const method = value => { if (!['cash', 'bank', 'upi'].includes(value)) fail('Choose cash, bank or UPI'); return value; };
const status = (total, paid) => cents(paid) >= cents(total) ? 'paid' : cents(paid) > 0 ? 'partial' : 'unpaid';
module.exports = { fail, number, cents, money, lineTotal, text, id, date, method, status };
