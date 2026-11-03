// The phone's calculators (PLAN-45). Exact mirrors of the PC's engine so a number never differs between the two:
//   project()  = finance/engine/future.project
//   fund()     = finance/engine/switch.fund        (keep this fund or move to a cheaper one, no tax: ניוד)
//   newMoney() = finance/engine/switch.new_money   (broker vs investment gemel for money you deposit)
// tests/test_phone_calc.py runs these in Node and compares them with the Python results.

export const TAX = 0.25;

export function project(initial, monthly, years, ret, fee, depositFee = 0, inflation = 0.025, taxRate = 0.25, taxOn = "real", grow = true) {
  const months = Math.round(years * 12);
  const rM = Math.pow(1 + ret, 1 / 12) - 1, fM = Math.pow(1 + fee, 1 / 12) - 1, iM = Math.pow(1 + inflation, 1 / 12) - 1;
  let v = +initial, paidNom = +initial, paidReal = +initial, price = 1, fees = 0;
  const row = year => {
    const basis = taxOn === "real" ? paidReal * price : taxOn === "nominal" ? paidNom : v;
    const afterTax = v - taxRate * Math.max(0, v - basis);
    return { year, nominal: v, real: v / price, after_tax_real: afterTax / price, paid_real: paidReal, fees_nominal: fees };
  };
  const rows = [row(0)];
  for (let m = 1; m <= months; m++) {
    price *= 1 + iM;
    const c = monthly * (grow ? price : 1);
    const grown = v * (1 + rM), feeNow = grown * fM;
    fees += feeNow + c * depositFee;
    v = grown - feeNow + c * (1 - depositFee);
    paidNom += c; paidReal += c / price;
    if (m % 12 === 0 || m === months) rows.push(row(Math.round(m / 12 * 100) / 100));
  }
  return { rows, final: rows[rows.length - 1] };
}

export const bar = amount => Math.max(500, 0.01 * amount);

export function fund(balance, years, monthly, grossNow, grossNew, feeNow, feeNew, inflation = 0.02) {
  const yrs = Math.max(1, Math.round(years));
  const keep = project(balance, monthly, yrs, grossNow, feeNow, 0, inflation, 0, "none");
  const move = project(balance, monthly, yrs, grossNew, feeNew, 0, inflation, 0, "none");
  const diff = move.final.after_tax_real - keep.final.after_tax_real;
  const b = bar(balance);
  return { years: yrs, keep: keep.final.after_tax_real, move: move.final.after_tax_real, difference: diff,
    first_year_saving: balance * (feeNow - feeNew), fees_keep: keep.final.fees_nominal, fees_move: move.final.fees_nominal,
    bar: b, worth: diff >= b };
}

export function newMoney(monthly, years, gross, feeBroker, feeGemel, tradeCostMonth = 0, inflation = 0.02, start = 0) {
  const yrs = Math.max(1, Math.round(years));
  const b = project(start, Math.max(0, monthly - tradeCostMonth), yrs, gross, feeBroker, 0, inflation, TAX, "real");
  const g = project(start, monthly, yrs, gross, feeGemel, 0, inflation, TAX, "real");
  const diff = g.final.after_tax_real - b.final.after_tax_real;
  const bb = bar(monthly * 12 * yrs * 0.05 + start * 0.01);
  return { years: yrs, broker: b.final.after_tax_real, gemel: g.final.after_tax_real, difference: diff,
    better: diff > 0 ? "gemel" : "broker", worth: Math.abs(diff) >= bb, bar: bb };
}
